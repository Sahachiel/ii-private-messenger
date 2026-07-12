import { IpcMain } from 'electron';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import keytar from 'keytar';
import Store from 'electron-store';
import { initAlice, initBob, drEncrypt, drDecrypt, DRSession, DRHeader } from './doubleRatchet';

// E2EE pairwise DESKTOP — allineato a mobile/src/services/signal.ts (Double Ratchet, PFS/PCS).
// Formato identico al mobile => messaggi/file/vocali interoperano telefono<->PC.
// Identità in keytar {pub,priv,regId}; SPK+sessioni+pending in electron-store (come appKv/MMKV mobile).

const SERVICE = 'ii-private-messenger';
const IDENTITY_ACC = 'identity';
const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };

interface LocalIdentity { pub: string; priv: string; regId: number }
interface SPK { pub: string; sec: string; keyId: number }

const drStore = new Store<{
  spk?: SPK;
  sessions?: Record<string, DRSession>;
  pending?: Record<string, { ik: string; spk: string }>;
}>({ name: 'dr-state' });

let identityCache: { pub: Uint8Array; sec: Uint8Array; regId: number } | null = null;

async function getIdentity(): Promise<{ pub: Uint8Array; sec: Uint8Array; regId: number }> {
  if (identityCache) return identityCache;
  const stored = await keytar.getPassword(SERVICE, IDENTITY_ACC);
  if (stored) {
    const m = JSON.parse(stored) as LocalIdentity;
    identityCache = { pub: b64.dec(m.pub), sec: b64.dec(m.priv), regId: m.regId };
    return identityCache;
  }
  const kp = nacl.box.keyPair();
  const regId = Math.floor(Math.random() * 16380) + 1;
  const rec: LocalIdentity = { pub: b64.enc(kp.publicKey), priv: b64.enc(kp.secretKey), regId };
  await keytar.setPassword(SERVICE, IDENTITY_ACC, JSON.stringify(rec));
  identityCache = { pub: kp.publicKey, sec: kp.secretKey, regId };
  return identityCache;
}

function ensureSPK(): SPK {
  const existing = drStore.get('spk');
  if (existing) return existing;
  const kp = nacl.box.keyPair();
  const spk: SPK = { pub: b64.enc(kp.publicKey), sec: b64.enc(kp.secretKey), keyId: 1 };
  drStore.set('spk', spk);
  return spk;
}
function signKeyFrom(sec: Uint8Array): nacl.SignKeyPair {
  return nacl.sign.keyPair.fromSeed(nacl.hash(sec).slice(0, 32));
}
function getSessions(): Record<string, DRSession> { return drStore.get('sessions') ?? {}; }
function saveSessions(m: Record<string, DRSession>): void { drStore.set('sessions', m); }
function getPending(): Record<string, { ik: string; spk: string }> { return drStore.get('pending') ?? {}; }
function savePending(m: Record<string, { ik: string; spk: string }>): void { drStore.set('pending', m); }

export function registerCryptoIpc(ipc: IpcMain): void {
  ipc.handle('crypto.generateIdentity', async () => {
    const id = await getIdentity();
    const spk = ensureSPK();
    const signature = nacl.sign.detached(b64.dec(spk.pub), signKeyFrom(id.sec).secretKey);
    return {
      identityPublicKey: b64.enc(id.pub),
      signedPreKey: { keyId: spk.keyId, publicKey: spk.pub, signature: b64.enc(signature) },
      registrationId: id.regId,
      oneTimePreKeys: [{ keyId: 1, publicKey: spk.pub }],
    };
  });

  ipc.handle('crypto.getIdentityPub', async () => b64.enc((await getIdentity()).pub));

  // bundle = { identityPublicKey, signedPreKey: { publicKey, ... } } (da api.getUserKeys)
  ipc.handle('crypto.buildSession', async (_e, peer: string, bundle: any) => {
    const sess = getSessions();
    if (sess[peer]) return true; // sessione Double Ratchet già stabilita
    const ik = bundle?.identityPublicKey;
    const spkPub = bundle?.signedPreKey?.publicKey ?? bundle?.signedPreKey?.public_key;
    if (!ik || !spkPub) throw new Error('bundle incompleto: servono identityPublicKey + signedPreKey.publicKey');
    const p = getPending();
    p[peer] = { ik, spk: spkPub };
    savePending(p);
    return true;
  });

  ipc.handle('crypto.encrypt', async (_e, peer: string, plaintext: string) => {
    const id = await getIdentity();
    const sess = getSessions();
    let s = sess[peer];
    if (!s) {
      const p = getPending()[peer];
      if (!p) throw new Error(`no session with ${peer} — call buildSession first`);
      s = initAlice(b64.enc(id.sec), b64.enc(id.pub), p.ik, p.spk);
    }
    const { header, ct } = drEncrypt(s, plaintext);
    sess[peer] = s; saveSessions(sess);
    return { type: 3, ciphertext: JSON.stringify({ h: header, c: ct }) };
  });

  // ciphertext = la stringa JSON {h,c} (payload.ciphertext lato renderer)
  ipc.handle('crypto.decrypt', async (_e, peer: string, ciphertext: string) => {
    const id = await getIdentity();
    let parsed: { h: DRHeader; c: string };
    try { parsed = JSON.parse(ciphertext); } catch { throw new Error('bad_ciphertext'); }
    const sess = getSessions();
    let s = sess[peer];
    if (!s) {
      const spk = ensureSPK();
      s = initBob(b64.enc(id.sec), b64.enc(id.pub), spk.pub, spk.sec, parsed.h);
    }
    const plain = drDecrypt(s, parsed.h, parsed.c);
    sess[peer] = s; saveSessions(sess);
    return plain;
  });
}
