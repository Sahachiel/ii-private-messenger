import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getRedis } from '../db/client';
import type { Region } from '../types';

export interface AccessClaims extends JwtPayload {
  sub: string;
  username: string;
  region: Region;
  typ: 'access';
}

export interface RefreshClaims extends JwtPayload {
  sub: string;
  jti: string;
  typ: 'refresh';
}

interface SignInput {
  userId: string;
  username: string;
  region: Region;
}

function refreshKey(userId: string, jti: string): string {
  return `refresh:${userId}:${jti}`;
}

export async function signTokens(input: SignInput): Promise<{ access_token: string; refresh_token: string }> {
  const accessOpts: SignOptions = { expiresIn: config.jwt.accessTtlSeconds };
  const access_token = jwt.sign(
    { sub: input.userId, username: input.username, region: input.region, typ: 'access' },
    config.jwt.secret,
    accessOpts,
  );

  const jti = uuidv4();
  const refreshOpts: SignOptions = { expiresIn: config.jwt.refreshTtlSeconds };
  const refresh_token = jwt.sign(
    { sub: input.userId, jti, typ: 'refresh' },
    config.jwt.secret,
    refreshOpts,
  );

  const redis = await getRedis();
  await redis.set(refreshKey(input.userId, jti), '1', { EX: config.jwt.refreshTtlSeconds });

  return { access_token, refresh_token };
}

export function verifyAccess(token: string): AccessClaims {
  const decoded = jwt.verify(token, config.jwt.secret);
  if (typeof decoded === 'string') {
    throw new Error('Invalid access token');
  }
  const claims = decoded as AccessClaims;
  if (claims.typ !== 'access' || !claims.sub || !claims.username || !claims.region) {
    throw new Error('Invalid access token claims');
  }
  return claims;
}

export function verifyRefresh(token: string): RefreshClaims {
  const decoded = jwt.verify(token, config.jwt.secret);
  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token');
  }
  const claims = decoded as RefreshClaims;
  if (claims.typ !== 'refresh' || !claims.sub || !claims.jti) {
    throw new Error('Invalid refresh token claims');
  }
  return claims;
}

export async function rotateRefresh(oldToken: string, lookup: (userId: string) => Promise<SignInput | null>): Promise<{ access_token: string; refresh_token: string }> {
  const claims = verifyRefresh(oldToken);
  const redis = await getRedis();
  const key = refreshKey(claims.sub, claims.jti);
  const exists = await redis.get(key);
  if (!exists) throw new Error('Refresh token revoked or expired');
  await redis.del(key);

  const user = await lookup(claims.sub);
  if (!user) throw new Error('User not found');

  return signTokens(user);
}

export async function revokeRefresh(token: string): Promise<void> {
  try {
    const claims = verifyRefresh(token);
    const redis = await getRedis();
    await redis.del(refreshKey(claims.sub, claims.jti));
  } catch {
    // swallow — logout is idempotent
  }
}

export async function revokeAllForUser(userId: string): Promise<void> {
  const redis = await getRedis();
  const pattern = `refresh:${userId}:*`;
  let cursor = 0;
  do {
    const res = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = res.cursor;
    if (res.keys.length > 0) {
      await redis.del(res.keys);
    }
  } while (cursor !== 0);
}
