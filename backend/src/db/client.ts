import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err: Error) => {
  // eslint-disable-next-line no-console
  console.error('[pg] pool error:', err.message);
});

export async function createRedis(): Promise<RedisClientType> {
  // La password redis viaggia SEPARATA (config.redisPassword da REDIS_PASSWORD), non dentro
  // l'URL: così l'URL resta host:port e non si rompe con caratteri speciali nella password.
  const client: RedisClientType = createClient({
    url: config.redisUrl,
    ...(config.redisPassword ? { password: config.redisPassword } : {}),
  });
  client.on('error', (err: Error) => {
    // eslint-disable-next-line no-console
    console.error('[redis] error:', err.message);
  });
  await client.connect();
  return client;
}

let sharedRedis: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (sharedRedis && sharedRedis.isOpen) return sharedRedis;
  sharedRedis = await createRedis();
  return sharedRedis;
}

/**
 * Apply SQL migrations from src/db/migrations/ in alphabetical order.
 * Idempotent — each migration uses IF NOT EXISTS / ON CONFLICT.
 */
export async function applyMigrations(): Promise<void> {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[migrations] applying ${f}`);
    await pool.query(sql);
  }
}
