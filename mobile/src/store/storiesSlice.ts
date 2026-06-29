import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Story, StoryKind, MediaRef } from '../types';
import { signal } from '@services/signal';
import { socket } from '@services/socket';
import { usersApi, contactsApi } from '@services/api';
import { appKv } from '@services/keychain';
import { mtd } from '@/xsec-mtd/engine/MTDEngine';
import { makeAttestation, getMySignPublicKeyB64 } from '@/xsec-mtd/attestation';
import { loadPolicy } from '@/xsec-mtd/policy';
import { EnvelopeV2, encodeEnvelope } from '@services/envelope';

export const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface StoriesState {
  byId: Record<string, Story>;
  order: string[]; // createdAt desc
}

const initialState: StoriesState = { byId: {}, order: [] };

// Publish a story: one E2EE envelope broadcast to every contact in the addressbook.
// Each recipient independently decrypts, stores in their local stories cache,
// and expires it after STORY_TTL_MS.
export const publishStory = createAsyncThunk(
  'stories/publish',
  async (args: { kind: StoryKind; body: string; media?: MediaRef; bgColor?: string }, { dispatch, rejectWithValue }) => {
    const policy = loadPolicy();
    if (policy.blockSendOnCompromise && mtd.getState() === 'compromised') return rejectWithValue('device_compromised');

    const myId = appKv.getString('auth.userId')!;
    const myName = appKv.getString('auth.displayName') ?? appKv.getString('auth.username') ?? 'You';
    const storyId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = Date.now();
    const expiresAt = createdAt + STORY_TTL_MS;

    const local: Story = {
      id: storyId, authorId: myId, authorName: myName,
      kind: args.kind, body: args.media ? '' : args.body,
      bgColor: args.bgColor, createdAt, expiresAt, viewedBy: [],
    };
    dispatch(storiesSlice.actions.addStory(local));

    // Broadcast envelope to every contact
    const contacts = await contactsApi.list().catch(() => []);
    const attestation = await makeAttestation(mtd.getState(), mtd.getScore(), []);
    const senderSignPub = await getMySignPublicKeyB64();

    for (const c of contacts) {
      try {
        const deviceId = 1;
        if (!(await signal.hasSession(c.id, deviceId))) {
          const bundle = await usersApi.keys(c.id);
          await signal.buildSession(c.id, deviceId, bundle);
        }
        const env: EnvelopeV2 = {
          v: 2, kind: 'story_ack', body: args.body,
          media: args.media,
          storyId, storyExpiresAt: expiresAt,
          storyKind: args.kind, storyBgColor: args.bgColor,
          clientMsgId: `story-${storyId}`,
        };
        const payload = await signal.encrypt(c.id, deviceId, encodeEnvelope(env));
        socket.send({
          type: 'send_message',
          messageId: `story-${storyId}-${c.id}`,
          to: c.id,
          conversationId: `story:${myId}`,
          ciphertext: JSON.stringify({ payload, attestation, senderSignPub }),
          messageType: 'story',
          timestamp: createdAt,
        });
      } catch {
        // skip this recipient; we best-effort broadcast
      }
    }
    return { storyId };
  },
);

const storiesSlice = createSlice({
  name: 'stories',
  initialState,
  reducers: {
    addStory(state, a: PayloadAction<Story>) {
      state.byId[a.payload.id] = a.payload;
      if (!state.order.includes(a.payload.id)) state.order.unshift(a.payload.id);
    },
    markViewed(state, a: PayloadAction<{ storyId: string; viewerId: string }>) {
      const s = state.byId[a.payload.storyId];
      if (!s) return;
      if (!s.viewedBy.includes(a.payload.viewerId)) s.viewedBy.push(a.payload.viewerId);
    },
    sweepExpired(state) {
      const now = Date.now();
      state.order = state.order.filter((id) => {
        const s = state.byId[id];
        if (!s) return false;
        if (s.expiresAt <= now) { delete state.byId[id]; return false; }
        return true;
      });
    },
    // Called by socket handler when an incoming envelope carries storyId.
    ingestIncomingStory(state, a: PayloadAction<Story>) {
      const s = a.payload;
      if (s.expiresAt <= Date.now()) return;
      state.byId[s.id] = s;
      if (!state.order.includes(s.id)) state.order.unshift(s.id);
    },
  },
});

export const { addStory, markViewed, sweepExpired, ingestIncomingStory } = storiesSlice.actions;
export default storiesSlice.reducer;
