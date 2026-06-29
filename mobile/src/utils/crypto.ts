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

/** Safety number — 60-digit fingerprint of two identity keys (Signal style). */
export function safetyNumber(myIdKeyB64: string, theirIdKeyB64: string): string {
  const a = sha256Hex(myIdKeyB64);
  const b = sha256Hex(theirIdKeyB64);
  const combined = sha256Hex(a + b);
  const digits = BigInt('0x' + combined.slice(0, 40)).toString().padStart(60, '0').slice(0, 60);
  return digits.match(/.{5}/g)!.join(' ');
}
