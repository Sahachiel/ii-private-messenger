import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Message, Conversation, MessageStatus, MessageType, ReplyRef, Reactions, MediaRef } from '../types';
import { signal } from '@services/signal';
import { senderKeys } from '@services/senderKeys';
import { socket } from '@services/socket';
import { usersApi, messagesApi } from '@services/api';
import { appKv } from '@services/keychain';
import { mtd } from '@/xsec-mtd/engine/MTDEngine';
import { makeAttestation, verifyAttestation, getMySignPublicKeyB64 } from '@/xsec-mtd/attestation';
import { loadPolicy } from '@/xsec-mtd/policy';
import { EnvelopeV2, decodeEnvelope, encodeEnvelope } from '@services/envelope';
import { upsertPeerTrust } from '@services/attestationStore';
import { ingestIncomingStory } from './storiesSlice';
import { Story } from '../types';

export interface ChatState {
  conversations: Record<string, Conversation>;
  messages: Record<string, Message[]>;
  drafts: Record<string, string>;
  typing: Record<string, number>;
  unreadCounts: Record<string, number>;
}

const initialState: ChatState = {
  conversations: {}, messages: {}, drafts: {}, typing: {}, unreadCounts: {},
};

export interface SendOpts {
  conversationId: string;
  recipientId: string;
  kind?: MessageType;
  body?: string;
  media?: MediaRef;
  replyTo?: ReplyRef;
  ttlMs?: number;         // overrides chat.disappearingMs for this msg
  groupId?: string;
}

// Helper: build a standard outgoing envelope and send over the socket.
// Called by sendMessage (1-to-1), sendReaction, and groupsSlice fan-out.
async function encryptAndSend(args: {
  recipientId: string;
  envelope: EnvelopeV2;
  conversationId: string;
  messageId: string;
  messageType: string;
}): Promise<void> {
  const deviceId = 1;
  if (!(await signal.hasSession(args.recipientId, deviceId))) {
    const bundle = await usersApi.keys(args.recipientId);
    await signal.buildSession(args.recipientId, deviceId, bundle);
  }
  const plain = encodeEnvelope(args.envelope);
  const payload = await signal.encrypt(args.recipientId, deviceId, plain);

  const policy = loadPolicy();
  const enabledCats = Object.entries(policy.enabled).filter(([, v]) => v).map(([k]) => k);
  const attestation = await makeAttestation(mtd.getState(), mtd.getScore(), enabledCats);
  const senderSignPub = await getMySignPublicKeyB64();

  socket.send({
    type: 'send_message',
    messageId: args.messageId,
    to: args.recipientId,
    conversationId: args.conversationId,
    ciphertext: JSON.stringify({ payload, attestation, senderSignPub }),
    messageType: args.messageType,
    timestamp: Date.now(),
  });
}

export const sendMessage = createAsyncThunk(
  'chat/send',
  async (args: SendOpts, { dispatch, getState, rejectWithValue }) => {
    const policy = loadPolicy();
    if (policy.blockSendOnCompromise && mtd.getState() === 'compromised') {
      return rejectWithValue('device_compromised');
    }
    const kind: MessageType = args.kind ?? 'text';
    const body = args.body ?? '';
    // Phishing scan (text only — warn, not block)
    let phishHit = false;
    if (kind === 'text' && body) {
      try {
        const ph = await mtd.scanMessage(body);
        phishHit = ph.some((e) => e.severity === 'compromised');
      } catch {}
    }

    const myId = appKv.getString('auth.userId')!;
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const convState = (getState() as any).chat.conversations[args.conversationId] as Conversation | undefined;
    const ttlMs = args.ttlMs ?? convState?.disappearingMs;
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;

    const localMsg: Message = {
      id: msgId, conversationId: args.conversationId, senderId: myId, recipientId: args.recipientId,
      type: kind, body, sentAt: Date.now(), status: 'pending',
      replyTo: args.replyTo, media: args.media, expiresAt, groupId: args.groupId,
    };
    dispatch(chatSlice.actions.addMessage(localMsg));

    const env: EnvelopeV2 = {
      v: 2, kind, body,
      media: args.media, replyTo: args.replyTo, ttlMs,
      groupId: args.groupId, clientMsgId: msgId,
    };
    await encryptAndSend({
      recipientId: args.recipientId, envelope: env,
      conversationId: args.conversationId, messageId: msgId, messageType: kind,
    });
    return { msgId, phishHit };
  },
);

// React to a message with an emoji (or remove a previous one). The reaction
// travels as an envelope with reactTarget; receiver patches its reactions[].
export const sendReaction = createAsyncThunk(
  'chat/react',
  async (args: { conversationId: string; recipientId: string; targetId: string; emoji: string; remove?: boolean }, { dispatch }) => {
    const myId = appKv.getString('auth.userId')!;
    dispatch(chatSlice.actions.applyReaction({ conversationId: args.conversationId, targetId: args.targetId, userId: myId, emoji: args.emoji, remove: args.remove }));
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const env: EnvelopeV2 = {
      v: 2, kind: 'reaction', body: '',
      reactTarget: { id: args.targetId, emoji: args.emoji, remove: args.remove },
    };
    await encryptAndSend({
      recipientId: args.recipientId, envelope: env,
      conversationId: args.conversationId, messageId: msgId, messageType: 'reaction',
    });
    return {};
  },
);

export const decryptIncoming = createAsyncThunk(
  'chat/decrypt',
  async (args: { from: string; payload: any; messageId: string; conversationId?: string }, { dispatch }) => {
    const empty = {
      from: args.from, envelope: null as EnvelopeV2 | null, messageId: args.messageId,
      peerState: null as string | null, peerScore: 0, peerDigest: undefined as string | undefined,
      conversationId: args.conversationId,
    };
    const raw0 = args.payload;
    const gid = args.conversationId;
    let peerState: string | null = null;
    let peerScore = 0;
    let peerDigest: string | undefined;

    // (1) Distribuzione Sender Key di gruppo (canale pairwise): registra la chain del mittente
    // per (gid, epoch) — nessuna bolla in chat.
    if (raw0 && typeof raw0 === 'object' && raw0.gskd && gid) {
      try {
        const distPlain = await signal.decrypt(args.from, 1, raw0.gskd);
        const dist = JSON.parse(distPlain);
        // ANTI-POISONING (fix audit): la distribution è autenticata dal canale pairwise
        // (signal.decrypt prova che viene davvero da args.from). Accettala SOLO se il mittente
        // dichiarato (sid) coincide con args.from e la forma è valida → un membro non può
        // avvelenare la sender-chain di un ALTRO membro iniettando una distribution falsa.
        if (dist && dist.sid === args.from && typeof dist.e === 'number' && typeof dist.ck === 'string' && typeof dist.spk === 'string') {
          senderKeys.processDistribution(gid, dist);
        }
      } catch { /* drop */ }
      return empty;
    }

    // (2) Messaggio di gruppo cifrato con Sender Key.
    if (raw0 && typeof raw0 === 'object' && raw0.gsk && gid) {
      if (raw0.attestation && raw0.senderSignPub) {
        try {
          if (verifyAttestation(raw0.attestation, raw0.senderSignPub)) {
            peerState = raw0.attestation.state; peerScore = raw0.attestation.healthScore ?? 0; peerDigest = raw0.attestation.detectorDigest;
          }
        } catch {}
      }
      // Validazione schema del messaggio sender-key PRIMA di decifrare (fix audit: niente
      // shape non validate passate al layer crypto, che fallirebbero con errore criptico).
      const g = raw0.gsk;
      const validGsk = g && typeof g.sid === 'string' && typeof g.e === 'number' && typeof g.i === 'number'
        && typeof g.n === 'string' && typeof g.c === 'string' && typeof g.s === 'string';
      if (!validGsk) return empty;
      let plain: string;
      try { plain = senderKeys.decryptGroup(gid, g); } catch { return empty; }
      const envelope = decodeEnvelope(plain);
      try { if (envelope.body) await mtd.scanMessage(envelope.body); } catch {}
      return { from: args.from, envelope, messageId: args.messageId, peerState, peerScore, peerDigest, conversationId: gid };
    }

    // (3) Canale 1:1 pairwise (esistente).
    let raw = raw0;
    if (raw && typeof raw === 'object' && raw.payload) {
      if (raw.attestation && raw.senderSignPub) {
        try {
          const ok = verifyAttestation(raw.attestation, raw.senderSignPub);
          if (ok) {
            peerState = raw.attestation.state;
            peerScore = raw.attestation.healthScore ?? 0;
            peerDigest = raw.attestation.detectorDigest;
          }
        } catch {}
      }
      raw = raw.payload;
    }
    const plain = await signal.decrypt(args.from, 1, raw);
    const envelope = decodeEnvelope(plain);
    try { if (envelope.body) await mtd.scanMessage(envelope.body); } catch {}

    // Fan out story envelopes into storiesSlice — chatSlice reducer below
    // intentionally skips storyId messages so we don't create a chat row.
    if (envelope.storyId && envelope.storyKind && envelope.storyExpiresAt) {
      const story: Story = {
        id: envelope.storyId,
        authorId: args.from,
        authorName: args.from,
        kind: envelope.storyKind,
        body: envelope.body ?? '',
        bgColor: envelope.storyBgColor,
        createdAt: Date.now(),
        expiresAt: envelope.storyExpiresAt,
        viewedBy: [],
      };
      dispatch(ingestIncomingStory(story));
    }

    return { from: args.from, envelope, messageId: args.messageId, peerState, peerScore, peerDigest, conversationId: args.conversationId };
  },
);

export const deleteMessage = createAsyncThunk(
  'chat/delete',
  async (args: { conversationId: string; messageId: string; forEveryone: boolean }) => {
    if (args.forEveryone) { try { await messagesApi.remove(args.messageId); } catch {} }
    return args;
  },
);

// Periodic sweep — removes messages whose expiresAt is past. Called from a
// 30s interval in App.tsx or on screen focus.
export function sweepExpired(state: ChatState, now = Date.now()): { removedCount: number } {
  let removed = 0;
  for (const cid of Object.keys(state.messages)) {
    const list = state.messages[cid];
    const keep = list.filter((m) => !m.expiresAt || m.expiresAt > now);
    removed += list.length - keep.length;
    state.messages[cid] = keep;
    const conv = state.conversations[cid];
    if (conv?.lastMessage && conv.lastMessage.expiresAt && conv.lastMessage.expiresAt <= now) {
      conv.lastMessage = keep[keep.length - 1];
    }
  }
  return { removedCount: removed };
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    upsertConversation(state, a: PayloadAction<Conversation>) {
      state.conversations[a.payload.id] = a.payload;
    },
    addMessage(state, a: PayloadAction<Message>) {
      const cid = a.payload.conversationId;
      state.messages[cid] ??= [];
      state.messages[cid].push(a.payload);
      const myId = appKv.getString('auth.userId');
      const conv = state.conversations[cid] ?? {
        id: cid,
        peerId: a.payload.senderId === myId ? a.payload.recipientId : a.payload.senderId,
        peerName: cid, isGroup: !!a.payload.groupId, unreadCount: 0, muted: false, archived: false, updatedAt: a.payload.sentAt,
      };
      conv.lastMessage = a.payload;
      conv.updatedAt = a.payload.sentAt;
      if (a.payload.senderId !== myId) conv.unreadCount += 1;
      state.conversations[cid] = conv;
    },
    updateMessageStatus(state, a: PayloadAction<{ conversationId: string; messageId: string; status: MessageStatus }>) {
      const list = state.messages[a.payload.conversationId];
      if (!list) return;
      const m = list.find((x) => x.id === a.payload.messageId);
      if (m) {
        m.status = a.payload.status;
        if (a.payload.status === 'delivered') m.deliveredAt = Date.now();
        if (a.payload.status === 'read') m.readAt = Date.now();
      }
    },
    setDraft(state, a: PayloadAction<{ conversationId: string; body: string }>) {
      state.drafts[a.payload.conversationId] = a.payload.body;
    },
    setTyping(state, a: PayloadAction<{ userId: string; active: boolean }>) {
      if (a.payload.active) state.typing[a.payload.userId] = Date.now();
      else delete state.typing[a.payload.userId];
    },
    markAsRead(state, a: PayloadAction<{ conversationId: string }>) {
      const conv = state.conversations[a.payload.conversationId];
      if (conv) conv.unreadCount = 0;
      (state.messages[a.payload.conversationId] ?? []).forEach((m) => {
        const myId = appKv.getString('auth.userId');
        if (m.recipientId === myId && !m.readAt) { m.readAt = Date.now(); m.status = 'read'; }
      });
    },
    clearConversation(state, a: PayloadAction<{ conversationId: string }>) {
      delete state.messages[a.payload.conversationId];
      delete state.conversations[a.payload.conversationId];
    },
    setDisappearingTimer(state, a: PayloadAction<{ conversationId: string; ms?: number }>) {
      const conv = state.conversations[a.payload.conversationId];
      if (conv) conv.disappearingMs = a.payload.ms;
    },
    setChatWallpaper(state, a: PayloadAction<{ conversationId: string; wallpaperId?: string }>) {
      const conv = state.conversations[a.payload.conversationId];
      if (conv) conv.wallpaperId = a.payload.wallpaperId;
    },
    applyReaction(state, a: PayloadAction<{ conversationId: string; targetId: string; userId: string; emoji: string; remove?: boolean }>) {
      const list = state.messages[a.payload.conversationId];
      if (!list) return;
      const target = list.find((m) => m.id === a.payload.targetId);
      if (!target) return;
      target.reactions ??= {};
      // one reaction per user — remove from any other emoji
      for (const [k, v] of Object.entries(target.reactions)) {
        target.reactions[k] = v.filter((u) => u !== a.payload.userId);
        if (target.reactions[k].length === 0) delete target.reactions[k];
      }
      if (!a.payload.remove) {
        target.reactions[a.payload.emoji] ??= [];
        if (!target.reactions[a.payload.emoji].includes(a.payload.userId)) {
          target.reactions[a.payload.emoji].push(a.payload.userId);
        }
      }
    },
    sweepExpiredNow(state) {
      sweepExpired(state);
    },
    toggleMute(state, a: PayloadAction<{ conversationId: string }>) {
      const c = state.conversations[a.payload.conversationId];
      if (c) c.muted = !c.muted;
    },
    toggleArchive(state, a: PayloadAction<{ conversationId: string }>) {
      const c = state.conversations[a.payload.conversationId];
      if (c) c.archived = !c.archived;
    },
  },
  extraReducers: (b) => {
    b.addCase(decryptIncoming.fulfilled, (state, a) => {
      const myId = appKv.getString('auth.userId')!;
      const env = a.payload.envelope;
      // Distribuzioni Sender Key / messaggi non decifrabili: nessuna bolla da inserire.
      if (!env) return;
      const cid = a.payload.conversationId ?? env.groupId ?? a.payload.from;

      // Record peer trust snapshot for badge rendering
      if (a.payload.peerState) {
        upsertPeerTrust(a.payload.from, a.payload.peerState as any, a.payload.peerScore, a.payload.peerDigest);
      }

      // Reaction patch — mutate target message in place; don't add a visible row.
      if (env.kind === 'reaction' && env.reactTarget) {
        const t = env.reactTarget;
        const list = state.messages[cid] ?? state.messages[a.payload.from];
        const target = list?.find((m) => m.id === t.id);
        if (target) {
          target.reactions ??= {};
          for (const [k, v] of Object.entries(target.reactions)) {
            target.reactions[k] = v.filter((u) => u !== a.payload.from);
            if (target.reactions[k].length === 0) delete target.reactions[k];
          }
          if (!t.remove) {
            target.reactions[t.emoji] ??= [];
            if (!target.reactions[t.emoji].includes(a.payload.from)) {
              target.reactions[t.emoji].push(a.payload.from);
            }
          }
        }
        return;
      }

      // Story envelopes are handled by storiesSlice listener — skip insertion here.
      if (env.storyId) return;

      const expiresAt = env.ttlMs ? Date.now() + env.ttlMs : undefined;
      const m: Message = {
        id: env.clientMsgId ?? a.payload.messageId,
        conversationId: cid,
        senderId: a.payload.from,
        recipientId: myId,
        type: env.kind,
        body: env.body,
        sentAt: Date.now(),
        status: 'delivered',
        replyTo: env.replyTo,
        media: env.media,
        expiresAt,
        groupId: env.groupId,
        senderCompromised: a.payload.peerState === 'compromised',
      };
      state.messages[cid] ??= [];
      state.messages[cid].push(m);
      const conv = state.conversations[cid] ?? {
        id: cid, peerId: a.payload.from, peerName: a.payload.from,
        isGroup: !!env.groupId, unreadCount: 0, muted: false, archived: false, updatedAt: m.sentAt,
      };
      conv.lastMessage = m; conv.updatedAt = m.sentAt; conv.unreadCount += 1;
      // Sync passivo del nome gruppo cifrato: aggiorna il titolo se è ancora un placeholder.
      if (env.groupId && env.gname && (conv.peerName === 'Gruppo' || conv.peerName === cid || conv.peerName === a.payload.from)) {
        conv.peerName = env.gname;
      }
      state.conversations[cid] = conv;
    })
    .addCase(sendMessage.fulfilled, (state, a) => {
      for (const list of Object.values(state.messages)) {
        const m = list.find((x) => x.id === a.payload.msgId);
        if (m && m.status === 'pending') m.status = 'sent';
      }
    })
    .addCase(deleteMessage.fulfilled, (state, a) => {
      const list = state.messages[a.payload.conversationId];
      if (!list) return;
      state.messages[a.payload.conversationId] = list.filter((m) => m.id !== a.payload.messageId);
    })
    .addCase(sendMessage.rejected, (state) => {
      for (const list of Object.values(state.messages)) {
        const m = list.find((x) => x.status === 'pending');
        if (m) { m.status = 'failed'; break; }
      }
    });
  },
});

export const {
  upsertConversation, addMessage, updateMessageStatus, setDraft, setTyping, markAsRead,
  clearConversation, setDisappearingTimer, setChatWallpaper, applyReaction, sweepExpiredNow,
  toggleMute, toggleArchive,
} = chatSlice.actions;
export default chatSlice.reducer;
