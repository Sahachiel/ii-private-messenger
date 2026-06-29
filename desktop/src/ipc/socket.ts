import { IpcMain, BrowserWindow } from 'electron';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
let intentional = false;

export function registerSocketIpc(ipc: IpcMain, getWindow: () => BrowserWindow | null): void {
  function forward(ev: unknown): void { getWindow()?.webContents.send('socket.event', ev); }

  ipc.handle('socket.connect', async (_e, relayUrl: string, accessToken: string) => {
    try { ws?.close(); } catch {}
    intentional = false;
    ws = new WebSocket(relayUrl);
    ws.on('open', () => ws?.send(JSON.stringify({ type: 'auth', token: accessToken })));
    ws.on('message', (buf) => {
      try { forward(JSON.parse(buf.toString())); } catch {}
    });
    ws.on('close', () => {
      if (intentional) return;
      setTimeout(() => ws?.terminate(), 0);
      forward({ type: 'pong', closed: true });
    });
    ws.on('error', () => {});
    return true;
  });

  ipc.handle('socket.send', async (_e, msg: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  });

  ipc.handle('socket.disconnect', async () => {
    intentional = true;
    try { ws?.close(); } catch {}
    ws = null;
    return true;
  });
}
