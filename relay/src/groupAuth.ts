/**
 * Enforcement dell'appartenenza ai gruppi lato relay (Blocco C).
 *
 * Il client allega a ogni messaggio di gruppo una MEMBERSHIP-CAPABILITY firmata dal backend
 * (token Ed25519 con { t:'cap', gid, uid, epoch, exp }). Il relay:
 *   1) verifica la firma con la chiave pubblica del backend (recuperata via endpoint interno);
 *   2) controlla che la capability appartenga al mittente autenticato e al gid giusto;
 *   3) controlla l'epoch contro lo snapshot membri (cache Redis, TTL breve) — una capability
 *      di un'epoca vecchia (es. dopo un kick) viene RIFIUTATA → forward secrecy verso ex-membri;
 *   4) consegna SOLO ai membri attivi (niente leak verso non-membri).
 *
 * Questa è difesa-in-profondità: la confidenzialità vera è garantita dalle Sender Keys lato
 * client (Blocco B); qui impediamo a un non-membro di iniettare o ricevere traffico del gruppo.
 */
import axios from 'axios';
import crypto from 'crypto';
import { getRedisClient } from './store';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://backend:3000';
const INTER_NODE_SECRET = process.env.INTER_NODE_SECRET ?? '';
const MEMBERS_TTL_SEC = 30;

let pubKey: crypto.KeyObject | null = null;
let pubKeyAt = 0;
const PUBKEY_TTL_MS = 10 * 60 * 1000; // refetch periodico per gestire la rotazione della signing key

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// FIX (audit): la pubkey non era mai invalidata → una rotazione lato backend rompeva il relay
// finché non riavviato. Ora: TTL + ricarica forzata su fallimento di verifica.
async function loadSigningKey(force = false): Promise<crypto.KeyObject | null> {
  if (pubKey && !force && Date.now() - pubKeyAt < PUBKEY_TTL_MS) return pubKey;
  try {
    const resp = await axios.get<{ data?: { public_key_b64?: string } }>(
      `${BACKEND_URL}/api/groups/signing-key`,
      { headers: { 'X-Internal-Secret': INTER_NODE_SECRET }, timeout: 5000 },
    );
    const b64 = resp.data?.data?.public_key_b64;
    if (!b64) return pubKey;
    const raw = Buffer.from(b64, 'base64'); // Ed25519 raw 32 byte
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    pubKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    pubKeyAt = Date.now();
    return pubKey;
  } catch (err) {
    console.error('[relay] loadSigningKey:', (err as Error).message);
    return pubKey; // su errore di rete mantieni l'ultima chiave valida (no downgrade silenzioso)
  }
}

export interface Capability { gid: string; uid: string; epoch: number; exp: number }

export async function verifyCapability(cap: string): Promise<Capability | null> {
  let key = await loadSigningKey();
  if (!key) return null;
  const parts = cap.split('.');
  if (parts.length !== 2) return null;
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(parts[0]), key, fromB64url(parts[1])); } catch { ok = false; }
  if (!ok) {
    // Possibile rotazione della chiave backend: ricarica forzata e riprova UNA volta.
    key = await loadSigningKey(true);
    if (!key) return null;
    try { ok = crypto.verify(null, Buffer.from(parts[0]), key, fromB64url(parts[1])); } catch { return null; }
    if (!ok) return null;
  }
  let p: { t?: string; gid?: string; uid?: string; epoch?: number; exp?: number };
  try { p = JSON.parse(fromB64url(parts[0]).toString('utf8')); } catch { return null; }
  if (p.t !== 'cap') return null;
  if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
  return { gid: String(p.gid), uid: String(p.uid), epoch: Number(p.epoch), exp: p.exp };
}

interface Snapshot { epoch: number; members: string[] }

export async function getGroupMembers(gid: string, force = false): Promise<Snapshot | null> {
  const cacheKey = `groupmembers:${gid}`;
  if (!force) {
    try {
      const c = await getRedisClient().get(cacheKey);
      if (c) return JSON.parse(c) as Snapshot;
    } catch { /* fallthrough */ }
  }
  try {
    const resp = await axios.get<{ data?: Snapshot }>(
      `${BACKEND_URL}/api/groups/${encodeURIComponent(gid)}/members-internal`,
      { headers: { 'X-Internal-Secret': INTER_NODE_SECRET }, timeout: 5000 },
    );
    const data = resp.data?.data;
    if (!data) return null;
    const snap: Snapshot = { epoch: Number(data.epoch), members: data.members };
    try { await getRedisClient().set(cacheKey, JSON.stringify(snap), { EX: MEMBERS_TTL_SEC }); } catch { /* ignore */ }
    return snap;
  } catch (err) {
    console.error('[relay] getGroupMembers:', (err as Error).message);
    return null;
  }
}

export type GroupVerdict =
  | { ok: true; members: string[]; epoch: number }
  | { ok: false; reason: string };

export async function authorizeGroup(fromUserId: string, gid: string, cap?: string): Promise<GroupVerdict> {
  if (!cap) return { ok: false, reason: 'cap_required' };
  const c = await verifyCapability(cap);
  if (!c) return { ok: false, reason: 'cap_invalid' };
  if (c.gid !== gid || c.uid !== fromUserId) return { ok: false, reason: 'cap_mismatch' };
  let snap = await getGroupMembers(gid);
  // Se l'epoch della capability non combacia con la cache, prova UN refresh forzato (la cache
  // potrebbe essere stantia dopo un join/leave appena avvenuto).
  if (snap && c.epoch !== snap.epoch) snap = await getGroupMembers(gid, true);
  if (!snap) return { ok: false, reason: 'group_unavailable' };
  if (c.epoch !== snap.epoch) return { ok: false, reason: 'epoch_stale' };
  if (!snap.members.includes(fromUserId)) return { ok: false, reason: 'not_member' };
  return { ok: true, members: snap.members, epoch: snap.epoch };
}
