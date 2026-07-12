import { IpcMain, BrowserWindow } from 'electron';
import WebSocket from 'ws';
import Store from 'electron-store';

// Stesso store (default 'config') usato da api.ts: il JWT reale vive SOLO nel main process,
// non viene mai esposto alla renderer. La renderer chiama socket.connect con il placeholder
// 'in-main-process' e qui risolviamo il token vero dallo store, altrimenti il relay chiude
// subito la connessione (auth fallita) e niente messaggi/chiamate funziona.
const store = new Store<{ accessToken?: string }>();

let ws: WebSocket | null = null;
let intentional = false;
let lastUrl = '';
let lastToken = '';
let backoff = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function resolveToken(passed: string): string {
  if (passed && passed !== 'in-main-process') return passed;
  return (store.get('accessToken') as string) ?? '';
}

export function registerSocketIpc(ipc: IpcMain, getWindow: () => BrowserWindow | null): void {
  function forward(ev: unknown): void {
    getWindow()?.webContents.send('socket.event', ev);
  }

  function clearReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer || intentional || !lastUrl) return;
    const delay = Math.min(backoff, 30000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoff = Math.min(backoff * 2, 30000);
      if (!intentional && lastUrl) open(lastUrl, lastToken);
    }, delay);
  }

  function open(url: string, token: string): void {
    try {
      ws?.removeAllListeners();
      ws?.close();
    } catch {}
    ws = new WebSocket(url);
    ws.on('open', () => {
      backoff = 1000;
      ws?.send(JSON.stringify({ type: 'auth', token }));
      forward({ type: 'socket_state', state: 'connected' });
    });
    ws.on('message', (buf) => {
      try {
        forward(JSON.parse(buf.toString()));
      } catch {}
    });
    ws.on('close', () => {
      if (intentional) return;
      forward({ type: 'socket_state', state: 'reconnecting' });
      scheduleReconnect();
    });
    ws.on('error', () => {
      try {
        ws?.close();
      } catch {}
    });
  }

  ipc.handle('socket.connect', async (_e, relayUrl: string, accessToken: string) => {
    intentional = false;
    clearReconnect();
    backoff = 1000;
    lastUrl = relayUrl;
    lastToken = resolveToken(accessToken);
    if (!lastToken) {
      // niente token → il relay chiuderebbe subito: segnaliamo alla UI invece di fallire in silenzio.
      forward({ type: 'error', error: 'no_access_token' });
      return false;
    }
    open(lastUrl, lastToken);
    return true;
  });

  ipc.handle('socket.send', async (_e, msg: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  });

  ipc.handle('socket.disconnect', async () => {
    intentional = true;
    clearReconnect();
    try {
      ws?.close();
    } catch {}
    ws = null;
    return true;
  });
}
