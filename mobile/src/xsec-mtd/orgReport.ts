import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import axios from 'axios';
import { readEvents } from './storage/eventLog';
import { fetchAdminPubkey } from './sync/mirrorClient';
import { mtd } from './engine/MTDEngine';
import { getMySignPublicKeyB64 } from './attestation';
import { KC, appKv } from '@services/keychain';

function apiBase(): string {
  return __DEV__ ? 'http://10.0.2.2:3000/api' : 'https://iimsg-api.oleven-group.com/api';
}

async function getIdentitySecrets(): Promise<{ box: Uint8Array; sign: Uint8Array } | null> {
  const r = await KC.getIdentity();
  if (!r || !r.password) return null;
  const m = JSON.parse(r.password);
  const box = util.decodeBase64(m.priv);
  const seed = nacl.hash(box).slice(0, 32);
  const sign = nacl.sign.keyPair.fromSeed(seed).secretKey;
  return { box, sign };
}

export interface OrgReportResult { id?: string; error?: string }

/**
 * Envelope format (admin decrypts offline with paired private key):
 *   { ephemeral_pub_b64, nonce_b64, ciphertext_b64 }
 *
 * Derivation:
 *   shared_key = nacl.hash( ephemeral_sk · admin_pub ) [first 32 bytes]
 *
 * The ephemeral_pub is sent in CLEAR (outside the cipher) so the admin can
 * reconstruct the same key. This is a simplified scheme — v0.3 will use
 * real X25519 DH once an Ed25519→X25519 bridge is available on-device.
 */
export async function sendOrgReport(): Promise<OrgReportResult> {
  const admin = await fetchAdminPubkey();
  if (!admin) return { error: 'admin pubkey unavailable' };

  const me = await getIdentitySecrets();
  if (!me) return { error: 'identity missing' };

  const ephemeral = nacl.box.keyPair();
  const adminPubRaw = util.decodeBase64(admin.public_key_b64);

  // Derive symmetric key from ephemeral_sk || admin_pub (simplified KDF; documented as such)
  const kdfInput = new Uint8Array(ephemeral.secretKey.length + adminPubRaw.length);
  kdfInput.set(ephemeral.secretKey, 0);
  kdfInput.set(adminPubRaw, ephemeral.secretKey.length);
  const sharedKey = nacl.hash(kdfInput).slice(0, 32);

  // Plaintext (without ephemeral_pub — sent outside cipher)
  const events = await readEvents(500);
  const report = {
    version: 1,
    ts: Date.now(),
    device_state: mtd.getState(),
    health_score: mtd.getScore(),
    user_id: appKv.getString('auth.userId') ?? null,
    events,
  };
  const plain = util.decodeUTF8(JSON.stringify(report));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const cipher = nacl.secretbox(plain, nonce, sharedKey);

  const envelope = {
    ephemeral_pub_b64: util.encodeBase64(ephemeral.publicKey),
    nonce_b64: util.encodeBase64(nonce),
    ciphertext_b64: util.encodeBase64(cipher),
  };
  const ciphertext = util.encodeBase64(util.decodeUTF8(JSON.stringify(envelope)));

  const senderPub = await getMySignPublicKeyB64();
  if (!senderPub) return { error: 'sign key missing' };
  const sig = util.encodeBase64(nacl.sign.detached(util.decodeUTF8(ciphertext), me.sign));

  const token = appKv.getString('auth.accessToken');
  try {
    const res = await axios.post(`${apiBase()}/mtd/org-report`, {
      org_admin_pub_b64: admin.public_key_b64,
      ciphertext,
      sender_pub_b64: senderPub,
      signature_b64: sig,
      severity: mtd.getState() === 'compromised' ? 'compromised' : (mtd.getState() === 'warning' ? 'warning' : 'info'),
    }, {
      timeout: 15000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.data?.success ? { id: res.data.data.id } : { error: res.data?.error ?? 'upload failed' };
  } catch (e: any) {
    return { error: e?.message ?? 'upload error' };
  }
}
