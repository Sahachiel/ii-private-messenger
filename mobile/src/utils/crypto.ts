import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

export const b64 = {
  enc: (buf: ArrayBufferLike | Uint8Array | Buffer | string): string => {
    if (typeof buf === 'string') return Buffer.from(buf, 'utf8').toString('base64');
    return Buffer.from(buf as any).toString('base64');
  },
  dec: (s: string): Buffer => Buffer.from(s, 'base64'),
  decToBytes: (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64')),
};

export const hex = {
  enc: (buf: Uint8Array | Buffer): string => Buffer.from(buf).toString('hex'),
  dec: (s: string): Buffer => Buffer.from(s, 'hex'),
};

export function randomBytes(n: number): Uint8Array {
  return nacl.randomBytes(n);
}

export function sha256Hex(data: string | Uint8Array): string {
  const wa = typeof data === 'string'
    ? CryptoJS.enc.Utf8.parse(data)
    : CryptoJS.enc.Hex.parse(hex.enc(data));
  return CryptoJS.SHA256(wa).toString();
}

export function hmacSha1Base64(secret: string, msg: string): string {
  return CryptoJS.HmacSHA1(msg, secret).toString(CryptoJS.enc.Base64);
}

export function hmacSha256Hex(secret: string, msg: string): string {
  return CryptoJS.HmacSHA256(msg, secret).toString(CryptoJS.enc.Hex);
}

// Numero di sicurezza (safety number) — impronta a 60 cifre delle due identity key (stile Signal).
// DEVE stare in sync con l'equivalente desktop (ipc/crypto.ts): stesso versione, iterazioni e
// canonicalizzazione, altrimenti mobile e desktop mostrerebbero numeri diversi.
export const SN_VERSION = 'iimsg-sn-v1';
export const SN_ITERATIONS = 1000;

/**
 * FIX (bug precedente): sha256(sha256(mine)+sha256(theirs)) era NON-SIMMETRICO — A e B
 * ottenevano numeri diversi, rendendo la verifica impossibile. Ora le due chiavi sono ORDINATE
 * (canonicalizzazione), con prefisso di versione e hashing iterato (irrigidimento): A e B
 * calcolano lo STESSO valore indipendentemente dall'ordine degli argomenti.
 */
export function computeSafetyNumber(myIdKeyB64: string, theirIdKeyB64: string): string {
  const [k1, k2] = [myIdKeyB64, theirIdKeyB64].sort();
  let h = sha256Hex(`${SN_VERSION}|${k1}|${k2}`);
  for (let i = 1; i < SN_ITERATIONS; i++) h = sha256Hex(h);
  // 12 gruppi da 5 cifre, ciascuno da 20 bit dell'hash → cifre uniformi, senza blocco di zeri.
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += (parseInt(h.slice(i * 5, i * 5 + 5), 16) % 100000).toString().padStart(5, '0');
  }
  return out.match(/.{5}/g)!.join(' ');
}

/** @deprecated usa computeSafetyNumber (simmetrico). Mantenuto come alias. */
export const safetyNumber = computeSafetyNumber;
