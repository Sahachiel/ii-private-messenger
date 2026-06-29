"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSocketIpc = void 0;
const ws_1 = __importDefault(require("ws"));
let ws = null;
let intentional = false;
function registerSocketIpc(ipc, getWindow) {
    function forward(ev) { getWindow()?.webContents.send('socket.event', ev); }
    ipc.handle('socket.connect', async (_e, relayUrl, accessToken) => {
        try {
            ws?.close();
        }
        catch { }
        intentional = false;
        ws = new ws_1.default(relayUrl);
        ws.on('open', () => ws?.send(JSON.stringify({ type: 'auth', token: accessToken })));
        ws.on('message', (buf) => {
            try {
                forward(JSON.parse(buf.toString()));
            }
            catch { }
        });
        ws.on('close', () => {
            if (intentional)
                return;
            setTimeout(() => ws?.terminate(), 0);
            forward({ type: 'pong', closed: true });
        });
        ws.on('error', () => { });
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
        try {
            ws?.close();
        }
        catch { }
        ws = null;
        return true;
    });
}
exports.registerSocketIpc = registerSocketIpc;
