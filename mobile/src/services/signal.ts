/**
 * E2EE pairwise — v0.3: Double Ratchet (X25519 + chain ratchet + AEAD) con FORWARD SECRECY
 * e POST-COMPROMISE SECURITY. Sostituisce il vecchio nacl.box statico (privo di PFS).
 *
 * Bootstrap X3DH semplificato (IK + SignedPreKey, senza one-time prekey): sufficiente per
 * forward secrecy; il livello di protezione anti-replay del primo messaggio è inferiore a
 * X3DH completo con OTP — upgrade possibile in seguito. Il ratchet vero e proprio (PFS/PCS)
 * è pienamente attivo dopo il primo scambio.
 *
 * Compatibilità preservata:
 *  - formato identità in keychain `{pub, priv, regId}` (xsec-mtd/attestation deriva la sign-key
 *    da `priv`, NON va cambiato);
 *  - interfaccia pubblica invariata (initialize/generateKeyBundle/buildSession/encrypt/decrypt/...).
 *
 * NOTA interop: i client v0.2 (nacl.box statico) non sono compatibili con questo formato —
 * va forzato l'aggiornamento di tutti i client (nessun doppio-protocollo).
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { KC, appKv } from './keychain';
import { initAlice, initBob, drEncrypt, drDecrypt, DRSession, DRHeader } from './doubleRatchet';
import { kemKeygen, kemEncapsulate, kemDecapsulate } from './pqkem';
import { usersApi } from './api';
import { KeyBundle, RemoteKeyBundle, EncryptedPayload } from '../types';

const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };

const KV_SPK = 'dr.spk';            // signed prekey keypair (segreto) — usato dal responder
const KV_SESSIONS = 'dr.sessions';  // Record<userId, DRSession>
const KV_PENDING = 'dr.pending';    // Record<userId, {ik, spk, otp?}> — bundle del peer in attesa di init
const KV_OTP = 'dr.otpSecrets';     // Record<keyId, secretB64> — one-time prekey (segreti) da consumare
const KV_OTP_NEXT = 'dr.otpNextId'; // contatore keyId per non riusare mai un id
const KV_KEM = 'dr.kem';            // { pub, sec } — chiave ML-KEM-768 (post-quantum) del dispositivo
const OTP_BATCH = 20;               // quante OTP tenere pronte lato server
const OTP_LOW = 5;                  // sotto questa soglia si rigenera

type PendingBundle = { ik: string; spk: string; otp?: { keyId: number; pub: string }; kemPub?: string };

interface LocalIdentity { publicKey: Uint8Array; secretKey: Uint8Array; registrationId: number }
interface SPK { pub: string; sec: string; keyId: number }

function loadMap<T>(key: string): Record<string, T> {
  const raw = appKv.getString(key);
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, T>; } catch { return {}; }
}
function saveMap(key: string, m: Record<string, unknown>): void {
  try { appKv.set(key, JSON.stringify(m)); } catch { /* ignore */ }
}

export class SignalService {
  private identity: LocalIdentity | null = null;

  async initialize(): Promise<void> {
    if (this.identity) return;
    const existing = await KC.getIdentity();
    if (existing && existing.password) {
      const m = JSON.parse(existing.password);
      this.identity = { publicKey: b64.dec(m.pub), secretKey: b64.dec(m.priv), registrationId: m.regId };
    } else {
      const kp = nacl.box.keyPair();
      const regId = Math.floor(Math.random() * 16380) + 1;
      this.identity = { publicKey: kp.publicKey, secretKey: kp.secretKey, registrationId: regId };
      await KC.setIdentity(JSON.stringify({ pub: b64.enc(kp.publicKey), priv: b64.enc(kp.secretKey), regId }));
    }
    this.ensureSPK();
  }

  /** SignedPreKey stabile (keypair X25519) — il responder la usa come ratchet key iniziale. */
  private ensureSPK(): SPK {
    const raw = appKv.getString(KV_SPK);
    if (raw) { try { return JSON.parse(raw) as SPK; } catch { /* regen */ } }
    const kp = nacl.box.keyPair();
    const spk: SPK = { pub: b64.enc(kp.publicKey), sec: b64.enc(kp.secretKey), keyId: 1 };
    appKv.set(KV_SPK, JSON.stringify(spk));
    return spk;
  }

  /** Chiave ML-KEM-768 (post-quantum) stabile del dispositivo; il pubblico va nel bundle. */
  private ensureKem(): { pub: string; sec: string } {
    const raw = appKv.getString(KV_KEM);
    if (raw) { try { return JSON.parse(raw) as { pub: string; sec: string }; } catch { /* regen */ } }
    const kp = kemKeygen();
    appKv.set(KV_KEM, JSON.stringify(kp));
    return kp;
  }

  /** Sign-key derivata dal box-secret (coerente con xsec-mtd/attestation). */
  private signKey(): nacl.SignKeyPair {
    const seed = nacl.hash(this.identity!.secretKey).slice(0, 32);
    return nacl.sign.keyPair.fromSeed(seed);
  }

  /** Genera N one-time prekey REALI e distinte: salva i segreti localmente, ritorna solo i pubblici. */
  private mintOneTimePreKeys(n: number): Array<{ keyId: number; publicKey: string }> {
    const secrets = loadMap<string>(KV_OTP);
    let nextId = appKv.getNumber(KV_OTP_NEXT) ?? 2; // 1 storicamente riservato al placeholder
    const out: Array<{ keyId: number; publicKey: string }> = [];
    for (let i = 0; i < n; i++) {
      const kp = nacl.box.keyPair();
      const keyId = nextId++;
      secrets[String(keyId)] = b64.enc(kp.secretKey);
      out.push({ keyId, publicKey: b64.enc(kp.publicKey) });
    }
    saveMap(KV_OTP, secrets);
    appKv.set(KV_OTP_NEXT, nextId);
    return out;
  }

  async generateKeyBundle(): Promise<KeyBundle> {
    await this.initialize();
    const spk = this.ensureSPK();
    const kem = this.ensureKem();
    const signature = nacl.sign.detached(b64.dec(spk.pub), this.signKey().secretKey);
    return {
      identityPublicKey: b64.enc(this.identity!.publicKey),
      // La chiave KEM post-quantum (kemPublicKey) viaggia dentro il blob signed_prekey: nessuna
      // modifica di schema al backend, che lo conserva e lo restituisce verbatim.
      signedPreKey: { keyId: spk.keyId, publicKey: spk.pub, signature: b64.enc(signature), kemPublicKey: kem.pub },
      registrationId: this.identity!.registrationId,
      // X3DH COMPLETO: one-time prekey vere e distinte (i segreti restano sul dispositivo).
      oneTimePreKeys: this.mintOneTimePreKeys(OTP_BATCH),
    };
  }

  /** Se le OTP disponibili scendono sotto la soglia, ne rigenera e ricarica i pubblici sul server. */
  private async replenishIfLow(): Promise<void> {
    const remaining = Object.keys(loadMap<string>(KV_OTP)).length;
    if (remaining >= OTP_LOW) return;
    try {
      const fresh = this.mintOneTimePreKeys(OTP_BATCH);
      await usersApi.replenishPreKeys(fresh);
    } catch { /* riproverà al prossimo consumo */ }
  }

  async buildSession(remoteUserId: string, _deviceId: number, bundle: RemoteKeyBundle): Promise<void> {
    // Memorizza il bundle del peer (IK + SignedPreKey) per inizializzare la sessione come
    // initiator al primo encrypt. Non sovrascrive una sessione DR già stabilita.
    const sessions = loadMap<DRSession>(KV_SESSIONS);
    if (sessions[remoteUserId]) return;
    const pending = loadMap<PendingBundle>(KV_PENDING);
    // Il backend consegna UNA one-time prekey non usata (e la marca usata): la conserviamo per
    // fonderla nell'handshake al primo encrypt.
    const otp = bundle.oneTimePreKey ? { keyId: bundle.oneTimePreKey.keyId, pub: bundle.oneTimePreKey.publicKey } : undefined;
    const kemPub = (bundle.signedPreKey as { kemPublicKey?: string }).kemPublicKey;
    pending[remoteUserId] = { ik: bundle.identityPublicKey, spk: bundle.signedPreKey.publicKey, otp, kemPub };
    saveMap(KV_PENDING, pending);
  }

  async encrypt(remoteUserId: string, _deviceId: number, plaintext: string): Promise<EncryptedPayload> {
    await this.initialize();
    const sessions = loadMap<DRSession>(KV_SESSIONS);
    let s = sessions[remoteUserId];
    if (!s) {
      const pending = loadMap<PendingBundle>(KV_PENDING);
      const p = pending[remoteUserId];
      if (!p) throw new Error(`No session with ${remoteUserId} — call buildSession first`);
      // Post-quantum: se il destinatario ha una chiave KEM, incapsuliamo e fondiamo il segreto
      // ML-KEM nell'handshake; il ciphertext va nel primo header.
      let pqSecret: string | undefined; let pqCt: string | undefined;
      if (p.kemPub) { const enc = kemEncapsulate(p.kemPub); pqCt = enc.ct; pqSecret = enc.ss; }
      s = initAlice(b64.enc(this.identity!.secretKey), b64.enc(this.identity!.publicKey), p.ik, p.spk, p.otp, pqSecret, pqCt);
    }
    const { header, ct } = drEncrypt(s, plaintext);
    sessions[remoteUserId] = s;
    saveMap(KV_SESSIONS, sessions);
    return { type: 3, ciphertext: JSON.stringify({ h: header, c: ct }) };
  }

  async decrypt(remoteUserId: string, _deviceId: number, payload: EncryptedPayload): Promise<string> {
    await this.initialize();
    let parsed: { h: DRHeader; c: string };
    try { parsed = JSON.parse(payload.ciphertext); } catch { throw new Error('bad_ciphertext'); }
    const sessions = loadMap<DRSession>(KV_SESSIONS);
    let s = sessions[remoteUserId];
    if (!s) {
      const spk = this.ensureSPK();
      // Se il mittente ha usato una one-time prekey (otpId nel primo header), recuperiamo il
      // segreto corrispondente, lo usiamo e lo DISTRUGGIAMO (monouso). Poi rimpiazziamo le OTP scarse.
      let otpSec: string | undefined;
      if (parsed.h.otpId != null) {
        const secrets = loadMap<string>(KV_OTP);
        otpSec = secrets[String(parsed.h.otpId)];
        if (otpSec) { delete secrets[String(parsed.h.otpId)]; saveMap(KV_OTP, secrets); void this.replenishIfLow(); }
      }
      // Post-quantum: se il mittente ha incluso un ciphertext ML-KEM, decapsuliamo con la nostra
      // chiave KEM per ricavare lo stesso segreto e fonderlo nell'handshake.
      let pqSecret: string | undefined;
      if (parsed.h.pqct) { try { pqSecret = kemDecapsulate(parsed.h.pqct, this.ensureKem().sec); } catch { /* KEM assente/incompatibile */ } }
      s = initBob(b64.enc(this.identity!.secretKey), b64.enc(this.identity!.publicKey), spk.pub, spk.sec, parsed.h, otpSec, pqSecret);
    }
    const plain = drDecrypt(s, parsed.h, parsed.c);
    sessions[remoteUserId] = s;
    saveMap(KV_SESSIONS, sessions);
    return plain;
  }

  async hasSession(remoteUserId: string, _deviceId: number): Promise<boolean> {
    return !!loadMap<DRSession>(KV_SESSIONS)[remoteUserId] || !!loadMap<unknown>(KV_PENDING)[remoteUserId];
  }

  getIdentityPublicKeyB64(): string {
    if (!this.identity) return '';
    return b64.enc(this.identity.publicKey);
  }

  getRegistrationId(): number { return this.identity?.registrationId ?? 0; }

  async exportToKeychain(): Promise<void> {
    if (!this.identity) return;
    await KC.setIdentity(JSON.stringify({
      pub: b64.enc(this.identity.publicKey), priv: b64.enc(this.identity.secretKey), regId: this.identity.registrationId,
    }));
  }

  async importFromKeychain(): Promise<boolean> {
    const r = await KC.getIdentity();
    if (!r || !r.password) return false;
    const m = JSON.parse(r.password);
    this.identity = { publicKey: b64.dec(m.pub), secretKey: b64.dec(m.priv), registrationId: m.regId };
    return true;
  }
}

export const signal = new SignalService();
