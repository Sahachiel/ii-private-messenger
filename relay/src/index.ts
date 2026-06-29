import 'dotenv/config';
import http, { IncomingMessage, ServerResponse } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AuthMessageSchema,
  RelayMessageSchema,
  VerifiedUser,
} from './types';
import { verifyClientToken } from './auth';
import {
  initRedis,
  closeRedis,
  registerUser,
  unregisterUser,
  refreshPresence,
} from './store';
import { initQueue, closeQueue, flushTo } from './queue';
import { handleClientMessage } from './router';
import { handleInternalRelay } from './internal';

const REGION = process.env.NODE_REGION ?? 'ge';
const PORT = Number(process.env.PORT ?? 8080);
const LOG = `[relay-${REGION}]`;

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
  user?: VerifiedUser;
}

function jsonRespond(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function httpHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      jsonRespond(res, 200, { success: true, data: { status: 'ok', region: REGION } });
      return;
    }
    if (req.method === 'POST' && req.url === '/internal/relay') {
      await handleInternalRelay(req, res);
      return;
    }
    jsonRespond(res, 404, { success: false, error: 'not_found' });
  } catch (err) {
    console.error(`${LOG} http error:`, (err as Error).message);
    try {
      jsonRespond(res, 500, { success: false, error: 'internal_error' });
    } catch {
      // ignore
    }
  }
}

async function main(): Promise<void> {
  await initRedis();
  await initQueue();

  const server = http.createServer((req, res) => {
    void httpHandler(req, res);
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (socketRaw: WebSocket) => {
    const socket = socketRaw as AliveWebSocket;
    socket.isAlive = true;
    let authed = false;

    const authTimer = setTimeout(() => {
      if (!authed) {
        try {
          socket.close(4001, 'auth_timeout');
        } catch {
          // ignore
        }
      }
    }, 10000);

    socket.on('pong', () => {
      socket.isAlive = true;
      if (socket.user) {
        void refreshPresence(socket.user.userId).catch(() => undefined);
      }
    });

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      void (async () => {
        let raw: string;
        try {
          raw = data.toString();
        } catch {
          return;
        }
        let parsedUnknown: unknown;
        try {
          parsedUnknown = JSON.parse(raw);
        } catch {
          try {
            socket.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
          } catch {
            // ignore
          }
          return;
        }

        if (!authed) {
          const authParse = AuthMessageSchema.safeParse(parsedUnknown);
          if (!authParse.success) {
            try {
              socket.close(4001, 'auth_required');
            } catch {
              // ignore
            }
            return;
          }
          try {
            const user = await verifyClientToken(authParse.data.token);
            socket.user = user;
            authed = true;
            clearTimeout(authTimer);
            await registerUser(user.userId, socket);
            try {
              socket.send(
                JSON.stringify({
                  type: 'auth_ok',
                  userId: user.userId,
                  username: user.username,
                  region: user.region,
                })
              );
            } catch {
              // ignore
            }
            await flushTo(user.userId, socket);
          } catch (err) {
            console.error(`${LOG} auth failed:`, (err as Error).message);
            try {
              socket.close(4001, 'auth_failed');
            } catch {
              // ignore
            }
          }
          return;
        }

        const msgParse = RelayMessageSchema.safeParse(parsedUnknown);
        if (!msgParse.success) {
          try {
            socket.send(
              JSON.stringify({ type: 'error', error: 'invalid_message' })
            );
          } catch {
            // ignore
          }
          return;
        }
        const user = socket.user;
        if (!user) return;
        try {
          await handleClientMessage(user.userId, socket, msgParse.data);
        } catch (err) {
          console.error(`${LOG} router error:`, (err as Error).message);
        }
      })();
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      const user = socket.user;
      if (user) {
        void unregisterUser(user.userId).catch(() => undefined);
      }
    });

    socket.on('error', (err: Error) => {
      console.error(`${LOG} socket error:`, err.message);
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((client: WebSocket) => {
      const s = client as AliveWebSocket;
      if (!s.isAlive) {
        try {
          s.terminate();
        } catch {
          // ignore
        }
        return;
      }
      s.isAlive = false;
      try {
        s.ping();
      } catch {
        // ignore
      }
    });
  }, 30000);

  server.listen(PORT, () => {
    console.log(`${LOG} listening on :${PORT}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${LOG} ${signal} received, shutting down`);
    clearInterval(heartbeat);
    try {
      wss.clients.forEach((c) => {
        try {
          c.close(1001, 'server_shutdown');
        } catch {
          // ignore
        }
      });
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeQueue();
      await closeRedis();
    } catch (err) {
      console.error(`${LOG} shutdown error:`, (err as Error).message);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err: Error) => {
    console.error(`${LOG} uncaughtException:`, err.message);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    console.error(`${LOG} unhandledRejection:`, reason);
  });
}

main().catch((err: Error) => {
  console.error(`[relay-${REGION}] fatal:`, err.message);
  process.exit(1);
});
