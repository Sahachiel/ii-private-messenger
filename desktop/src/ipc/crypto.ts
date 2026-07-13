import { IpcMain } from 'electron';
import { createHash } from 'crypto';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import keytar from 'keytar';
import Store from 'electron-store';
import axios from 'axios';
import { initAlice, initBob, drEncrypt, drDecrypt, DRSession, DRHeader } from './doubleRatchet';
import { kemKeygen, kemEncapsulate, kemDecapsulate } from './pqkem';
import { getValidToken } from './api';

const API_BASE = 'https://iimsg-api.oleven-group.com/api';
const OTP_LOW = 5;

// Numero di sicurezza — DEVE restare in sync con mobile/src/utils/crypto.ts (stessa versione,
// iterazioni, canonicalizzazione), altrimenti telefono e desktop mostrerebbero numeri diversi.
const SN_VERSION = 'iimsg-sn-v1';
const SN_ITERATIONS = 1000;
function sn_sha256hex(s: string): string { return createHash('sha256').update(s, 'utf8').digest('hex'); }
function computeSafetyNumber(myIk: string, theirIk: string): string {
  const [k1, k2] = [myIk, theirIk].sort();
  let h = sn_sha256hex(`${SN_VERSION}|${k1}|${k2}`);
  for (let i = 1; i < SN_ITERATIONS; i++) h = sn_sha256hex(h);
  // 12 gruppi da 5 cifre, ciascuno da 20 bit dell'hash → cifre uniformi, senza blocco di zeri.
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += (parseInt(h.slice(i * 5, i * 5 + 5), 16) % 100000).toString().padStart(5, '0');
  }
  return (out.match(/.{5}/g) as string[]).join(' ');
}

// E2EE pairwise DESKTOP — allineato a mobile/src/services/signal.ts (Double Ratchet, PFS/PCS).
// Formato identico al mobile => messaggi/file/vocali interoperano telefono<->PC.
// Identità in keytar {pub,priv,regId}; SPK+sessioni+pending in electron-store (come appKv/MMKV mobile).

const SERVICE = 'ii-private-messenger';
const IDENTITY_ACC = 'identity';
const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };

/**
 * Messaggio firmato della SignedPreKey: SPK || KEM post-quantum (byte grezzi). Legare KEM+SPK in
 * un'unica firma impedisce lo strip/sostituzione della chiave post-quantum (downgrade). IDENTICO al
 * mobile (signal.ts) → interoperabilità telefono↔PC.
 */
function spkSignedMessage(spkPubB64: string, kemPubB64?: string): Uint8Array {
  const spk = b64.dec(spkPubB64);
  if (!kemPubB64) return spk;
  const kem = b64.dec(kemPubB64);
  const out = new Uint8Array(spk.length + kem.length);
  out.set(spk, 0); out.set(kem, spk.length);
  return out;
}

interface LocalIdentity { pub: string; priv: string; regId: number }
interface SPK { pub: string; sec: string; keyId: number }

type PendingBundle = { ik: string; spk: string; otp?: { keyId: number; pub: string }; kemPub?: string };
const drStore = new Store<{
  spk?: SPK;
  sessions?: Record<string, DRSession>;
  pending?: Record<string, PendingBundle>;
  otpSecrets?: Record<string, string>; // keyId -> secretB64 (one-time prekey da consumare)
  otpNextId?: number;
  kem?: { pub: string; sec: string };  // chiave ML-KEM-768 (post-quantum) del dispositivo
}>({ name: 'dr-state' });
const OTP_BATCH = 20;

/** Chiave ML-KEM-768 stabile del dispositivo (post-quantum); il pubblico va nel bundle. */
async function ensureKem(): Promise<{ pub: string; sec: string }> {
  const existing = drStore.get('kem');
  if (existing) return existing;
  const kp = await kemKeygen();
  drStore.set('kem', kp);
  return kp;
}

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
function getPending(): Record<string, PendingBundle> { return drStore.get('pending') ?? {}; }
function savePending(m: Record<string, PendingBundle>): void { drStore.set('pending', m); }

/** Genera N one-time prekey REALI e distinte: salva i segreti, ritorna i pubblici. */
function mintOneTimePreKeys(n: number): Array<{ keyId: number; publicKey: string }> {
  const secrets = drStore.get('otpSecrets') ?? {};
  let nextId = drStore.get('otpNextId') ?? 2;
  const out: Array<{ keyId: number; publicKey: string }> = [];
  for (let i = 0; i < n; i++) {
    const kp = nacl.box.keyPair();
    const keyId = nextId++;
    secrets[String(keyId)] = b64.enc(kp.secretKey);
    out.push({ keyId, publicKey: b64.enc(kp.publicKey) });
  }
  drStore.set('otpSecrets', secrets);
  drStore.set('otpNextId', nextId);
  return out;
}

/** Se le OTP disponibili scendono sotto la soglia, rigenera e ricarica i pubblici sul server (come mobile). */
async function replenishIfLow(): Promise<void> {
  const remaining = Object.keys(drStore.get('otpSecrets') ?? {}).length;
  if (remaining >= OTP_LOW) return;
  try {
    const fresh = mintOneTimePreKeys(OTP_BATCH);
    const t = await getValidToken();
    if (!t) return;
    await axios.post(`${API_BASE}/users/me/prekeys/replenish`,
      { one_time_prekeys: fresh.map((k) => ({ key_id: k.keyId, public_key: k.publicKey })) },
      { headers: { Authorization: `Bearer ${t}` } });
  } catch { /* riproverà al prossimo consumo */ }
}

export function registerCryptoIpc(ipc: IpcMain): void {
  ipc.handle('crypto.generateIdentity', async () => {
    const id = await getIdentity();
    const spk = ensureSPK();
    const kem = await ensureKem();
    const sk = signKeyFrom(id.sec);
    // ANTI-DOWNGRADE PQ: firmiamo SPK+KEM insieme e pubblichiamo la verify-key Ed25519.
    const signature = nacl.sign.detached(spkSignedMessage(spk.pub, kem.pub), sk.secretKey);
    return {
      identityPublicKey: b64.enc(id.pub),
      // kemPublicKey (ML-KEM) e signPublicKey (verify-key) viaggiano nel blob signed_prekey: nessuna modifica schema backend.
      signedPreKey: { keyId: spk.keyId, publicKey: spk.pub, signature: b64.enc(signature), kemPublicKey: kem.pub, signPublicKey: b64.enc(sk.publicKey) },
      registrationId: id.regId,
      // X3DH COMPLETO: one-time prekey vere e distinte (i segreti restano su questo dispositivo).
      oneTimePreKeys: mintOneTimePreKeys(OTP_BATCH),
    };
  });

  ipc.handle('crypto.getIdentityPub', async () => b64.enc((await getIdentity()).pub));

  // Numero di sicurezza con l'identità del peer (b64). Stesso algoritmo del mobile → i numeri coincidono.
  ipc.handle('crypto.safetyNumber', async (_e, theirIk: string) => {
    const myIk = b64.enc((await getIdentity()).pub);
    return computeSafetyNumber(myIk, theirIk);
  });

  // bundle = { identityPublicKey, signedPreKey: { publicKey, ... } } (da api.getUserKeys)
  ipc.handle('crypto.buildSession', async (_e, peer: string, bundle: any) => {
    const sess = getSessions();
    if (sess[peer]) return true; // sessione Double Ratchet già stabilita
    const ik = bundle?.identityPublicKey;
    const spkPub = bundle?.signedPreKey?.publicKey ?? bundle?.signedPreKey?.public_key;
    if (!ik || !spkPub) throw new Error('bundle incompleto: servono identityPublicKey + signedPreKey.publicKey');
    // Il backend consegna UNA one-time prekey non usata: la conserviamo per fonderla nell'handshake.
    const otpRaw = bundle?.oneTimePreKey;
    const otpKeyId = otpRaw ? (otpRaw.keyId ?? otpRaw.key_id) : undefined;
    // Scarta il placeholder legacy keyId===1 (senza segreto lato destinatario) → eviterebbe la
    // divergenza dell'handshake ibrido. Vedi mobile signal.ts.
    const otp = otpRaw && otpKeyId !== 1 ? { keyId: otpKeyId, pub: otpRaw.publicKey ?? otpRaw.public_key } : undefined;
    let kemPub = bundle?.signedPreKey?.kemPublicKey ?? bundle?.signedPreKey?.kem_public_key;
    // ANTI-DOWNGRADE PQ (come mobile): la KEM deve essere firmata (spk||kem) dalla verify-key del
    // bundle; se firma assente o non valida → scartiamo la KEM e usiamo l'handshake classico.
    if (kemPub) {
      const sig = bundle?.signedPreKey?.signature;
      const signPub = bundle?.signedPreKey?.signPublicKey ?? bundle?.signedPreKey?.sign_public_key;
      let ok = false;
      if (sig && signPub) {
        try { ok = nacl.sign.detached.verify(spkSignedMessage(spkPub, kemPub), b64.dec(sig), b64.dec(signPub)); } catch { ok = false; }
      }
      if (!ok) kemPub = undefined;
    }
    const p = getPending();
    p[peer] = { ik, spk: spkPub, otp: otp && otp.keyId != null && otp.pub ? otp : undefined, kemPub };
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
      // Post-quantum: incapsula verso la chiave KEM del destinatario e fondi il segreto nell'handshake.
      let pqSecret: string | undefined; let pqCt: string | undefined;
      if (p.kemPub) { const enc = await kemEncapsulate(p.kemPub); pqCt = enc.ct; pqSecret = enc.ss; }
      s = initAlice(b64.enc(id.sec), b64.enc(id.pub), p.ik, p.spk, p.otp, pqSecret, pqCt);
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
      // Se il mittente ha usato una one-time prekey, recuperiamo il segreto, lo usiamo e lo
      // DISTRUGGIAMO (monouso).
      let otpSec: string | undefined;
      const otpId = (parsed.h as DRHeader).otpId;
      if (otpId != null) {
        const secrets = drStore.get('otpSecrets') ?? {};
        otpSec = secrets[String(otpId)];
        if (otpSec) { delete secrets[String(otpId)]; drStore.set('otpSecrets', secrets); void replenishIfLow(); }
      }
      // Post-quantum: decapsula il ciphertext ML-KEM con la nostra chiave KEM.
      let pqSecret: string | undefined;
      const pqct = (parsed.h as DRHeader).pqct;
      if (pqct) { try { pqSecret = await kemDecapsulate(pqct, (await ensureKem()).sec); } catch { /* KEM assente */ } }
      s = initBob(b64.enc(id.sec), b64.enc(id.pub), spk.pub, spk.sec, parsed.h, otpSec, pqSecret);
    }
    const plain = drDecrypt(s, parsed.h, parsed.c);
    sess[peer] = s; saveSessions(sess);
    return plain;
  });
}
