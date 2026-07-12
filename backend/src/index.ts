import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { ZodError } from 'zod';
import { config } from './config';
import { pool, getRedis, applyMigrations } from './db/client';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import contactsRoutes from './routes/contacts';
import regionRoutes from './routes/region';
import messagesRoutes from './routes/messages';
import mtdRoutes from './routes/mtd';
import groupsRoutes from './routes/groups';
import { ensureAdminKey } from './services/mtdAdmin';
import { ensureGroupSigningKey } from './services/groupInvite';

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

async function main(): Promise<void> {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  const origins = config.corsOrigins === '*' ? true : config.corsOrigins.split(',').map((s) => s.trim());
  app.use(cors({ origin: origins, credentials: true }));
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await pool.query('SELECT 1');
      const redis = await getRedis();
      await redis.ping();
      res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } });
    } catch (e) {
      res.status(503).json({ success: false, error: (e as Error).message });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/contacts', contactsRoutes);
  app.use('/api/region', regionRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/mtd', mtdRoutes);
  app.use('/api/groups', groupsRoutes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', data: { issues: err.issues } });
      return;
    }
    const e = err as HttpError;
    const status = e.status ?? e.statusCode ?? 500;
    const msg = status >= 500 ? 'Internal server error' : (e.message || 'Error');
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error('[error]', e);
    }
    res.status(status).json({ success: false, error: msg });
  });

  // Warm Redis connection at boot — NON bloccante: se redis è irraggiungibile/misconfigurato,
  // l'API deve comunque partire e ascoltare (altrimenti nginx dà 502 su TUTTO). Le funzioni che
  // usano redis (auth/jwt) degradano finché redis non torna; il client riconnette in background.
  getRedis().catch((e) => console.error('[redis] warm-up failed (continuo senza):', (e as Error).message));
  // Warm Postgres
  try { await pool.query('SELECT 1'); } catch (e) { console.error('[pg] warm-up failed:', (e as Error).message); }
  // Apply migrations (idempotent)
  try { await applyMigrations(); } catch (e) { console.error('[migrations] failed:', (e as Error).message); }
  // Ensure MTD admin key exists (generates on first boot)
  try { await ensureAdminKey(); } catch (e) { console.warn('[mtd-admin] init skipped:', (e as Error).message); }
  // Ensure group invite/capability signing key exists (generates on first boot)
  try { ensureGroupSigningKey(); } catch (e) { console.warn('[group-signing] init skipped:', (e as Error).message); }

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[ii-private-messenger backend] listening on :${config.port} env=${config.nodeEnv}`);
  });

  const shutdown = async (sig: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[shutdown] signal=${sig}`);
    server.close(() => process.exit(0));
    try {
      await pool.end();
    } catch {
      // ignore
    }
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[fatal]', e);
  process.exit(1);
});
