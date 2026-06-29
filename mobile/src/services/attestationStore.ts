import { appKv } from './keychain';
import { PeerTrust, TrustLevel } from '../types';

// Per-peer trust snapshot, persisted in MMKV unencrypted (public metadata).
// Updated whenever we decrypt an incoming envelope that carries an attestation.

const KEY = 'xsec.peerTrust.v1';

type Store = Record<string, PeerTrust>;

function load(): Store {
  const raw = appKv.getString(KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as Store; } catch { return {}; }
}

function save(s: Store): void { appKv.set(KEY, JSON.stringify(s)); }

export function upsertPeerTrust(peerId: string, state: TrustLevel, score: number, detectorDigest?: string): void {
  const s = load();
  s[peerId] = { peerId, level: state, score, lastUpdated: Date.now(), detectorDigest };
  save(s);
}

export function getPeerTrust(peerId: string): PeerTrust | undefined {
  return load()[peerId];
}

export function getPeerTrustLevel(peerId: string): TrustLevel {
  return load()[peerId]?.level ?? 'unknown';
}

export function allPeerTrust(): PeerTrust[] {
  return Object.values(load());
}

export function clearPeerTrust(): void { appKv.delete(KEY); }
