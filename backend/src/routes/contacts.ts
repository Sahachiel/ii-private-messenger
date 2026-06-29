import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';

const router = Router();

router.use(requireAuth, generalLimiter);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const result = await pool.query(
      `SELECT c.contact_id,
              u.username,
              u.display_name,
              u.avatar_url,
              c.nickname,
              c.is_blocked,
              c.added_at
         FROM contacts c
         JOIN users u ON u.id = c.contact_id
        WHERE c.user_id = $1
        ORDER BY COALESCE(c.nickname, u.display_name) ASC`,
      [user.id],
    );
    res.json({ success: true, data: result.rows });
  } catch (e) {
    next(e);
  }
});

const addSchema = z.object({
  contact_id: z.string().uuid(),
  nickname: z.string().min(1).max(64).optional(),
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const body = addSchema.parse(req.body);
    if (body.contact_id === user.id) {
      res.status(400).json({ success: false, error: 'Cannot add yourself' });
      return;
    }
    const exists = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND is_active = TRUE`, [body.contact_id]);
    if (exists.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Contact user not found' });
      return;
    }
    await pool.query(
      `INSERT INTO contacts (user_id, contact_id, nickname, is_blocked)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (user_id, contact_id)
         DO UPDATE SET nickname = EXCLUDED.nickname`,
      [user.id, body.contact_id, body.nickname ?? null],
    );
    res.status(201).json({ success: true, data: { contact_id: body.contact_id } });
  } catch (e) {
    next(e);
  }
});

const idParam = z.object({ id: z.string().uuid() });

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { id } = idParam.parse(req.params);
    await pool.query(`DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2`, [user.id, id]);
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/block', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { id } = idParam.parse(req.params);
    await pool.query(
      `INSERT INTO contacts (user_id, contact_id, is_blocked)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (user_id, contact_id) DO UPDATE SET is_blocked = TRUE`,
      [user.id, id],
    );
    res.json({ success: true, data: { blocked: true } });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/unblock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { id } = idParam.parse(req.params);
    await pool.query(
      `UPDATE contacts SET is_blocked = FALSE WHERE user_id = $1 AND contact_id = $2`,
      [user.id, id],
    );
    res.json({ success: true, data: { blocked: false } });
  } catch (e) {
    next(e);
  }
});

export default router;
