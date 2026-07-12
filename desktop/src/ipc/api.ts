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

function jwtExpired(jwt: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
    return !payload.exp || payload.exp * 1000 < Date.now() + 5000; // 5s di margine
  } catch {
    return false;
  }
}

// Rinnova l'access token usando il refresh token in keytar. Ritorna il nuovo token o null.
async function refreshAccessToken(): Promise<string | null> {
  const refresh = await keytar.getPassword(SERVICE, 'refresh');
  if (!refresh) return null;
  try {
    const r = await axios.post(`${BASE}/auth/refresh`, { refresh_token: refresh });
    const d = r.data?.data;
    if (r.data?.success && d) {
      store.set('accessToken', d.access_token);
      await keytar.setPassword(SERVICE, 'refresh', d.refresh_token);
      return d.access_token as string;
    }
  } catch { /* refresh fallito → sessione da rifare */ }
  return null;
}

// Ritorna un access token VALIDO (rinnova col refresh token se scaduto). Usato sia da authed()
// per le API sia dal socket per (ri)autenticarsi al relay senza restare col token scaduto.
export async function getValidToken(): Promise<string | null> {
  let t = await getToken();
  if (t && jwtExpired(t)) t = (await refreshAccessToken()) ?? t;
  return t;
}

async function authed(): Promise<Record<string, string>> {
  const t = await getValidToken();
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

  // ---- Gruppi (app group-centric): il backend è zero-knowledge sui contenuti; qui passano
  // solo UUID opachi, ruoli, epoch e token/capability firmati. Stesse rotte del mobile groupsApi.
  ipc.handle('groups.create', async (_e, maxMembers?: number) =>
    envelope<{ id: string; epoch: number }>(axios.post(`${BASE}/groups`, { max_members: maxMembers }, { headers: await authed() })));
  ipc.handle('groups.list', async () =>
    envelope<Array<{ id: string; role: string; epoch: number; member_count: number }>>(axios.get(`${BASE}/groups`, { headers: await authed() })));
  ipc.handle('groups.members', async (_e, gid: string) =>
    envelope<Array<{ user_id: string; role: string; member_epoch: number }>>(axios.get(`${BASE}/groups/${gid}/members`, { headers: await authed() })));
  ipc.handle('groups.capability', async (_e, gid: string) =>
    envelope<{ cap: string; epoch: number }>(axios.get(`${BASE}/groups/${gid}/capability`, { headers: await authed() })));
  ipc.handle('groups.invite', async (_e, gid: string, opts: Record<string, unknown>) =>
    envelope<{ token: string; expires_at: number }>(axios.post(`${BASE}/groups/${gid}/invites`, opts ?? {}, { headers: await authed() })));
  ipc.handle('groups.join', async (_e, token: string) =>
    envelope<{ status: 'joined' | 'pending' | 'already_member'; gid: string }>(axios.post(`${BASE}/groups/join`, { token }, { headers: await authed() })));
  ipc.handle('groups.joinRequests', async (_e, gid: string) =>
    envelope<Array<{ user_id: string; created_at: string }>>(axios.get(`${BASE}/groups/${gid}/join-requests`, { headers: await authed() })));
  ipc.handle('groups.decide', async (_e, gid: string, userId: string, approve: boolean) =>
    envelope<{ epoch: number | null }>(axios.post(`${BASE}/groups/${gid}/join-requests/${userId}`, { approve }, { headers: await authed() })));
}
