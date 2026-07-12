import { app, BrowserWindow, ipcMain, shell, session } from 'electron';
import path from 'path';
import { registerCryptoIpc } from './ipc/crypto';
import { registerApiIpc } from './ipc/api';
import { registerSocketIpc } from './ipc/socket';
import { registerSenderKeysIpc } from './ipc/senderKeys';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0A0E1A',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.NODE_ENV === 'development') mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  // Consenti microfono/webcam alla renderer (necessario per le chiamate WebRTC).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'mediaKeySystem');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  registerCryptoIpc(ipcMain);
  registerApiIpc(ipcMain);
  registerSocketIpc(ipcMain, () => mainWindow);
  registerSenderKeysIpc(ipcMain);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
