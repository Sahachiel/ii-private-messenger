import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { AttestationToken, DeviceState } from './types';
import { KC } from '@services/keychain';

async function getSignKey(): Promise<nacl.SignKeyPair | null> {
  const r = await KC.getIdentity();
  if (!r || !r.password) return null;
  const m = JSON.parse(r.password);
  const boxSecret = util.decodeBase64(m.priv);
  // Derive sign keypair from box secret via hash (consistent with signal.ts padTo64)
  const seed = nacl.hash(boxSecret).slice(0, 32);
  return nacl.sign.keyPair.fromSeed(seed);
}

export async function makeAttestation(state: DeviceState, healthScore: number, enabledCats: string[]): Promise<AttestationToken | null> {
  const sk = await getSignKey();
  if (!sk) return null;
  const ts = Date.now();
  const sortedCats = [...enabledCats].sort().join(',');
  const digest = util.encodeBase64(nacl.hash(util.decodeUTF8(sortedCats)).slice(0, 16));
  const body = `${ts}|${state}|${healthScore}|${digest}`;
  const sig = nacl.sign.detached(util.decodeUTF8(body), sk.secretKey);
  return {
    ts, state, healthScore,
    detectorDigest: digest,
    sig: util.encodeBase64(sig),
  };
}

export function verifyAttestation(tok: AttestationToken, senderSignPubB64: string): boolean {
  try {
    const body = `${tok.ts}|${tok.state}|${tok.healthScore}|${tok.detectorDigest}`;
    return nacl.sign.detached.verify(
      util.decodeUTF8(body),
      util.decodeBase64(tok.sig),
      util.decodeBase64(senderSignPubB64),
    );
  } catch { return false; }
}

export async function getMySignPublicKeyB64(): Promise<string | null> {
  const sk = await getSignKey();
  if (!sk) return null;
  return util.encodeBase64(sk.publicKey);
}
