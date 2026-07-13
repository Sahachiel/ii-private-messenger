import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Group, MediaRef, MessageType, ReplyRef } from '../types';
import { signal } from '@services/signal';
import { socket } from '@services/socket';
import { usersApi, groupsApi } from '@services/api';
import { senderKeys } from '@services/senderKeys';
import { appKv } from '@services/keychain';
import { mtd } from '@/xsec-mtd/engine/MTDEngine';
import { makeAttestation, getMySignPublicKeyB64 } from '@/xsec-mtd/attestation';
import { loadPolicy } from '@/xsec-mtd/policy';
import { EnvelopeV2, encodeEnvelope } from '@services/envelope';
import { addMessage } from './chatSlice';
import { Message } from '../types';

export interface GroupsState {
  byId: Record<string, Group>;
  order: string[];
}

const initialState: GroupsState = { byId: {}, order: [] };
const KV_KEY = 'groups.cache.v1';

function persist(state: GroupsState): void {
  appKv.set(KV_KEY, JSON.stringify(state));
}

function hydrate(): GroupsState {
  const raw = appKv.getString(KV_KEY);
  if (!raw) return initialState;
  try { return JSON.parse(raw) as GroupsState; } catch { return initialState; }
}

// Gruppi isolati con Sender Keys: UNA cifratura per messaggio (sender key), distribuita ai
// membri; il fan-out invia lo STESSO ciphertext a ciascun membro (≤50). Il nome del gruppo è
// solo client-side (zero-knowledge lato server). Ogni invio porta gid+epoch+capability firmata
// che il relay verifica (drop a non-membri / epoch stantia).

export const createGroup = createAsyncThunk(
  'groups/create',
  async (args: { name: string; memberIds?: string[]; iconUrl?: string }, { rejectWithValue }) => {
    const myId = appKv.getString('auth.userId')!;
    try {
      const res = await groupsApi.create(); // ID server (UUID) + epoch
      // Invita DAVVERO i membri selezionati: per ciascuno un invito vincolato monouso senza
      // approvazione, recapitato seamless via relay (contact_invite col nome del gruppo). Chi
      // accetta entra. Prima memberIds era ignorato (checkbox senza effetto — finding audit).
      const others = (args.memberIds ?? []).filter((id) => id && id !== myId);
      const myName = appKv.getString('auth.displayName') ?? 'Qualcuno';
      for (const uid of others) {
        try {
          const inv = await groupsApi.invite(res.id, { bound_user_id: uid, requires_approval: false, max_uses: 1, ttl_seconds: 7 * 24 * 3600 });
          socket.send({ type: 'contact_invite', to: uid, token: inv.token, fromName: args.name || myName } as any);
        } catch { /* un invito fallito non blocca la creazione */ }
      }
      const group: Group = {
        id: res.id, name: args.name, iconUrl: args.iconUrl,
        memberIds: [myId], adminIds: [myId],
        createdAt: Date.now(), createdBy: myId,
      };
      return group;
    } catch {
      return rejectWithValue('create_failed');
    }
  },
);

export interface SendGroupOpts {
  groupId: string;
  kind?: MessageType;
  body?: string;
  media?: MediaRef;
  replyTo?: ReplyRef;
  ttlMs?: number;
}

export const sendToGroup = createAsyncThunk(
  'groups/send',
  async (args: SendGroupOpts, { dispatch, rejectWithValue }) => {
    // Gate di sicurezza (preservato dalla versione precedente): un device compromesso non invia.
    const policy = loadPolicy();
    if (policy.blockSendOnCompromise && mtd.getState() === 'compromised') return rejectWithValue('device_compromised');

    const gid = args.groupId;
    const myId = appKv.getString('auth.userId')!;
    const kind: MessageType = args.kind ?? 'text';
    const body = args.body ?? '';
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = args.ttlMs ? Date.now() + args.ttlMs : undefined;

    // Bolla locale (echo)
    dispatch(addMessage({
      id: msgId, conversationId: gid, senderId: myId, recipientId: gid,
      type: kind, body, sentAt: Date.now(), status: 'pending',
      replyTo: args.replyTo, media: args.media, expiresAt, groupId: gid,
    } as Message));

    // Capability firmata + membri attuali dal backend (epoch autoritativo).
    let cap: string; let epoch: number; let others: string[];
    try {
      const c = await groupsApi.capability(gid);
      cap = c.cap; epoch = c.epoch;
      const members = await groupsApi.members(gid);
      others = members.map((m) => m.user_id).filter((u) => u !== myId);
    } catch {
      return rejectWithValue('group_unavailable');
    }

    // Allinea la Sender Key all'epoch corrente (scarta le epoche vecchie → forward secrecy).
    senderKeys.rotateEpoch(gid, epoch);

    const attestation = await makeAttestation(mtd.getState(), mtd.getScore(), []);
    const senderSignPub = await getMySignPublicKeyB64();

    // Distribuzione della MIA sender key ai membri (una volta per epoch), via canale pairwise.
    const distKey = `senderkeys.dist.${gid}`;
    const lastDist = appKv.getNumber(distKey) ?? -1;
    if (lastDist < epoch) {
      const distPlain = JSON.stringify(senderKeys.myDistribution(gid, epoch));
      for (const peer of others) {
        try {
          if (!(await signal.hasSession(peer, 1))) {
            const bundle = await usersApi.keys(peer);
            await signal.buildSession(peer, 1, bundle);
          }
          const payload = await signal.encrypt(peer, 1, distPlain);
          socket.send({
            type: 'send_message', messageId: `${msgId}-d-${peer}`, to: peer,
            conversationId: gid, gid, epoch, cap,
            ciphertext: JSON.stringify({ gskd: payload, from: myId }),
            messageType: 'system', timestamp: Date.now(),
          });
        } catch { /* continua */ }
      }
      appKv.set(distKey, epoch);
    }

    // Nome del gruppo (solo lato client) propagato cifrato così i nuovi membri lo vedono.
    let gname: string | undefined;
    try { gname = JSON.parse(appKv.getString('groups.cache.v1') ?? '{}')?.byId?.[gid]?.name; } catch { /* ignore */ }

    // UNA cifratura sender-key del messaggio; lo stesso ciphertext va a ciascun membro.
    const env: EnvelopeV2 = {
      v: 2, kind, body, media: args.media, replyTo: args.replyTo, ttlMs: args.ttlMs,
      groupId: gid, epoch, gname, clientMsgId: msgId,
    };
    const skm = senderKeys.encryptGroup(gid, epoch, encodeEnvelope(env));
    const ciphertext = JSON.stringify({ gsk: skm, attestation, senderSignPub });
    for (const peer of others) {
      socket.send({
        type: 'send_message', messageId: `${msgId}-${peer}`, to: peer,
        conversationId: gid, gid, epoch, cap,
        ciphertext, messageType: kind, timestamp: Date.now(),
      });
    }
    return { msgId };
  },
);

const groupsSlice = createSlice({
  name: 'groups',
  initialState: hydrate(),
  reducers: {
    upsertGroup(state, a: PayloadAction<Group>) {
      state.byId[a.payload.id] = a.payload;
      if (!state.order.includes(a.payload.id)) state.order.unshift(a.payload.id);
      persist(state);
    },
    removeGroup(state, a: PayloadAction<{ id: string }>) {
      delete state.byId[a.payload.id];
      state.order = state.order.filter((x) => x !== a.payload.id);
      persist(state);
    },
    addMember(state, a: PayloadAction<{ id: string; memberId: string }>) {
      const g = state.byId[a.payload.id];
      if (!g) return;
      if (!g.memberIds.includes(a.payload.memberId)) g.memberIds.push(a.payload.memberId);
      persist(state);
    },
    removeMember(state, a: PayloadAction<{ id: string; memberId: string }>) {
      const g = state.byId[a.payload.id];
      if (!g) return;
      g.memberIds = g.memberIds.filter((m) => m !== a.payload.memberId);
      g.adminIds = g.adminIds.filter((m) => m !== a.payload.memberId);
      persist(state);
    },
  },
  extraReducers: (b) => {
    b.addCase(createGroup.fulfilled, (state, a) => {
      state.byId[a.payload.id] = a.payload;
      state.order.unshift(a.payload.id);
      persist(state);
    });
    b.addCase(sendToGroup.fulfilled, (state, a) => {
      // Mark local as sent — we treat fanout completion as "sent"; delivery per
      // member is not tracked here.
      // (No direct state mutation — chatSlice handles the pending→sent flip for the local row.)
    });
  },
});

export const { upsertGroup, removeGroup, addMember, removeMember } = groupsSlice.actions;
export default groupsSlice.reducer;
