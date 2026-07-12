import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/client';
import { requireAuth, requireInternal } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';
import { getKeyBundle, addOneTimePrekeys, replenishCheck } from '../services/keyServer';
import type { Region } from '../types';

const router = Router();

/** True se `me` e `target` condividono almeno un gruppo attivo (co-membership). */
async function shareActiveGroup(me: string, target: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1
       FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
       JOIN conversations c ON c.id = cm1.conversation_id
      WHERE cm1.user_id = $1 AND cm2.user_id = $2
        AND cm1.status = 'active' AND cm2.status = 'active'
        AND c.is_group = TRUE AND c.deleted_at IS NULL
      LIMIT 1`,
    [me, target],
  );
  return (r.rowCount ?? 0) > 0;
}

// DISCOVERY SOLO-CODICE: la ricerca per username è DISATTIVATA (privacy: nessuno può
// enumerarti/scovarti per nome). Ci si trova SOLO col codice utente opaco, condiviso a mano.
router.get('/search', requireAuth, generalLimiter, async (_req: Request, res: Response) => {
  res.status(403).json({ success: false, error: 'search_disabled', data: { message: 'La ricerca per username è disattivata. Usa il codice utente.' } });
});

// Il MIO codice utente (da condividere per farsi aggiungere).
router.get('/me/code', requireAuth, generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query(`SELECT user_code, username, display_name FROM users WHERE id = $1`, [req.user!.id]);
    if (!r.rowCount) { res.status(404).json({ success: false, error: 'not_found' }); return; }
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
});

// Risolve un codice utente → identità (id, display_name). È l'UNICO modo per trovare qualcuno.
// Match esatto case-insensitive; 404 uniforme se il codice non esiste. Rate-limited contro brute force.
const codeParam = z.object({ code: z.string().min(6).max(24) });
router.get('/by-code/:code', requireAuth, generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = codeParam.parse(req.params);
    const r = await pool.query(
      `SELECT id, display_name, user_code FROM users WHERE upper(user_code) = upper($1) AND is_active = TRUE LIMIT 1`,
      [code.trim()],
    );
    if (!r.rowCount) { res.status(404).json({ success: false, error: 'not_found' }); return; }
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
});

const idParam = z.object({ id: z.string().uuid() });

// ISOLAMENTO: il key-bundle e' prelevabile solo per se stessi o per un co-membro di gruppo.
// Per chiunque altro si risponde 404 UNIFORME (indistinguibile da "utente inesistente"),
// così un membro del gruppo A non puo' confermare l'esistenza di un utente del gruppo B
// nemmeno indovinandone l'UUID.
router.get('/:id/keys', requireAuth, generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idParam.parse(req.params);
    const me = req.user!.id;
    if (id !== me && !(await shareActiveGroup(me, id))) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const bundle = await getKeyBundle(id);
    if (!bundle) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: bundle });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/region', requireInternal, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idParam.parse(req.params);
    const q = await pool.query(`SELECT region FROM users WHERE id = $1 AND is_active = TRUE`, [id]);
    if (q.rowCount === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const row = q.rows[0] as { region: Region };
    res.json({ success: true, data: { user_id: id, region: row.region } });
  } catch (e) {
    next(e);
  }
});

const patchMeSchema = z.object({
  display_name: z.string().min(1).max(64).optional(),
  avatar_url: z.string().url().max(1024).optional().nullable(),
  fcm_token: z.string().max(512).optional().nullable(),
});

router.patch('/me', requireAuth, generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const body = patchMeSchema.parse(req.body);
    const fields: string[] = [];
    const values: (string | null)[] = [];
    let i = 1;
    if (body.display_name !== undefined) { fields.push(`display_name = $${i++}`); values.push(body.display_name); }
    if (body.avatar_url !== undefined)  { fields.push(`avatar_url = $${i++}`);   values.push(body.avatar_url); }
    if (body.fcm_token !== undefined)   { fields.push(`fcm_token = $${i++}`);    values.push(body.fcm_token); }
    if (fields.length === 0) {
      res.json({ success: true, data: { updated: false } });
      return;
    }
    values.push(user.id);
    await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`,
      values,
    );
    res.json({ success: true, data: { updated: true } });
  } catch (e) {
    next(e);
  }
});

const replenishSchema = z.object({
  one_time_prekeys: z.array(z.object({
    key_id: z.number().int().nonnegative(),
    public_key: z.string().min(1),
  })).min(1).max(100),
});

router.post('/me/prekeys/replenish', requireAuth, generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const body = replenishSchema.parse(req.body);
    const inserted = await addOneTimePrekeys(user.id, body.one_time_prekeys);
    const check = await replenishCheck(user.id);
    res.json({ success: true, data: { inserted, ...check } });
  } catch (e) {
    next(e);
  }
});

export default router;
