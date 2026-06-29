"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerApiIpc = void 0;
const axios_1 = __importDefault(require("axios"));
const keytar_1 = __importDefault(require("keytar"));
const electron_store_1 = __importDefault(require("electron-store"));
const BASE = 'https://iimsg-api.oleven-group.com/api';
const SERVICE = 'ii-private-messenger';
const store = new electron_store_1.default();
async function getToken() {
    return store.get('accessToken') ?? null;
}
async function authed() {
    const t = await getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
}
async function envelope(p) {
    const r = await p;
    if (!r.data?.success)
        throw new Error(r.data?.error ?? 'request failed');
    return r.data.data;
}
function registerApiIpc(ipc) {
    ipc.handle('api.session', async () => {
        // Derive a short identity fingerprint from the stored keypair so the
        // pairing QR can display a human-verifiable tag alongside the user info.
        async function sessionWithFingerprint(baseFields) {
            let fingerprint = null;
            try {
                const raw = await keytar_1.default.getPassword(SERVICE, 'identity');
                if (raw) {
                    const m = JSON.parse(raw);
                    if (m.pub)
                        fingerprint = m.pub.slice(0, 24);
                }
            }
            catch { }
            return { ...baseFields, fingerprint };
        }
        const token = await getToken();
        if (!token)
            return null;
        try {
            await axios_1.default.get(`${BASE}/region/my-node`, { headers: { Authorization: `Bearer ${token}` } });
            return sessionWithFingerprint({
                userId: store.get('userId') ?? null,
                username: store.get('username') ?? null,
            });
        }
        catch {
            try {
                const refresh = await keytar_1.default.getPassword(SERVICE, 'refresh');
                if (!refresh) {
                    store.clear();
                    return null;
                }
                const r = await axios_1.default.post(`${BASE}/auth/refresh`, { refresh_token: refresh });
                const d = r.data?.data;
                if (!r.data?.success || !d) {
                    store.clear();
                    return null;
                }
                store.set('accessToken', d.access_token);
                await keytar_1.default.setPassword(SERVICE, 'refresh', d.refresh_token);
                return sessionWithFingerprint({
                    userId: store.get('userId') ?? null,
                    username: store.get('username') ?? null,
                });
            }
            catch {
                return null;
            }
        }
    });
    ipc.handle('api.register', async (_e, payload) => {
        const data = await envelope(axios_1.default.post(`${BASE}/auth/register`, {
            username: payload.username,
            display_name: payload.displayName,
            password: payload.password,
            country_code: (payload.countryCode ?? 'QA').toUpperCase(),
            identity_public_key: payload.identityPublicKey,
            signed_prekey: JSON.stringify(payload.signedPreKey),
            registration_id: payload.registrationId,
            one_time_prekeys: payload.oneTimePreKeys.map((k) => ({ key_id: k.keyId, public_key: k.publicKey })),
        }));
        store.set('accessToken', data.access_token);
        store.set('userId', data.user_id);
        store.set('username', data.username);
        await keytar_1.default.setPassword(SERVICE, 'refresh', data.refresh_token);
        return data;
    });
    ipc.handle('api.login', async (_e, username, password) => {
        const data = await envelope(axios_1.default.post(`${BASE}/auth/login`, { username, password }));
        store.set('accessToken', data.access_token);
        store.set('userId', data.user_id);
        store.set('username', data.username);
        await keytar_1.default.setPassword(SERVICE, 'refresh', data.refresh_token);
        return data;
    });
    ipc.handle('api.logout', async () => {
        const refresh = await keytar_1.default.getPassword(SERVICE, 'refresh');
        try {
            if (refresh)
                await axios_1.default.post(`${BASE}/auth/logout`, { refresh_token: refresh }, { headers: await authed() });
        }
        catch { }
        store.clear();
        await keytar_1.default.deletePassword(SERVICE, 'refresh');
        await keytar_1.default.deletePassword(SERVICE, 'identity');
        return true;
    });
    ipc.handle('api.searchUsers', async (_e, q) => {
        return envelope(axios_1.default.get(`${BASE}/users/search`, {
            params: { q }, headers: await authed(),
        }));
    });
    ipc.handle('api.getUserKeys', async (_e, id) => {
        const w = await envelope(axios_1.default.get(`${BASE}/users/${id}/keys`, { headers: await authed() }));
        const spk = typeof w.signed_prekey === 'string' ? JSON.parse(w.signed_prekey) : w.signed_prekey;
        return {
            identityPublicKey: w.identity_public_key,
            signedPreKey: { keyId: spk.keyId ?? spk.key_id, publicKey: spk.publicKey ?? spk.public_key, signature: spk.signature },
            oneTimePreKey: w.one_time_prekey ? { keyId: w.one_time_prekey.key_id, publicKey: w.one_time_prekey.public_key } : undefined,
            registrationId: w.registration_id,
        };
    });
    ipc.handle('api.myNode', async () => {
        const w = await envelope(axios_1.default.get(`${BASE}/region/my-node`, { headers: await authed() }));
        const tc = w.turn_credentials ?? {};
        return {
            region: w.region, relayUrl: w.relay_url,
            turnConfig: {
                urls: Array.isArray(tc.urls) ? tc.urls : [tc.urls ?? w.turn_url],
                username: tc.username ?? '', credential: tc.credential ?? '', ttl: tc.ttl ?? 86400,
            },
        };
    });
}
exports.registerApiIpc = registerApiIpc;
