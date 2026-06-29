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
import { KeyBundle, RemoteKeyBundle, EncryptedPayload } from '../types';

const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };

const KV_SPK = 'dr.spk';            // signed prekey keypair (segreto) — usato dal responder
const KV_SESSIONS = 'dr.sessions';  // Record<userId, DRSession>
const KV_PENDING = 'dr.pending';    // Record<userId, {ik, spk}> — bundle del peer in attesa di init

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

  /** Sign-key derivata dal box-secret (coerente con xsec-mtd/attestation). */
  private signKey(): nacl.SignKeyPair {
    const seed = nacl.hash(this.identity!.secretKey).slice(0, 32);
    return nacl.sign.keyPair.fromSeed(seed);
  }

  async generateKeyBundle(): Promise<KeyBundle> {
    await this.initialize();
    const spk = this.ensureSPK();
    const signature = nacl.sign.detached(b64.dec(spk.pub), this.signKey().secretKey);
    return {
      identityPublicKey: b64.enc(this.identity!.publicKey),
      signedPreKey: { keyId: spk.keyId, publicKey: spk.pub, signature: b64.enc(signature) },
      registrationId: this.identity!.registrationId,
      // X3DH-senza-OTP: prekey monouso placeholder (il bundle del backend ne richiede ≥1).
      oneTimePreKeys: [{ keyId: 1, publicKey: spk.pub }],
    };
  }

  async buildSession(remoteUserId: string, _deviceId: number, bundle: RemoteKeyBundle): Promise<void> {
    // Memorizza il bundle del peer (IK + SignedPreKey) per inizializzare la sessione come
    // initiator al primo encrypt. Non sovrascrive una sessione DR già stabilita.
    const sessions = loadMap<DRSession>(KV_SESSIONS);
    if (sessions[remoteUserId]) return;
    const pending = loadMap<{ ik: string; spk: string }>(KV_PENDING);
    pending[remoteUserId] = { ik: bundle.identityPublicKey, spk: bundle.signedPreKey.publicKey };
    saveMap(KV_PENDING, pending);
  }

  async encrypt(remoteUserId: string, _deviceId: number, plaintext: string): Promise<EncryptedPayload> {
    await this.initialize();
    const sessions = loadMap<DRSession>(KV_SESSIONS);
    let s = sessions[remoteUserId];
    if (!s) {
      const pending = loadMap<{ ik: string; spk: string }>(KV_PENDING);
      const p = pending[remoteUserId];
      if (!p) throw new Error(`No session with ${remoteUserId} — call buildSession first`);
      s = initAlice(b64.enc(this.identity!.secretKey), b64.enc(this.identity!.publicKey), p.ik, p.spk);
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
      s = initBob(b64.enc(this.identity!.secretKey), b64.enc(this.identity!.publicKey), spk.pub, spk.sec, parsed.h);
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
