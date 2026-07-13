import { createClient, RedisClientType } from 'redis';
import { WebSocket } from 'ws';
import { RelayEvent } from './types';
import { notifyPush } from './push';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const REGION = process.env.NODE_REGION ?? 'ge';

const MAX_QUEUE = 500;
const QUEUE_TTL_SEC = 7 * 24 * 60 * 60;

let qClient: RedisClientType | null = null;

export async function initQueue(): Promise<void> {
  const c: RedisClientType = createClient({ url: REDIS_URL });
  c.on('error', (err: Error) => {
    console.error(`[relay-${REGION}] queue redis error:`, err.message);
  });
  await c.connect();
  qClient = c;
}

export async function closeQueue(): Promise<void> {
  if (qClient) {
    try {
      await qClient.quit();
    } catch (err) {
      console.error(`[relay-${REGION}] queue close:`, (err as Error).message);
    }
    qClient = null;
  }
}

function getClient(): RedisClientType {
  if (!qClient) throw new Error('queue_not_initialized');
  return qClient;
}

export async function enqueue(userId: string, event: RelayEvent): Promise<void> {
  try {
    const key = `queue:${userId}`;
    const payload = JSON.stringify(event);
    const c = getClient();
    await c.rPush(key, payload);
    await c.lTrim(key, -MAX_QUEUE, -1);
    await c.expire(key, QUEUE_TTL_SEC);
    // Destinatario offline: sveglialo con una push (best-effort). Solo per i messaggi veri,
    // non per le ricevute di lettura o altri segnali.
    if (event.type === 'message') void notifyPush(userId);
  } catch (err) {
    console.error(`[relay-${REGION}] enqueue:`, (err as Error).message);
  }
}

export async function flushTo(userId: string, socket: WebSocket): Promise<number> {
  const key = `queue:${userId}`;
  try {
    const c = getClient();
    const items = await c.lRange(key, 0, -1);
    if (items.length === 0) return 0;
    await c.del(key);
    let sent = 0;
    for (const raw of items) {
      if (socket.readyState !== socket.OPEN) break;
      try {
        socket.send(raw);
        sent++;
      } catch (err) {
        console.error(`[relay-${REGION}] flush send:`, (err as Error).message);
      }
    }
    return sent;
  } catch (err) {
    console.error(`[relay-${REGION}] flushTo:`, (err as Error).message);
    return 0;
  }
}
