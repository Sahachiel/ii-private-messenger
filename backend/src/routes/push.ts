import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/client';
import { requireInternal } from '../middleware/auth';
import { sendPush } from '../services/push';

const router = Router();

const notifySchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().max(128).optional(),
  body: z.string().max(256).optional(),
  data: z.record(z.string()).optional(),
});

// Interno (chiamato dal relay quando il destinatario è OFFLINE): invia una push FCM.
// Privacy: default generico "Nuovo messaggio" (nessun contenuto sensibile; il client mostra il
// testo solo se l'utente ha attivato l'anteprima). Inerte finché FIREBASE_SERVICE_ACCOUNT_JSON
// non è configurato (sendPush ritorna false) — nessun errore, semplicemente niente push.
router.post('/notify', requireInternal, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = notifySchema.parse(req.body ?? {});
    const r = await pool.query(`SELECT fcm_token FROM users WHERE id = $1 AND is_active = TRUE`, [body.user_id]);
    const token = r.rows[0]?.fcm_token as string | undefined | null;
    if (!token) { res.json({ success: true, data: { sent: false, reason: 'no_token' } }); return; }
    const sent = await sendPush(token, {
      title: body.title ?? 'II Private Messenger',
      body: body.body ?? 'Nuovo messaggio',
      data: body.data,
    });
    res.json({ success: true, data: { sent } });
  } catch (e) { next(e); }
});

export default router;
