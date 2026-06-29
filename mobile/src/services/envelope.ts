// Envelope v2 — JSON payload serialized INSIDE the existing E2EE ciphertext.
// Backward compatible: v1 clients see the JSON as raw text body; v2+ clients
// parse .v=2 and unlock kind/reply/reactions/media/ttl/groupId/storyId semantics.
//
// The relay still receives only the opaque NaCl box — the server learns nothing
// beyond (from, to, size, timestamp) as with v1.

import { MediaRef, MessageType, ReplyRef, Reactions } from '../types';

export const ENVELOPE_VERSION = 2;

export type EnvelopeKind = MessageType; // extended union

export interface EnvelopeV2 {
  v: 2;
  kind: EnvelopeKind;
  body: string;
  media?: MediaRef;
  replyTo?: ReplyRef;
  // Reaction update: senderId reacts `emoji` on `targetId`. If `remove` → unset.
  reactTarget?: { id: string; emoji: string; remove?: boolean };
  // Client-side TTL. Receiver honors: delete local row at this timestamp.
  ttlMs?: number;
  // Group fan-out: same clientMsgId sent N times, one per member.
  groupId?: string;
  // Epoch della Sender Key con cui è cifrato il messaggio di gruppo (rotazione su join/leave).
  epoch?: number;
  // Nome del gruppo cifrato E2EE: i nuovi membri lo apprendono qui (il server non lo conosce).
  gname?: string;
  clientMsgId?: string;
  // Story broadcast: same clientMsgId sent to all contacts, expires at.
  storyId?: string;
  storyExpiresAt?: number;
  storyKind?: 'image' | 'text';
  storyBgColor?: string;
  // Attestation (XSEC-MTD): mirror of `orgReport.attestation` piggy-backed per msg.
  attestation?: {
    ts: number;
    state: 'secure' | 'warning' | 'compromised';
    score: number;
    detectorDigest?: string;
    sig?: string;
  };
  // Read-receipt proxy (for stories + group).
  ack?: { messageId: string; kind: 'delivered' | 'read' | 'story_view' };
  // System notice rendered verbatim (group created, member joined, etc.).
  systemText?: string;
}

export function encodeEnvelope(e: EnvelopeV2): string {
  return JSON.stringify(e);
}

// Decode an incoming plaintext body. If it's not a v2 JSON envelope, treat it
// as a v1 plain-text body (back-compat with v0.2.4 and older).
export function decodeEnvelope(plain: string): EnvelopeV2 {
  const trimmed = plain.trim();
  if (!trimmed.startsWith('{')) {
    return { v: 2, kind: 'text', body: plain };
  }
  try {
    const obj = JSON.parse(trimmed) as Partial<EnvelopeV2>;
    if (obj && obj.v === 2 && typeof obj.kind === 'string') {
      return { ...obj, body: obj.body ?? '' } as EnvelopeV2;
    }
  } catch {
    // fall through
  }
  return { v: 2, kind: 'text', body: plain };
}
