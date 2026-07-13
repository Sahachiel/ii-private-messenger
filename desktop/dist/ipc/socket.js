"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSocketIpc = void 0;
const ws_1 = __importDefault(require("ws"));
const api_1 = require("./api");
// Il JWT reale vive SOLO nel main process. La renderer chiama socket.connect col placeholder
// 'in-main-process'; qui prendiamo SEMPRE un token VALIDO (rinnovato se scaduto) da api.ts, così
// a ogni (ri)connessione ci si autentica con un token buono. Prima il socket cachava il token del
// primo connect e i reconnect ritentavano con quello scaduto → il relay chiudeva → mai OPEN.
let ws = null;
let intentional = false;
let lastUrl = '';
let backoff = 1000;
let reconnectTimer = null;
function registerSocketIpc(ipc, getWindow) {
    function forward(ev) {
        getWindow()?.webContents.send('socket.event', ev);
    }
    function clearReconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }
    function scheduleReconnect() {
        if (reconnectTimer || intentional || !lastUrl)
            return;
        const delay = Math.min(backoff, 30000);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            backoff = Math.min(backoff * 2, 30000);
            if (!intentional && lastUrl)
                void open(lastUrl);
        }, delay);
    }
    async function open(url) {
        const token = await (0, api_1.getValidToken)();
        if (!token) {
            forward({ type: 'error', error: 'no_access_token' });
            scheduleReconnect();
            return;
        }
        try {
            ws?.removeAllListeners();
            ws?.close();
        }
        catch { }
        ws = new ws_1.default(url);
        ws.on('open', () => {
            backoff = 1000;
            ws?.send(JSON.stringify({ type: 'auth', token }));
            forward({ type: 'socket_state', state: 'connected' });
        });
        ws.on('message', (buf) => {
            try {
                forward(JSON.parse(buf.toString()));
            }
            catch { }
        });
        ws.on('close', () => {
            if (intentional)
                return;
            forward({ type: 'socket_state', state: 'reconnecting' });
            scheduleReconnect();
        });
        ws.on('error', () => {
            try {
                ws?.close();
            }
            catch { }
        });
    }
    ipc.handle('socket.connect', async (_e, relayUrl, _accessToken) => {
        intentional = false;
        clearReconnect();
        backoff = 1000;
        lastUrl = relayUrl;
        await open(lastUrl);
        return true;
    });
    ipc.handle('socket.send', async (_e, msg) => {
        if (ws?.readyState === ws_1.default.OPEN) {
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
        }
        catch { }
        ws = null;
        return true;
    });
}
exports.registerSocketIpc = registerSocketIpc;
