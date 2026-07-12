import { IpcMain, BrowserWindow } from 'electron';
import WebSocket from 'ws';
import { getValidToken } from './api';

// Il JWT reale vive SOLO nel main process. La renderer chiama socket.connect col placeholder
// 'in-main-process'; qui prendiamo SEMPRE un token VALIDO (rinnovato se scaduto) da api.ts, così
// a ogni (ri)connessione ci si autentica con un token buono. Prima il socket cachava il token del
// primo connect e i reconnect ritentavano con quello scaduto → il relay chiudeva → mai OPEN.

let ws: WebSocket | null = null;
let intentional = false;
let lastUrl = '';
let backoff = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
      if (!intentional && lastUrl) void open(lastUrl);
    }, delay);
  }

  async function open(url: string): Promise<void> {
    const token = await getValidToken();
    if (!token) {
      forward({ type: 'error', error: 'no_access_token' });
      scheduleReconnect();
      return;
    }
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

  ipc.handle('socket.connect', async (_e, relayUrl: string, _accessToken: string) => {
    intentional = false;
    clearReconnect();
    backoff = 1000;
    lastUrl = relayUrl;
    await open(lastUrl);
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
