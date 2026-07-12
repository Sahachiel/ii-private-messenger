import { IncomingMessage, ServerResponse } from 'http';
import { InternalForwardSchema, RelayEvent, RelayEventType } from './types';
import { deliverOrQueueLocal } from './router';

const REGION = process.env.NODE_REGION ?? 'ge';
const INTER_NODE_SECRET = process.env.INTER_NODE_SECRET ?? '';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function jsonRespond(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const KNOWN_EVENT_TYPES: ReadonlySet<RelayEventType> = new Set<RelayEventType>([
  'message',
  'delivery_receipt',
  'read_receipt',
  'call_offer',
  'call_answer',
  'ice_candidate',
  'call_end',
  'typing_start',
  'typing_stop',
  'contact_invite',
  'presence',
  'pong',
  'error',
]);

export async function handleInternalRelay(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const secret = req.headers['x-internal-secret'];
    if (typeof secret !== 'string' || secret !== INTER_NODE_SECRET) {
      jsonRespond(res, 401, { success: false, error: 'unauthorized' });
      return;
    }
    const raw = await readBody(req);
    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(raw);
    } catch {
      jsonRespond(res, 400, { success: false, error: 'invalid_json' });
      return;
    }
    const parsed = InternalForwardSchema.safeParse(parsedUnknown);
    if (!parsed.success) {
      jsonRespond(res, 400, { success: false, error: 'invalid_payload' });
      return;
    }
    const payload = parsed.data;
    if (!KNOWN_EVENT_TYPES.has(payload.type as RelayEventType)) {
      jsonRespond(res, 400, { success: false, error: 'unknown_type' });
      return;
    }
    const event: RelayEvent = {
      type: payload.type as RelayEventType,
      from: payload.from,
      to: payload.to,
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      gid: payload.gid,
      epoch: payload.epoch,
      ciphertext: payload.ciphertext,
      messageType: payload.messageType,
      timestamp: payload.timestamp,
      callId: payload.callId,
      callType: payload.callType,
      sdp: payload.sdp,
      candidate: payload.candidate,
      reason: payload.reason,
      token: payload.token,
      fromName: payload.fromName,
      fromCode: payload.fromCode,
    };
    await deliverOrQueueLocal(event);
    jsonRespond(res, 200, { success: true });
  } catch (err) {
    console.error(`[relay-${REGION}] internal relay error:`, (err as Error).message);
    jsonRespond(res, 500, { success: false, error: 'internal_error' });
  }
}
