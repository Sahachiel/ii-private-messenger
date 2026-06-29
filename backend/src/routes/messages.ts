import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/client';
import { requireAuth, requireInternal } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';

const router = Router();

/**
 * DELETE /api/messages/:id — sender can delete for everyone (hard delete).
 * Expired messages are swept by a scheduled task; this endpoint is also invoked
 * client-side when the self-destruct timer elapses.
 */
router.delete('/:id', requireAuth, generalLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ id: z.string().uuid() });
    const { id } = schema.parse(req.params);
    const userId = req.user!.id; // FIX: era (req as any).userId (undefined) → delete falliva sempre

    const q = await pool.query(
      `DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id`,
      [id, userId],
    );
    if (q.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Message not found or not owner' });
      return;
    }
    res.json({ success: true, data: { id } });
  } catch (e) { next(e); }
});

/**
 * POST /api/messages/sweep-expired — cron INTERNO (X-Internal-Secret), non per utenti.
 * Cancella i messaggi scaduti. FIX: prima era sotto requireAuth globale (qualsiasi utente
 * poteva triggerarlo) → ora requireInternal.
 */
router.post('/sweep-expired', requireInternal, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const q = await pool.query(`DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < NOW()`);
    res.json({ success: true, data: { removed: q.rowCount } });
  } catch (e) { next(e); }
});

export default router;
