/**
 * Double Ratchet (Signal) — canale pairwise con FORWARD SECRECY e POST-COMPROMISE SECURITY.
 *
 * Sostituisce il vecchio nacl.box statico (nessuna PFS). Algoritmo canonico:
 *   - DH ratchet su X25519 (nacl.box.before → segreto condiviso simmetrico)
 *   - root chain + sending/receiving chain (KDF via SHA-512)
 *   - AEAD per messaggio (nacl.secretbox / XSalsa20-Poly1305)
 *   - skipped message keys (out-of-order) con cap
 *
 * Bootstrap X3DH semplificato ma corretto: SK = DH(IK_a, IK_b) (simmetrico); l'initiator
 * (Alice) usa la SignedPreKey del destinatario come DHr iniziale; il responder (Bob) usa la
 * propria SignedPreKey come keypair iniziale e ricava SK dall'IK del mittente nell'header.
 *
 * Modulo PURO (solo tweetnacl + stringhe base64) → testabile in Node. Lo stato è
 * JSON-serializzabile per la persistenza.
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };
const MAX_SKIP = 256;

export interface DRHeader { dh: string; pn: number; n: number; ik: string }

export interface DRSession {
  rk: string;
  dhsPub: string; dhsSec: string;
  dhrPub: string | null;
  cks: string | null; ckr: string | null;
  ns: number; nr: number; pn: number;
  ikPub: string;                       // mio IK pubblico (va nell'header per il bootstrap del peer)
  skipped: Record<string, string>;     // `${dhrPub}:${n}` → message key b64
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o;
}
/** Segreto DH condiviso (simmetrico) tra una mia chiave segreta e una pubblica del peer. */
function dh(secB64: string, pubB64: string): Uint8Array {
  return nacl.box.before(b64.dec(pubB64), b64.dec(secB64));
}
/** KDF root: da (rk, dhOut) deriva nuovo root key + chain key (SHA-512 → 64B). */
function kdfRK(rkB64: string, dhOut: Uint8Array): { rk: string; ck: string } {
  const h = nacl.hash(concat(b64.dec(rkB64), dhOut));
  return { rk: b64.enc(h.slice(0, 32)), ck: b64.enc(h.slice(32, 64)) };
}
/** KDF chain: da ck deriva message key + nuovo chain key (label 0x01/0x02). */
function kdfCK(ckB64: string): { ck: string; mk: Uint8Array } {
  const ck = b64.dec(ckB64);
  const mk = nacl.hash(concat(Uint8Array.of(0x01), ck)).slice(0, 32);
  const nck = nacl.hash(concat(Uint8Array.of(0x02), ck)).slice(0, 32);
  return { ck: b64.enc(nck), mk };
}
function encryptMsg(mk: Uint8Array, plaintext: string): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ct = nacl.secretbox(util.decodeUTF8(plaintext), nonce, mk);
  return b64.enc(concat(nonce, ct));
}
function decryptMsg(mk: Uint8Array, packedB64: string): string {
  const raw = b64.dec(packedB64);
  const nonce = raw.slice(0, nacl.secretbox.nonceLength);
  const ct = raw.slice(nacl.secretbox.nonceLength);
  const pt = nacl.secretbox.open(ct, nonce, mk);
  if (!pt) throw new Error('dr_decrypt_failed');
  return util.encodeUTF8(pt);
}

/** Initiator (Alice): conosce IK e SignedPreKey del destinatario. */
export function initAlice(myIKSec: string, myIKPub: string, theirIKPub: string, theirSPKPub: string): DRSession {
  const sk = b64.enc(dh(myIKSec, theirIKPub));
  const dhs = nacl.box.keyPair();
  const dhsPub = b64.enc(dhs.publicKey); const dhsSec = b64.enc(dhs.secretKey);
  const { rk, ck } = kdfRK(sk, dh(dhsSec, theirSPKPub));
  return { rk, dhsPub, dhsSec, dhrPub: theirSPKPub, cks: ck, ckr: null, ns: 0, nr: 0, pn: 0, ikPub: myIKPub, skipped: {} };
}

/** Responder (Bob): usa la propria SignedPreKey come keypair iniziale; SK dall'IK nel header. */
export function initBob(myIKSec: string, myIKPub: string, mySPKPub: string, mySPKSec: string, header: DRHeader): DRSession {
  const sk = b64.enc(dh(myIKSec, header.ik));
  return { rk: sk, dhsPub: mySPKPub, dhsSec: mySPKSec, dhrPub: null, cks: null, ckr: null, ns: 0, nr: 0, pn: 0, ikPub: myIKPub, skipped: {} };
}

export function drEncrypt(s: DRSession, plaintext: string): { header: DRHeader; ct: string } {
  if (!s.cks) throw new Error('no_sending_chain');
  const { ck, mk } = kdfCK(s.cks);
  s.cks = ck;
  const header: DRHeader = { dh: s.dhsPub, pn: s.pn, n: s.ns, ik: s.ikPub };
  s.ns += 1;
  return { header, ct: encryptMsg(mk, plaintext) };
}

function skipMessageKeys(s: DRSession, until: number): void {
  if (s.ckr === null) return;
  if (s.nr + MAX_SKIP < until) throw new Error('too_many_skipped');
  while (s.nr < until) {
    const { ck, mk } = kdfCK(s.ckr);
    s.skipped[`${s.dhrPub}:${s.nr}`] = b64.enc(mk);
    s.ckr = ck; s.nr += 1;
  }
  // cap finestra skipped
  const keys = Object.keys(s.skipped);
  if (keys.length > MAX_SKIP) keys.slice(0, keys.length - MAX_SKIP).forEach((k) => delete s.skipped[k]);
}

function dhRatchet(s: DRSession, header: DRHeader): void {
  s.pn = s.ns; s.ns = 0; s.nr = 0;
  s.dhrPub = header.dh;
  const r1 = kdfRK(s.rk, dh(s.dhsSec, s.dhrPub)); s.rk = r1.rk; s.ckr = r1.ck;
  const kp = nacl.box.keyPair();
  s.dhsPub = b64.enc(kp.publicKey); s.dhsSec = b64.enc(kp.secretKey);
  const r2 = kdfRK(s.rk, dh(s.dhsSec, s.dhrPub)); s.rk = r2.rk; s.cks = r2.ck;
}

export function drDecrypt(s: DRSession, header: DRHeader, ct: string): string {
  const skKey = `${header.dh}:${header.n}`;
  if (s.skipped[skKey]) {
    const mk = b64.dec(s.skipped[skKey]);
    delete s.skipped[skKey];
    return decryptMsg(mk, ct);
  }
  if (header.dh !== s.dhrPub) {
    skipMessageKeys(s, header.pn);
    dhRatchet(s, header);
  }
  skipMessageKeys(s, header.n);
  if (!s.ckr) throw new Error('no_receiving_chain');
  const { ck, mk } = kdfCK(s.ckr);
  s.ckr = ck; s.nr += 1;
  return decryptMsg(mk, ct);
}
