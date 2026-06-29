import { IpcMain } from 'electron';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import keytar from 'keytar';

const SERVICE = 'ii-private-messenger';
const IDENTITY_ACC = 'identity';

interface LocalIdentity { pub: string; priv: string; regId: number }

const peerKeys = new Map<string, Uint8Array>();
let identityCache: { kp: nacl.BoxKeyPair; regId: number } | null = null;

async function getOrCreateIdentity(): Promise<{ kp: nacl.BoxKeyPair; regId: number }> {
  if (identityCache) return identityCache;
  const stored = await keytar.getPassword(SERVICE, IDENTITY_ACC);
  if (stored) {
    const m = JSON.parse(stored) as LocalIdentity;
    identityCache = {
      kp: { publicKey: util.decodeBase64(m.pub), secretKey: util.decodeBase64(m.priv) },
      regId: m.regId,
    };
    return identityCache;
  }
  const kp = nacl.box.keyPair();
  const regId = Math.floor(Math.random() * 16380) + 1;
  await keytar.setPassword(SERVICE, IDENTITY_ACC, JSON.stringify({
    pub: util.encodeBase64(kp.publicKey),
    priv: util.encodeBase64(kp.secretKey),
    regId,
  } satisfies LocalIdentity));
  identityCache = { kp, regId };
  return identityCache;
}

export function registerCryptoIpc(ipc: IpcMain): void {
  ipc.handle('crypto.generateIdentity', async () => {
    const id = await getOrCreateIdentity();
    // Also build the matching Ed25519 signing key (for attestation compat with mobile)
    const seed = nacl.hash(id.kp.secretKey).slice(0, 32);
    const signKp = nacl.sign.keyPair.fromSeed(seed);
    const signedPriv = nacl.box.keyPair();
    const signature = nacl.sign.detached(signedPriv.publicKey, signKp.secretKey);
    return {
      identityPublicKey: util.encodeBase64(id.kp.publicKey),
      signedPreKey: {
        keyId: 1,
        publicKey: util.encodeBase64(signedPriv.publicKey),
        signature: util.encodeBase64(signature),
      },
      registrationId: id.regId,
      oneTimePreKeys: [{ keyId: 1, publicKey: util.encodeBase64(nacl.box.keyPair().publicKey) }],
    };
  });

  ipc.handle('crypto.getIdentityPub', async () => {
    const id = await getOrCreateIdentity();
    return util.encodeBase64(id.kp.publicKey);
  });

  ipc.handle('crypto.buildSession', async (_e, peer: string, theirPubB64: string) => {
    peerKeys.set(peer, util.decodeBase64(theirPubB64));
    return true;
  });

  ipc.handle('crypto.encrypt', async (_e, peer: string, plaintext: string) => {
    const id = await getOrCreateIdentity();
    const peerPub = peerKeys.get(peer);
    if (!peerPub) throw new Error(`no session with ${peer}`);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const msg = util.decodeUTF8(plaintext);
    const cipher = nacl.box(msg, nonce, peerPub, id.kp.secretKey);
    const out = new Uint8Array(nonce.length + cipher.length);
    out.set(nonce, 0); out.set(cipher, nonce.length);
    return { type: 1, ciphertext: util.encodeBase64(out) };
  });

  ipc.handle('crypto.decrypt', async (_e, peer: string, cipherB64: string) => {
    const id = await getOrCreateIdentity();
    const peerPub = peerKeys.get(peer);
    if (!peerPub) throw new Error(`no session with ${peer}`);
    const raw = util.decodeBase64(cipherB64);
    const nonce = raw.slice(0, nacl.box.nonceLength);
    const cipher = raw.slice(nacl.box.nonceLength);
    const plain = nacl.box.open(cipher, nonce, peerPub, id.kp.secretKey);
    if (!plain) throw new Error('decryption failed');
    return util.encodeUTF8(plain);
  });
}
