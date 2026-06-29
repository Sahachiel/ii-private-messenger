import { createClient, RedisClientType } from 'redis';
import axios from 'axios';
import { WebSocket } from 'ws';
import { Region } from './types';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://backend:3000';
const INTER_NODE_SECRET = process.env.INTER_NODE_SECRET ?? '';
const REGION = (process.env.NODE_REGION ?? 'ge') as Region;
const HOSTNAME = process.env.HOSTNAME ?? `relay-${REGION}`;

const PRESENCE_TTL_SEC = 60;
const REGION_CACHE_TTL_SEC = 300;

let client: RedisClientType | null = null;
const sockets: Map<string, WebSocket> = new Map();

export async function initRedis(): Promise<void> {
  const c: RedisClientType = createClient({ url: REDIS_URL });
  c.on('error', (err: Error) => {
    console.error(`[relay-${REGION}] redis error:`, err.message);
  });
  await c.connect();
  client = c;
  console.log(`[relay-${REGION}] redis connected`);
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch (err) {
      console.error(`[relay-${REGION}] redis close:`, (err as Error).message);
    }
    client = null;
  }
}

function getClient(): RedisClientType {
  if (!client) throw new Error('redis_not_initialized');
  return client;
}

/** Accesso al client Redis condiviso (usato da groupAuth per la cache membri). */
export function getRedisClient(): RedisClientType {
  return getClient();
}

export async function registerUser(userId: string, socket: WebSocket): Promise<void> {
  sockets.set(userId, socket);
  try {
    await getClient().set(`presence:${userId}`, HOSTNAME, { EX: PRESENCE_TTL_SEC });
  } catch (err) {
    console.error(`[relay-${REGION}] register presence:`, (err as Error).message);
  }
}

export async function refreshPresence(userId: string): Promise<void> {
  try {
    await getClient().set(`presence:${userId}`, HOSTNAME, { EX: PRESENCE_TTL_SEC });
  } catch (err) {
    console.error(`[relay-${REGION}] refresh presence:`, (err as Error).message);
  }
}

export async function unregisterUser(userId: string): Promise<void> {
  sockets.delete(userId);
  try {
    await getClient().del(`presence:${userId}`);
  } catch (err) {
    console.error(`[relay-${REGION}] unregister presence:`, (err as Error).message);
  }
}

export function getLocalSocket(userId: string): WebSocket | undefined {
  return sockets.get(userId);
}

interface RegionLookupResponse {
  success: boolean;
  data?: { region: Region };
}

export async function getRegion(userId: string): Promise<Region | null> {
  const cacheKey = `userregion:${userId}`;
  try {
    const cached = await getClient().get(cacheKey);
    if (cached) return cached as Region;
  } catch {
    // fallthrough
  }
  try {
    const resp = await axios.get<RegionLookupResponse>(
      `${BACKEND_URL}/api/users/${encodeURIComponent(userId)}/region`,
      {
        headers: { 'X-Internal-Secret': INTER_NODE_SECRET },
        timeout: 5000,
      }
    );
    if (!resp.data.success || !resp.data.data) return null;
    const region = resp.data.data.region;
    try {
      await getClient().set(cacheKey, region, { EX: REGION_CACHE_TTL_SEC });
    } catch {
      // ignore cache errors
    }
    return region;
  } catch (err) {
    console.error(`[relay-${REGION}] getRegion:`, (err as Error).message);
    return null;
  }
}
