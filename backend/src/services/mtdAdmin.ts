/**
 * MTD admin keypair manager.
 * Auto-generates Ed25519 keypair at first boot, publishes public key to clients,
 * keeps private key in OS keychain / env (NEVER in DB).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/client';

const KEY_DIR = process.env.MTD_ADMIN_KEY_DIR ?? '/app/mtd-keys';
const ORG = 'oleven-xsec';

interface AdminKey { publicKeyB64: string; fingerprint: string; privateKeyPem?: string }

export async function ensureAdminKey(): Promise<AdminKey> {
  const existing = await pool.query(
    `SELECT public_key_b64, fingerprint FROM mtd_admin_keys WHERE org_name = $1`,
    [ORG],
  );
  const row = existing.rows[0] as { public_key_b64: string; fingerprint: string } | undefined;
  if (row && row.public_key_b64 !== '__PLACEHOLDER__') {
    return { publicKeyB64: row.public_key_b64, fingerprint: row.fingerprint };
  }

  // Generate Ed25519 keypair
  const kp = crypto.generateKeyPairSync('ed25519');
  const rawPub = kp.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const pubRaw32 = rawPub.subarray(rawPub.length - 32);
  const pubB64 = pubRaw32.toString('base64');
  const fingerprint = crypto.createHash('sha256').update(pubRaw32).digest('hex');

  // Persist private key on disk (mode 0600, off-DB)
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const privPath = path.join(KEY_DIR, `${ORG}.key`);
  fs.writeFileSync(
    privPath,
    kp.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { mode: 0o600 },
  );
  const pubPath = path.join(KEY_DIR, `${ORG}.pub`);
  fs.writeFileSync(pubPath, `${pubB64}\n${fingerprint}\n`, { mode: 0o644 });

  await pool.query(
    `UPDATE mtd_admin_keys SET public_key_b64 = $1, fingerprint = $2 WHERE org_name = $3`,
    [pubB64, fingerprint, ORG],
  );

  // eslint-disable-next-line no-console
  console.log(`[mtd-admin] generated Ed25519 admin key for ${ORG}, fingerprint=${fingerprint}, priv=${privPath}`);
  return { publicKeyB64: pubB64, fingerprint };
}

export async function getAdminPublicKey(): Promise<AdminKey | null> {
  const r = await pool.query(
    `SELECT public_key_b64, fingerprint FROM mtd_admin_keys WHERE org_name = $1`,
    [ORG],
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0] as { public_key_b64: string; fingerprint: string };
  if (row.public_key_b64 === '__PLACEHOLDER__') return null;
  return { publicKeyB64: row.public_key_b64, fingerprint: row.fingerprint };
}
