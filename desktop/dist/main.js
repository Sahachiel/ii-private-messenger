"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("./ipc/crypto");
const api_1 = require("./ipc/api");
const socket_1 = require("./ipc/socket");
const senderKeys_1 = require("./ipc/senderKeys");
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 800,
        minHeight: 500,
        backgroundColor: '#0A0E1A',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    mainWindow.loadFile(path_1.default.join(__dirname, '..', 'renderer', 'index.html'));
    mainWindow.webContents.setWindowOpenHandler(({ url }) => { electron_1.shell.openExternal(url); return { action: 'deny' }; });
    if (process.env.NODE_ENV === 'development')
        mainWindow.webContents.openDevTools({ mode: 'detach' });
}
electron_1.app.whenReady().then(() => {
    // Consenti microfono/webcam alla renderer (necessario per le chiamate WebRTC).
    electron_1.session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
        cb(permission === 'media' || permission === 'mediaKeySystem');
    });
    electron_1.session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
    (0, crypto_1.registerCryptoIpc)(electron_1.ipcMain);
    (0, api_1.registerApiIpc)(electron_1.ipcMain);
    (0, socket_1.registerSocketIpc)(electron_1.ipcMain, () => mainWindow);
    (0, senderKeys_1.registerSenderKeysIpc)(electron_1.ipcMain);
    createWindow();
    electron_1.app.on('activate', () => { if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow(); });
});
electron_1.app.on('window-all-closed', () => { if (process.platform !== 'darwin')
    electron_1.app.quit(); });
