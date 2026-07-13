"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerApiIpc = exports.getValidToken = void 0;
const axios_1 = __importDefault(require("axios"));
const keytar_1 = __importDefault(require("keytar"));
const electron_store_1 = __importDefault(require("electron-store"));
const BASE = 'https://iimsg-api.oleven-group.com/api';
const SERVICE = 'ii-private-messenger';
const store = new electron_store_1.default();
async function getToken() {
    return store.get('accessToken') ?? null;
}
function jwtExpired(jwt) {
    try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
        return !payload.exp || payload.exp * 1000 < Date.now() + 5000; // 5s di margine
    }
    catch {
        return false;
    }
}
// Rinnova l'access token usando il refresh token in keytar. Ritorna il nuovo token o null.
async function refreshAccessToken() {
    const refresh = await keytar_1.default.getPassword(SERVICE, 'refresh');
    if (!refresh)
        return null;
    try {
        const r = await axios_1.default.post(`${BASE}/auth/refresh`, { refresh_token: refresh });
        const d = r.data?.data;
        if (r.data?.success && d) {
            store.set('accessToken', d.access_token);
            await keytar_1.default.setPassword(SERVICE, 'refresh', d.refresh_token);
            return d.access_token;
        }
    }
    catch { /* refresh fallito → sessione da rifare */ }
    return null;
}
// Ritorna un access token VALIDO (rinnova col refresh token se scaduto). Usato sia da authed()
// per le API sia dal socket per (ri)autenticarsi al relay senza restare col token scaduto.
async function getValidToken() {
    let t = await getToken();
    if (t && jwtExpired(t))
        t = (await refreshAccessToken()) ?? t;
    return t;
}
exports.getValidToken = getValidToken;
async function authed() {
    const t = await getValidToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
}
async function envelope(p) {
    try {
        const r = await p;
        if (!r.data?.success)
            throw new Error(r.data?.error ?? 'request failed');
        return r.data.data;
    }
    catch (e) {
        // Espone il vero errore del backend (es. validazione) invece del generico "status code 400".
        const resp = e?.response?.data;
        if (resp) {
            let msg = resp.error || 'request failed';
            const issues = resp.data?.issues;
            if (Array.isArray(issues) && issues.length) {
                msg += ': ' + issues.map((i) => `${(i.path || []).join('.')} ${i.message}`).join('; ');
            }
            throw new Error(msg);
        }
        throw e;
    }
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
    // Discovery solo-codice: il mio codice da condividere + risoluzione di un codice altrui.
    ipc.handle('api.myCode', async () => {
        const w = await envelope(axios_1.default.get(`${BASE}/users/me/code`, { headers: await authed() }));
        return w.user_code;
    });
    ipc.handle('api.byCode', async (_e, code) => {
        try {
            const w = await envelope(axios_1.default.get(`${BASE}/users/by-code/${encodeURIComponent(String(code).trim())}`, { headers: await authed() }));
            return { id: w.id, displayName: w.display_name, userCode: w.user_code };
        }
        catch {
            return null;
        }
    });
    ipc.handle('api.getUserKeys', async (_e, id) => {
        const w = await envelope(axios_1.default.get(`${BASE}/users/${id}/keys`, { headers: await authed() }));
        const spk = typeof w.signed_prekey === 'string' ? JSON.parse(w.signed_prekey) : w.signed_prekey;
        return {
            identityPublicKey: w.identity_public_key,
            signedPreKey: { keyId: spk.keyId ?? spk.key_id, publicKey: spk.publicKey ?? spk.public_key, signature: spk.signature, kemPublicKey: spk.kemPublicKey, signPublicKey: spk.signPublicKey },
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
    // ---- Gruppi (app group-centric): il backend è zero-knowledge sui contenuti; qui passano
    // solo UUID opachi, ruoli, epoch e token/capability firmati. Stesse rotte del mobile groupsApi.
    ipc.handle('groups.create', async (_e, maxMembers) => envelope(axios_1.default.post(`${BASE}/groups`, { max_members: maxMembers }, { headers: await authed() })));
    ipc.handle('groups.list', async () => envelope(axios_1.default.get(`${BASE}/groups`, { headers: await authed() })));
    ipc.handle('groups.members', async (_e, gid) => envelope(axios_1.default.get(`${BASE}/groups/${gid}/members`, { headers: await authed() })));
    ipc.handle('groups.capability', async (_e, gid) => envelope(axios_1.default.get(`${BASE}/groups/${gid}/capability`, { headers: await authed() })));
    ipc.handle('groups.invite', async (_e, gid, opts) => envelope(axios_1.default.post(`${BASE}/groups/${gid}/invites`, opts ?? {}, { headers: await authed() })));
    ipc.handle('groups.join', async (_e, token) => envelope(axios_1.default.post(`${BASE}/groups/join`, { token }, { headers: await authed() })));
    ipc.handle('groups.joinRequests', async (_e, gid) => envelope(axios_1.default.get(`${BASE}/groups/${gid}/join-requests`, { headers: await authed() })));
    ipc.handle('groups.decide', async (_e, gid, userId, approve) => envelope(axios_1.default.post(`${BASE}/groups/${gid}/join-requests/${userId}`, { approve }, { headers: await authed() })));
    ipc.handle('groups.leave', async (_e, gid) => envelope(axios_1.default.post(`${BASE}/groups/${gid}/leave`, {}, { headers: await authed() })));
}
exports.registerApiIpc = registerApiIpc;
