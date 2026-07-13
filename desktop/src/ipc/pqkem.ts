import util from 'tweetnacl-util';

/**
 * ML-KEM-768 (FIPS 203) per l'accordo di chiave ibrido post-quantum, allineato a
 * mobile/src/services/pqkem.ts. @noble/post-quantum è ESM-only e Electron (Node 20) non fa
 * require(ESM): usiamo un dynamic import REALE. Il Function-trick evita che tsc (module=commonjs)
 * lo transpili in require(). Caricamento lazy + cache del modulo.
 */
const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };
const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<{ ml_kem768: MlKem }>;

interface MlKem {
  keygen(): { publicKey: Uint8Array; secretKey: Uint8Array };
  encapsulate(pub: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array };
  decapsulate(ct: Uint8Array, sec: Uint8Array): Uint8Array;
}
let cached: MlKem | null = null;
async function mlkem(): Promise<MlKem> {
  if (!cached) cached = (await dynImport('@noble/post-quantum/ml-kem.js')).ml_kem768;
  return cached;
}

export async function kemKeygen(): Promise<{ pub: string; sec: string }> {
  const k = await mlkem();
  const kp = k.keygen();
  return { pub: b64.enc(kp.publicKey), sec: b64.enc(kp.secretKey) };
}
export async function kemEncapsulate(peerPubB64: string): Promise<{ ct: string; ss: string }> {
  const k = await mlkem();
  const { cipherText, sharedSecret } = k.encapsulate(b64.dec(peerPubB64));
  return { ct: b64.enc(cipherText), ss: b64.enc(sharedSecret) };
}
export async function kemDecapsulate(ctB64: string, mySecB64: string): Promise<string> {
  const k = await mlkem();
  return b64.enc(k.decapsulate(b64.dec(ctB64), b64.dec(mySecB64)));
}
