import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';
import { getAdminPublicKey } from '../services/mtdAdmin';

const router = Router();

/**
 * GET /api/mtd/admin-pubkey
 * Returns the Oleven org admin Ed25519 public key (clients pin this).
 */
router.get('/admin-pubkey', generalLimiter, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const k = await getAdminPublicKey();
    if (!k) { res.status(503).json({ success: false, error: 'admin key not initialized' }); return; }
    res.json({ success: true, data: { public_key_b64: k.publicKeyB64, fingerprint: k.fingerprint, org: 'oleven-xsec' } });
  } catch (e) { next(e); }
});

/**
 * GET /api/mtd/blocklist?kind=apps&since=N
 * Returns all blocklist payloads for a kind with version > since.
 * Payload is Ed25519-signed; clients MUST verify signature against pinned signer_pub_b64.
 */
router.get('/blocklist', generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      kind: z.enum(['apps', 'phishing', 'rogue_bssid', 'malicious_ip', 'cert_pins']),
      since: z.coerce.number().int().nonnegative().default(0),
    });
    const { kind, since } = schema.parse(req.query);
    const q = await pool.query(
      `SELECT version, encode(payload, 'base64') AS payload_b64, signature_b64, signer_pub_b64, published_at
         FROM mtd_blocklists
        WHERE kind = $1 AND version > $2
        ORDER BY version ASC
        LIMIT 100`,
      [kind, since],
    );
    res.json({ success: true, data: { kind, entries: q.rows } });
  } catch (e) { next(e); }
});

/**
 * POST /api/mtd/blocklist (internal, admin-signed update push)
 * Requires `X-MTD-Admin-Signature` header = Ed25519(payload) by admin privkey.
 * For now: protected by INTER_NODE_SECRET bearer (push from a trusted operator script).
 */
router.post('/blocklist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = req.headers.authorization ?? '';
    if (bearer !== `Bearer ${process.env.INTER_NODE_SECRET ?? ''}`) {
      res.status(403).json({ success: false, error: 'forbidden' }); return;
    }
    const schema = z.object({
      kind: z.enum(['apps', 'phishing', 'rogue_bssid', 'malicious_ip', 'cert_pins']),
      version: z.number().int().positive(),
      payload_b64: z.string().min(1),
      signature_b64: z.string().min(1),
      signer_pub_b64: z.string().min(1),
    });
    const body = schema.parse(req.body);
    await pool.query(
      `INSERT INTO mtd_blocklists (kind, version, payload, signature_b64, signer_pub_b64)
       VALUES ($1, $2, decode($3, 'base64'), $4, $5)
       ON CONFLICT (kind, version) DO UPDATE
         SET payload = EXCLUDED.payload,
             signature_b64 = EXCLUDED.signature_b64,
             signer_pub_b64 = EXCLUDED.signer_pub_b64,
             published_at = NOW()`,
      [body.kind, body.version, body.payload_b64, body.signature_b64, body.signer_pub_b64],
    );
    res.json({ success: true, data: { kind: body.kind, version: body.version } });
  } catch (e) { next(e); }
});

/**
 * POST /api/mtd/org-report
 * Ingest E2EE encrypted threat report from client, targeted at org admin.
 * Server stores ciphertext only; cannot decrypt.
 */
router.post('/org-report', requireAuth, generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      org_admin_pub_b64: z.string().min(1),
      ciphertext: z.string().min(1).max(200_000),
      sender_pub_b64: z.string().min(1),
      signature_b64: z.string().min(1),
      severity: z.enum(['info', 'warning', 'compromised']).optional(),
    });
    const body = schema.parse(req.body);
    const userId = (req as any).userId as string | null;
    const r = await pool.query(
      `INSERT INTO mtd_reports (user_id, org_admin_pub_b64, ciphertext, sender_pub_b64, signature_b64, severity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, body.org_admin_pub_b64, body.ciphertext, body.sender_pub_b64, body.signature_b64, body.severity ?? 'info'],
    );
    res.json({ success: true, data: { id: (r.rows[0] as { id: string }).id } });
  } catch (e) { next(e); }
});

export default router;
