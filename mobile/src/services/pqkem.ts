import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import util from 'tweetnacl-util';

/**
 * ML-KEM-768 (FIPS 203, ex-Kyber) — KEM post-quantum per l'accordo di chiave ibrido (PQXDH).
 * Libreria audited @noble/post-quantum. Usa lo stesso PRNG di sistema (react-native-get-random-values,
 * già installato in index.js). Tutte le chiavi/segreti passano come base64.
 *
 * Sizes: publicKey 1184B, secretKey 2400B, ciphertext 1088B, sharedSecret 32B.
 */
const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };

export function kemKeygen(): { pub: string; sec: string } {
  const kp = ml_kem768.keygen();
  return { pub: b64.enc(kp.publicKey), sec: b64.enc(kp.secretKey) };
}

/** Alice: incapsula verso la chiave KEM pubblica del destinatario → { ciphertext, sharedSecret }. */
export function kemEncapsulate(peerPubB64: string): { ct: string; ss: string } {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(b64.dec(peerPubB64));
  return { ct: b64.enc(cipherText), ss: b64.enc(sharedSecret) };
}

/** Bob: decapsula il ciphertext con la propria chiave KEM segreta → sharedSecret (identico ad Alice). */
export function kemDecapsulate(ctB64: string, mySecB64: string): string {
  return b64.enc(ml_kem768.decapsulate(b64.dec(ctB64), b64.dec(mySecB64)));
}
