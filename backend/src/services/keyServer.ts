import { pool } from '../db/client';
import { config } from '../config';
import type { KeyBundle, OneTimePrekey } from '../types';

export interface StoreBundleInput {
  identity_public_key: string;
  signed_prekey: string;
  registration_id: number;
  one_time_prekeys: OneTimePrekey[];
}

export async function storeKeyBundle(userId: string, bundle: StoreBundleInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users
          SET identity_public_key = $2,
              signed_prekey       = $3,
              registration_id     = $4
        WHERE id = $1`,
      [userId, bundle.identity_public_key, bundle.signed_prekey, bundle.registration_id],
    );
    for (const otp of bundle.one_time_prekeys) {
      await client.query(
        `INSERT INTO one_time_prekeys (user_id, key_id, public_key, used)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (user_id, key_id) DO UPDATE
           SET public_key = EXCLUDED.public_key,
               used = FALSE`,
        [userId, otp.key_id, otp.public_key],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function addOneTimePrekeys(userId: string, otps: OneTimePrekey[]): Promise<number> {
  if (otps.length === 0) return 0;
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const otp of otps) {
      const res = await client.query(
        `INSERT INTO one_time_prekeys (user_id, key_id, public_key, used)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (user_id, key_id) DO NOTHING`,
        [userId, otp.key_id, otp.public_key],
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getKeyBundle(userId: string): Promise<KeyBundle | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query(
      `SELECT identity_public_key, signed_prekey, registration_id
         FROM users
        WHERE id = $1 AND is_active = TRUE`,
      [userId],
    );
    if (userRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = userRes.rows[0] as {
      identity_public_key: string;
      signed_prekey: string;
      registration_id: number;
    };

    const otpRes = await client.query(
      `SELECT id, key_id, public_key
         FROM one_time_prekeys
        WHERE user_id = $1 AND used = FALSE
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [userId],
    );

    let otp: OneTimePrekey | null = null;
    if (otpRes.rowCount && otpRes.rowCount > 0) {
      const r = otpRes.rows[0] as { id: number; key_id: number; public_key: string };
      await client.query(`UPDATE one_time_prekeys SET used = TRUE WHERE id = $1`, [r.id]);
      otp = { key_id: r.key_id, public_key: r.public_key };
    }

    await client.query('COMMIT');
    return {
      identity_public_key: row.identity_public_key,
      signed_prekey: row.signed_prekey,
      registration_id: row.registration_id,
      one_time_prekey: otp,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function countUnusedPrekeys(userId: string): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c
       FROM one_time_prekeys
      WHERE user_id = $1 AND used = FALSE`,
    [userId],
  );
  const row = res.rows[0] as { c: number } | undefined;
  return row?.c ?? 0;
}

export async function replenishCheck(userId: string): Promise<{ needs_replenish: boolean; remaining: number }> {
  const remaining = await countUnusedPrekeys(userId);
  return { needs_replenish: remaining < config.otpReplenishThreshold, remaining };
}
