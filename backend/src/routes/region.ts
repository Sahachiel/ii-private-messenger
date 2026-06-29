import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config, REGION_NODES } from '../config';
import { requireAuth } from '../middleware/auth';
import type { TurnConfig } from '../types';

const router = Router();

/**
 * RFC 5766 REST API for TURN:
 *   username = <ttlUnixTs>:<userId>
 *   password = base64(HMAC-SHA1(sharedSecret, username))
 */
export function generateTurnCreds(secret: string, userId: string, ttlSeconds: number, turnUrl: string): TurnConfig {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(username);
  const credential = hmac.digest('base64');
  return { urls: turnUrl, username, credential, ttl: ttlSeconds };
}

router.get('/my-node', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const node = REGION_NODES[user.region];
    const turn_credentials = generateTurnCreds(
      config.turn.sharedSecret,
      user.id,
      config.turn.ttlSeconds,
      node.turn_url,
    );
    res.json({
      success: true,
      data: {
        region: user.region,
        relay_url: node.relay_url,
        turn_url: node.turn_url,
        turn_credentials,
        proxy_config: node.proxy_config ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
