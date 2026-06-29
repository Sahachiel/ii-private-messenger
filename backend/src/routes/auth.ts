import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/client';
import { config, REGION_NODES } from '../config';
import { countryToRegion } from '../utils/region';
import { signTokens, rotateRefresh, revokeRefresh } from '../services/jwt';
import { authLimiter } from '../middleware/rateLimit';
import { requireInternal } from '../middleware/auth';
import { verifyAccess } from '../services/jwt';
import type { Region } from '../types';

const router = Router();

const oneTimePrekeySchema = z.object({
  key_id: z.number().int().nonnegative(),
  public_key: z.string().min(1),
});

const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  display_name: z.string().min(1).max(64),
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/).optional(),
  password: z.string().min(8).max(256),
  country_code: z.string().length(2),
  identity_public_key: z.string().min(1),
  signed_prekey: z.string().min(1),
  registration_id: z.number().int().nonnegative(),
  one_time_prekeys: z.array(oneTimePrekeySchema).min(1).max(200),
  fcm_token: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  fcm_token: z.string().optional(),
});

const refreshSchema = z.object({ refresh_token: z.string().min(1) });
const logoutSchema = z.object({ refresh_token: z.string().min(1) });

const LOCKOUT_MAX_FAILS = 10;
const LOCKOUT_WINDOW_SEC = 15 * 60;

function lockoutKey(username: string): string {
  return `lockout:login:${username.toLowerCase()}`;
}

router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = registerSchema.parse(req.body);
    const region: Region = countryToRegion(body.country_code);
    const password_hash = await bcrypt.hash(body.password, config.bcryptRounds);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const dup = await client.query(
        `SELECT 1 FROM users WHERE username = $1 OR (phone IS NOT NULL AND phone = $2) LIMIT 1`,
        [body.username, body.phone ?? null],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ success: false, error: 'Username or phone already registered' });
        return;
      }

      const insertRes = await client.query(
        `INSERT INTO users
           (username, phone, display_name, country_code, region, password_hash,
            identity_public_key, signed_prekey, registration_id, fcm_token, last_seen, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), TRUE)
         RETURNING id`,
        [
          body.username,
          body.phone ?? null,
          body.display_name,
          body.country_code.toUpperCase(),
          region,
          password_hash,
          body.identity_public_key,
          body.signed_prekey,
          body.registration_id,
          body.fcm_token ?? null,
        ],
      );
      const row = insertRes.rows[0] as { id: string };
      const userId = row.id;

      for (const otp of body.one_time_prekeys) {
        await client.query(
          `INSERT INTO one_time_prekeys (user_id, key_id, public_key, used)
           VALUES ($1, $2, $3, FALSE)`,
          [userId, otp.key_id, otp.public_key],
        );
      }

      await client.query('COMMIT');

      const tokens = await signTokens({ userId, username: body.username, region });
      const node = REGION_NODES[region];

      res.status(201).json({
        success: true,
        data: {
          user_id: userId,
          username: body.username,
          region,
          relay_url: node.relay_url,
          turn_url: node.turn_url,
          proxy_config: node.proxy_config ?? null,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.parse(req.body);
    const { getRedis } = await import('../db/client');
    const redis = await getRedis();
    const lk = lockoutKey(body.username);
    const fails = parseInt((await redis.get(lk)) ?? '0', 10);
    if (fails >= LOCKOUT_MAX_FAILS) {
      res.status(429).json({ success: false, error: 'Account temporarily locked due to failed attempts' });
      return;
    }

    const q = await pool.query(
      `SELECT id, username, password_hash, region, is_active
         FROM users
        WHERE username = $1
        LIMIT 1`,
      [body.username],
    );
    if (q.rowCount === 0) {
      await redis.multi().incr(lk).expire(lk, LOCKOUT_WINDOW_SEC).exec();
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }
    const u = q.rows[0] as { id: string; username: string; password_hash: string; region: Region; is_active: boolean };
    if (!u.is_active) {
      res.status(403).json({ success: false, error: 'Account disabled' });
      return;
    }
    const ok = await bcrypt.compare(body.password, u.password_hash);
    if (!ok) {
      await redis.multi().incr(lk).expire(lk, LOCKOUT_WINDOW_SEC).exec();
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }
    await redis.del(lk);

    await pool.query(
      `UPDATE users SET last_seen = NOW(), fcm_token = COALESCE($2, fcm_token) WHERE id = $1`,
      [u.id, body.fcm_token ?? null],
    );

    const tokens = await signTokens({ userId: u.id, username: u.username, region: u.region });
    const node = REGION_NODES[u.region];

    res.json({
      success: true,
      data: {
        user_id: u.id,
        username: u.username,
        region: u.region,
        relay_url: node.relay_url,
        turn_url: node.turn_url,
        proxy_config: node.proxy_config ?? null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/refresh', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = refreshSchema.parse(req.body);
    const tokens = await rotateRefresh(body.refresh_token, async (userId: string) => {
      const q = await pool.query(`SELECT id, username, region FROM users WHERE id = $1 AND is_active = TRUE`, [userId]);
      if (q.rowCount === 0) return null;
      const u = q.rows[0] as { id: string; username: string; region: Region };
      return { userId: u.id, username: u.username, region: u.region };
    });
    res.json({ success: true, data: tokens });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = logoutSchema.parse(req.body);
    await revokeRefresh(body.refresh_token);
    res.json({ success: true, data: { revoked: true } });
  } catch (e) {
    next(e);
  }
});

// Internal: relay uses this to verify client-supplied access tokens
router.post('/verify-token', requireInternal, async (req: Request, res: Response) => {
  try {
    const schema = z.object({ access_token: z.string().min(1) });
    const body = schema.parse(req.body);
    const claims = verifyAccess(body.access_token);
    res.json({
      success: true,
      data: { userId: claims.sub, username: claims.username, region: claims.region },
    });
  } catch (e) {
    res.status(401).json({ success: false, error: (e as Error).message });
  }
});

export default router;
