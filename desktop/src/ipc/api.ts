import { IpcMain } from 'electron';
import axios from 'axios';
import keytar from 'keytar';
import Store from 'electron-store';

const BASE = 'https://iimsg-api.oleven-group.com/api';
const SERVICE = 'ii-private-messenger';

const store = new Store<{ accessToken?: string; userId?: string; username?: string }>();

async function getToken(): Promise<string | null> {
  return store.get('accessToken') ?? null;
}

async function authed(): Promise<Record<string, string>> {
  const t = await getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function envelope<T>(p: Promise<{ data: any }>): Promise<T> {
  try {
    const r = await p;
    if (!r.data?.success) throw new Error(r.data?.error ?? 'request failed');
    return r.data.data as T;
  } catch (e: any) {
    // Espone il vero errore del backend (es. validazione) invece del generico "status code 400".
    const resp = e?.response?.data;
    if (resp) {
      let msg = resp.error || 'request failed';
      const issues = resp.data?.issues;
      if (Array.isArray(issues) && issues.length) {
        msg += ': ' + issues.map((i: any) => `${(i.path || []).join('.')} ${i.message}`).join('; ');
      }
      throw new Error(msg);
    }
    throw e;
  }
}

export function registerApiIpc(ipc: IpcMain): void {
  ipc.handle('api.session', async () => {
    // Derive a short identity fingerprint from the stored keypair so the
    // pairing QR can display a human-verifiable tag alongside the user info.
    async function sessionWithFingerprint(baseFields: { userId: string | null; username: string | null }) {
      let fingerprint: string | null = null;
      try {
        const raw = await keytar.getPassword(SERVICE, 'identity');
        if (raw) {
          const m = JSON.parse(raw) as { pub?: string };
          if (m.pub) fingerprint = m.pub.slice(0, 24);
        }
      } catch {}
      return { ...baseFields, fingerprint };
    }

    const token = await getToken();
    if (!token) return null;
    try {
      await axios.get(`${BASE}/region/my-node`, { headers: { Authorization: `Bearer ${token}` } });
      return sessionWithFingerprint({
        userId: store.get('userId') ?? null,
        username: store.get('username') ?? null,
      });
    } catch {
      try {
        const refresh = await keytar.getPassword(SERVICE, 'refresh');
        if (!refresh) { store.clear(); return null; }
        const r = await axios.post(`${BASE}/auth/refresh`, { refresh_token: refresh });
        const d = r.data?.data;
        if (!r.data?.success || !d) { store.clear(); return null; }
        store.set('accessToken', d.access_token);
        await keytar.setPassword(SERVICE, 'refresh', d.refresh_token);
        return sessionWithFingerprint({
          userId: store.get('userId') ?? null,
          username: store.get('username') ?? null,
        });
      } catch {
        return null;
      }
    }
  });

  ipc.handle('api.register', async (_e, payload: any) => {
    const data = await envelope<any>(axios.post(`${BASE}/auth/register`, {
      username: payload.username,
      display_name: payload.displayName,
      password: payload.password,
      country_code: (payload.countryCode ?? 'QA').toUpperCase(),
      identity_public_key: payload.identityPublicKey,
      signed_prekey: JSON.stringify(payload.signedPreKey),
      registration_id: payload.registrationId,
      one_time_prekeys: payload.oneTimePreKeys.map((k: any) => ({ key_id: k.keyId, public_key: k.publicKey })),
    }));
    store.set('accessToken', data.access_token);
    store.set('userId', data.user_id);
    store.set('username', data.username);
    await keytar.setPassword(SERVICE, 'refresh', data.refresh_token);
    return data;
  });

  ipc.handle('api.login', async (_e, username: string, password: string) => {
    const data = await envelope<any>(axios.post(`${BASE}/auth/login`, { username, password }));
    store.set('accessToken', data.access_token);
    store.set('userId', data.user_id);
    store.set('username', data.username);
    await keytar.setPassword(SERVICE, 'refresh', data.refresh_token);
    return data;
  });

  ipc.handle('api.logout', async () => {
    const refresh = await keytar.getPassword(SERVICE, 'refresh');
    try { if (refresh) await axios.post(`${BASE}/auth/logout`, { refresh_token: refresh }, { headers: await authed() }); } catch {}
    store.clear();
    await keytar.deletePassword(SERVICE, 'refresh');
    await keytar.deletePassword(SERVICE, 'identity');
    return true;
  });

  ipc.handle('api.searchUsers', async (_e, q: string) => {
    return envelope<any[]>(axios.get(`${BASE}/users/search`, {
      params: { q }, headers: await authed(),
    }));
  });

  ipc.handle('api.getUserKeys', async (_e, id: string) => {
    const w = await envelope<any>(axios.get(`${BASE}/users/${id}/keys`, { headers: await authed() }));
    const spk = typeof w.signed_prekey === 'string' ? JSON.parse(w.signed_prekey) : w.signed_prekey;
    return {
      identityPublicKey: w.identity_public_key,
      signedPreKey: { keyId: spk.keyId ?? spk.key_id, publicKey: spk.publicKey ?? spk.public_key, signature: spk.signature },
      oneTimePreKey: w.one_time_prekey ? { keyId: w.one_time_prekey.key_id, publicKey: w.one_time_prekey.public_key } : undefined,
      registrationId: w.registration_id,
    };
  });

  ipc.handle('api.myNode', async () => {
    const w = await envelope<any>(axios.get(`${BASE}/region/my-node`, { headers: await authed() }));
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
