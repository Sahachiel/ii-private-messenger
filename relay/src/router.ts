import axios from 'axios';
import { WebSocket } from 'ws';
import {
  RelayMessage,
  RelayEvent,
  RelayEventType,
  Region,
} from './types';
import { getLocalSocket, getRegion } from './store';
import { enqueue } from './queue';
import { authorizeGroup, authorizeGroupSealed } from './groupAuth';

const REGION = (process.env.NODE_REGION ?? 'ge') as Region;
const INTER_NODE_SECRET = process.env.INTER_NODE_SECRET ?? '';

function internalUrlFor(region: Region): string | null {
  switch (region) {
    case 'ru':
      return process.env.RELAY_RU_INTERNAL ?? null;
    case 'ge':
      return process.env.RELAY_GE_INTERNAL ?? null;
    case 'fi':
      return process.env.RELAY_FI_INTERNAL ?? null;
    default:
      return null;
  }
}

function sendToSocket(socket: WebSocket, event: RelayEvent): boolean {
  if (socket.readyState !== socket.OPEN) return false;
  try {
    socket.send(JSON.stringify(event));
    return true;
  } catch (err) {
    console.error(`[relay-${REGION}] sendToSocket:`, (err as Error).message);
    return false;
  }
}

function eventTypeForIncoming(t: RelayMessage['type']): RelayEventType | null {
  switch (t) {
    case 'send_message':
      return 'message';
    case 'call_offer':
      return 'call_offer';
    case 'call_answer':
      return 'call_answer';
    case 'ice_candidate':
      return 'ice_candidate';
    case 'call_end':
      return 'call_end';
    case 'typing_start':
      return 'typing_start';
    case 'typing_stop':
      return 'typing_stop';
    case 'read_receipt':
      return 'read_receipt';
    case 'contact_invite':
      return 'contact_invite';
    case 'ping':
      return null;
    default:
      return null;
  }
}

function buildEvent(from: string, msg: RelayMessage): RelayEvent | null {
  const evType = eventTypeForIncoming(msg.type);
  if (!evType) return null;
  const base: RelayEvent = { type: evType, from };
  switch (msg.type) {
    case 'send_message':
      base.to = msg.to;
      base.messageId = msg.messageId;
      base.conversationId = msg.conversationId;
      base.gid = msg.gid;
      base.epoch = msg.epoch;
      base.ciphertext = msg.ciphertext;
      base.messageType = msg.messageType;
      base.timestamp = msg.timestamp ?? Date.now();
      return base;
    case 'call_offer':
      base.to = msg.to;
      base.callId = msg.callId;
      base.callType = msg.callType;
      base.sdp = msg.sdp;
      return base;
    case 'call_answer':
      base.to = msg.to;
      base.callId = msg.callId;
      base.sdp = msg.sdp;
      return base;
    case 'ice_candidate':
      base.to = msg.to;
      base.callId = msg.callId;
      base.candidate = msg.candidate;
      return base;
    case 'call_end':
      base.to = msg.to;
      base.callId = msg.callId;
      base.reason = msg.reason;
      return base;
    case 'typing_start':
    case 'typing_stop':
      base.to = msg.to;
      base.conversationId = msg.conversationId;
      base.gid = msg.gid;
      return base;
    case 'read_receipt':
      base.to = msg.to;
      base.messageId = msg.messageId;
      base.conversationId = msg.conversationId;
      base.gid = msg.gid;
      return base;
    case 'contact_invite':
      base.to = msg.to;
      base.token = msg.token;
      base.fromName = msg.fromName;
      base.fromCode = msg.fromCode;
      return base;
    default:
      return null;
  }
}

async function forwardCrossRegion(targetRegion: Region, payload: RelayEvent): Promise<boolean> {
  const url = internalUrlFor(targetRegion);
  if (!url) {
    console.error(`[relay-${REGION}] no internal URL for region ${targetRegion}`);
    return false;
  }
  try {
    const resp = await axios.post(`${url}/internal/relay`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': INTER_NODE_SECRET,
      },
      timeout: 5000,
    });
    return resp.status >= 200 && resp.status < 300;
  } catch (err) {
    console.error(`[relay-${REGION}] forwardCrossRegion:`, (err as Error).message);
    return false;
  }
}

export async function handleClientMessage(
  fromUserId: string,
  socket: WebSocket,
  msg: RelayMessage
): Promise<void> {
  if (msg.type === 'ping') {
    sendToSocket(socket, { type: 'pong', ts: msg.ts ?? Date.now() });
    return;
  }

  const event = buildEvent(fromUserId, msg);
  if (!event) return;

  const gid = (msg as { gid?: string }).gid;
  const cap = (msg as { cap?: string }).cap;
  const scap = (msg as { scap?: string }).scap;
  const sealed = (msg as { sealed?: boolean }).sealed === true;

  // App group-centric: ogni messaggio di chat DEVE essere di gruppo (isolamento).
  if (msg.type === 'send_message' && !gid) {
    sendToSocket(socket, { type: 'error', error: 'gid_required' });
    return;
  }

  // ENFORCEMENT GRUPPO: verifica la capability firmata e consegna solo ai membri attivi.
  if (gid) {
    // SEALED SENDER: se richiesto, autorizza con la capability ANONIMA (scap) senza usare
    // l'identità del mittente; altrimenti percorso classico (cap legata all'uid).
    const verdict = sealed ? await authorizeGroupSealed(gid, scap) : await authorizeGroup(fromUserId, gid, cap);
    if (!verdict.ok) {
      // NIENTE ORACOLO (fix audit): solo 'epoch_stale' è distinto; ogni altra causa → errore
      // GENERICO UNIFORME senza echo del gid.
      const err = verdict.reason === 'epoch_stale' ? 'epoch_stale' : 'group_forbidden';
      sendToSocket(socket, { type: 'error', error: err });
      return;
    }
    if (event.to && !verdict.members.includes(event.to)) return; // drop verso non-membri
    // Sigilla il mittente verso il destinatario: il relay non rivela chi ha inviato (l'identità
    // vera è dentro il payload E2EE, opaque sid). La ricevuta di consegna torna comunque al
    // mittente reale via `fromUserId` (sotto), non al destinatario.
    if (sealed) event.from = 'sealed';
  }

  if (!event.to) return;
  await deliverEvent(fromUserId, socket, msg, event);
}

/** Consegna locale → cross-region → coda offline (logica condivisa da gruppo e segnali). */
async function deliverEvent(
  fromUserId: string,
  socket: WebSocket,
  msg: RelayMessage,
  event: RelayEvent
): Promise<void> {
  const recipientId = event.to;
  if (!recipientId) return;

  const localSocket = getLocalSocket(recipientId);
  if (localSocket) {
    const ok = sendToSocket(localSocket, event);
    if (ok && msg.type === 'send_message') {
      sendToSocket(socket, {
        type: 'delivery_receipt',
        from: recipientId,
        to: fromUserId,
        messageId: msg.messageId,
        conversationId: msg.conversationId,
        gid: msg.gid,
        timestamp: Date.now(),
      });
    }
    return;
  }

  const targetRegion = await getRegion(recipientId);
  if (targetRegion && targetRegion !== REGION) {
    const forwarded = await forwardCrossRegion(targetRegion, event);
    if (forwarded && msg.type === 'send_message') {
      sendToSocket(socket, {
        type: 'delivery_receipt',
        from: recipientId,
        to: fromUserId,
        messageId: msg.messageId,
        conversationId: msg.conversationId,
        gid: msg.gid,
        timestamp: Date.now(),
      });
      return;
    }
    if (!forwarded && shouldQueue(msg.type)) {
      await enqueue(recipientId, event);
    }
    return;
  }

  if (shouldQueue(msg.type)) {
    await enqueue(recipientId, event);
  }
}

function shouldQueue(t: RelayMessage['type']): boolean {
  // Only queue persistent events; skip transient signaling/typing.
  // contact_invite è persistente: se il destinatario è offline va accodato e consegnato al
  // prossimo login, altrimenti la richiesta di contatto seamless andrebbe persa.
  return t === 'send_message' || t === 'read_receipt' || t === 'contact_invite';
}

export async function deliverOrQueueLocal(event: RelayEvent): Promise<void> {
  if (!event.to) return;
  const socket = getLocalSocket(event.to);
  if (socket) {
    sendToSocket(socket, event);
    return;
  }
  // Persistenti (offline): messaggi, ricevute e richieste di contatto seamless.
  if (event.type === 'message' || event.type === 'read_receipt' || event.type === 'contact_invite') {
    await enqueue(event.to, event);
  }
}
