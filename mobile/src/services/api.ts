import { fetch as pinnedFetch } from 'react-native-ssl-pinning';
import { KC, appKv } from './keychain';
import {
  User, AuthResponse, Contact, RemoteKeyBundle, Region, TurnConfig, ProxyConfig,
} from '../types';

const API_BASE = __DEV__
  ? 'http://10.0.2.2:3000/api'
  : 'https://iimsg-api.oleven-group.com/api';

// Public-key pinning (pkPinning): SHA-256 dei SubjectPublicKeyInfo in base64.
// Non servono file — bypassa il bug di `react-native-ssl-pinning` v1.6.x che su Android
// non riesce a leggere asset compressi tramite ClassLoader.getResourceAsStream (causa
// runtime crash "SSLContext is not initialized"). Pin multi-layer: 3 leaf + 2 LE
// intermediate + 1 ISRG root → sopravvive ai renewals certbot ogni 90gg.
const SSL_PINS = [
  'sha256/4BbXj4s1g1WlRHdpKcaP2FXMVvZD5NXlc1XFFpWLcnk=', // iimsg-api leaf (scad 2026-07-14)
  'sha256/jALHuxwxFeM8XuQox8IM4IkmpJ9iemaL92nL8ehRtBs=', // iimsg-ru leaf
  'sha256/APhF5EKb0Lmde/PkRV4TqrZmPZuTsnsP5D5UnjysunM=', // iimsg-ge leaf
  // Intermediate ATTUALE della catena live = Let's Encrypt E7 (ECDSA). Il backend è migrato
  // da RSA (R10/R11) a ECDSA (E7): senza questo pin, al rinnovo del leaf (imminente) il pinning
  // fallirebbe e ROMPEREBBE tutto l'HTTPS su Android. Pinnare l'intermediate sopravvive ai renewals.
  'sha256/y7xVm0TVJNahMr2sZydE2jQH8SquXV9yLF9seROHHHU=', // LE E7 intermediate (ECDSA) — catena live
  'sha256/K7rZOrXHknnsEhUH8nLL4MZkejquUuIvOIr6tCa0rbo=', // LE R10 intermediate (RSA, legacy)
  'sha256/bdrBhpj38ffhxpubzkINl0rG+UyossdhcBYj+Zx2fcc=', // LE R11 intermediate (RSA, legacy)
  'sha256/C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=', // ISRG Root X1
];

let accessToken: string | null = appKv.getString('auth.accessToken') ?? null;
export function setAccessToken(t: string | null): void {
  accessToken = t;
  if (t) appKv.set('auth.accessToken', t); else appKv.delete('auth.accessToken');
}

type Envelope<T> = { success: boolean; data: T; error?: string };

async function request<T>(path: string, init: { method?: string; body?: any; auth?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = init;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const doFetch = async (): Promise<Envelope<T>> => {
    if (__DEV__) {
      const r = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return (await r.json()) as Envelope<T>;
    }
    const r = await pinnedFetch(`${API_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      pkPinning: true,
      sslPinning: { certs: SSL_PINS },
      timeoutInterval: 15000,
    });
    return JSON.parse(r.bodyString) as Envelope<T>;
  };

  let env = await doFetch();
  if (!env.success && env.error === 'auth.expired') {
    const ok = await refreshAccessToken();
    if (ok) {
      headers.Authorization = `Bearer ${accessToken}`;
      env = await doFetch();
    }
  }
  if (!env.success) throw new Error(env.error ?? 'request failed');
  return env.data;
}

async function refreshAccessToken(): Promise<boolean> {
  const r = await KC.getToken();
  if (!r || !r.password) return false;
  try {
    const data = await request<{ access_token: string; refresh_token?: string }>(
      '/auth/refresh', { method: 'POST', body: { refresh_token: r.password }, auth: false },
    );
    setAccessToken(data.access_token);
    if (data.refresh_token) await KC.setToken(data.refresh_token);
    return true;
  } catch {
    setAccessToken(null);
    await KC.clearToken();
    return false;
  }
}

// ---------- type translators (wire ↔ client) ----------

interface WireAuthData {
  user_id: string; username: string; region: Region;
  relay_url: string; turn_url: string;
  turn_username?: string; turn_credential?: string; turn_ttl?: number;
  access_token: string; refresh_token: string;
  display_name?: string; avatar_url?: string | null; country_code?: string;
  proxy_config?: ProxyConfig | null;
}

function authFromWire(w: WireAuthData, fallback: Partial<User> = {}): AuthResponse {
  const user: User = {
    id: w.user_id,
    username: w.username,
    displayName: w.display_name ?? fallback.displayName ?? w.username,
    avatarUrl: w.avatar_url ?? undefined,
    countryCode: w.country_code ?? fallback.countryCode ?? '',
    region: w.region,
  };
  const turnConfig: TurnConfig = {
    urls: [w.turn_url],
    username: w.turn_username ?? '',
    credential: w.turn_credential ?? '',
    ttl: w.turn_ttl ?? 86400,
  };
  return { user, accessToken: w.access_token, refreshToken: w.refresh_token, relayUrl: w.relay_url, turnConfig, proxyConfig: w.proxy_config ?? null };
}

// ---------- endpoints ----------

export const authApi = {
  async register(payload: {
    username: string; displayName: string; password: string; phone?: string;
    countryCode: string;
    identityPublicKey: string;
    signedPreKey: { keyId: number; publicKey: string; signature: string };
    registrationId: number;
    oneTimePreKeys: { keyId: number; publicKey: string }[];
    fcmToken?: string;
  }): Promise<AuthResponse> {
    const wire = await request<WireAuthData>('/auth/register', {
      method: 'POST', auth: false,
      body: {
        username: payload.username,
        display_name: payload.displayName,
        phone: payload.phone,
        password: payload.password,
        country_code: payload.countryCode.toUpperCase(),
        identity_public_key: payload.identityPublicKey,
        signed_prekey: JSON.stringify(payload.signedPreKey),
        registration_id: payload.registrationId,
        one_time_prekeys: payload.oneTimePreKeys.map((k) => ({ key_id: k.keyId, public_key: k.publicKey })),
        fcm_token: payload.fcmToken,
      },
    });
    return authFromWire(wire, { displayName: payload.displayName, countryCode: payload.countryCode });
  },

  async login(username: string, password: string, fcmToken?: string): Promise<AuthResponse> {
    const wire = await request<WireAuthData>('/auth/login', {
      method: 'POST', auth: false, body: { username, password, fcm_token: fcmToken },
    });
    return authFromWire(wire);
  },

  async logout(): Promise<void> {
    const r = await KC.getToken();
    if (!r || !r.password) return;
    try { await request('/auth/logout', { method: 'POST', body: { refresh_token: r.password } }); } catch {}
  },

  refresh: (): Promise<boolean> => refreshAccessToken(),

  getAccessToken: (): string | null => accessToken,
};

export const usersApi = {
  async search(q: string): Promise<User[]> {
    const rows = await request<any[]>(`/users/search?q=${encodeURIComponent(q)}`);
    return rows.map((r) => ({
      id: r.id, username: r.username, displayName: r.display_name ?? r.username,
      avatarUrl: r.avatar_url ?? undefined,
      countryCode: r.country_code ?? '', region: r.region ?? 'ge',
    }));
  },

  async keys(id: string): Promise<RemoteKeyBundle> {
    const w = await request<any>(`/users/${id}/keys`);
    const spk = typeof w.signed_prekey === 'string' ? JSON.parse(w.signed_prekey) : w.signed_prekey;
    return {
      identityPublicKey: w.identity_public_key,
      signedPreKey: { keyId: spk.keyId ?? spk.key_id, publicKey: spk.publicKey ?? spk.public_key, signature: spk.signature },
      oneTimePreKey: w.one_time_prekey
        ? { keyId: w.one_time_prekey.key_id, publicKey: w.one_time_prekey.public_key }
        : undefined,
      registrationId: w.registration_id,
    };
  },

  // Discovery solo-codice: il mio codice (da condividere) e la risoluzione di un codice altrui.
  async myCode(): Promise<string> {
    const w = await request<{ user_code: string }>('/users/me/code');
    return w.user_code;
  },
  async byCode(code: string): Promise<{ id: string; displayName: string; userCode: string } | null> {
    try {
      const w = await request<any>(`/users/by-code/${encodeURIComponent(code.trim())}`);
      return { id: w.id, displayName: w.display_name ?? String(w.id).slice(0, 8), userCode: w.user_code };
    } catch { return null; }
  },

  async updateMe(patch: Partial<{ displayName: string; avatarUrl: string }>): Promise<User> {
    await request<{ updated: boolean }>('/users/me', {
      method: 'PATCH',
      body: { display_name: patch.displayName, avatar_url: patch.avatarUrl },
    });
    return {
      id: appKv.getString('auth.userId') ?? '', username: appKv.getString('auth.username') ?? '',
      displayName: patch.displayName ?? '', avatarUrl: patch.avatarUrl, countryCode: '', region: 'ge',
    };
  },

  replenishPreKeys(preKeys: { keyId: number; publicKey: string }[]): Promise<{ inserted: number; remaining: number }> {
    return request('/users/me/prekeys/replenish', {
      method: 'POST',
      body: { one_time_prekeys: preKeys.map((k) => ({ key_id: k.keyId, public_key: k.publicKey })) },
    });
  },

  updateFcmToken(fcmToken: string): Promise<{ updated: boolean }> {
    return request('/users/me', { method: 'PATCH', body: { fcm_token: fcmToken } });
  },
};

export const contactsApi = {
  async list(): Promise<Contact[]> {
    const rows = await request<any[]>('/contacts');
    return rows.map((r) => ({
      id: r.contact_id ?? r.id,
      username: r.username, displayName: r.display_name ?? r.username,
      avatarUrl: r.avatar_url ?? undefined,
      countryCode: r.country_code ?? '', region: r.region ?? 'ge',
      nickname: r.nickname ?? undefined,
      isBlocked: !!r.is_blocked,
    }));
  },
  async add(userId: string): Promise<Contact> {
    const r = await request<any>('/contacts', { method: 'POST', body: { contact_id: userId } });
    return {
      id: r.contact_id ?? r.id ?? userId,
      username: r.username ?? '', displayName: r.display_name ?? '',
      countryCode: '', region: 'ge', isBlocked: false,
    };
  },
  remove: (id: string) => request<{}>(`/contacts/${id}`, { method: 'DELETE' }),
  block:   (id: string) => request<{}>(`/contacts/${id}/block`,   { method: 'POST' }),
  unblock: (id: string) => request<{}>(`/contacts/${id}/unblock`, { method: 'POST' }),
};

export const regionApi = {
  async myNode(): Promise<{ region: Region; relayUrl: string; turnConfig: TurnConfig; proxyConfig: ProxyConfig | null }> {
    const w = await request<any>('/region/my-node');
    const tc = w.turn_credentials ?? {};
    const rawUrls = tc.urls ?? w.turn_url;
    const urls = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
    return {
      region: w.region,
      relayUrl: w.relay_url,
      turnConfig: {
        urls, username: tc.username ?? '', credential: tc.credential ?? '', ttl: tc.ttl ?? 86400,
      },
      proxyConfig: w.proxy_config ?? null,
    };
  },
};

export interface GroupSummary { id: string; role: string; epoch: number; member_count: number }
export interface GroupMember { user_id: string; role: string; member_epoch: number }

// Gruppi isolati: tutte le operazioni passano per il transport esistente (request()).
// Il backend è zero-knowledge sui contenuti: nome/avatar del gruppo NON viaggiano qui,
// restano cifrati lato client. Qui passano solo UUID opachi, ruoli, epoch, token firmati.
export const groupsApi = {
  create: (maxMembers?: number) =>
    request<{ id: string; epoch: number }>('/groups', { method: 'POST', body: { max_members: maxMembers } }),
  list: () => request<GroupSummary[]>('/groups'),
  members: (gid: string) => request<GroupMember[]>(`/groups/${gid}/members`),
  capability: (gid: string) => request<{ cap: string; epoch: number }>(`/groups/${gid}/capability`),
  invite: (gid: string, opts: { bound_user_id?: string | null; requires_approval?: boolean; max_uses?: number; ttl_seconds?: number }) =>
    request<{ token: string; expires_at: number }>(`/groups/${gid}/invites`, { method: 'POST', body: opts }),
  revokeInvite: (gid: string, inviteId: string) =>
    request<{ revoked: boolean }>(`/groups/${gid}/invites/${inviteId}`, { method: 'DELETE' }),
  join: (token: string) =>
    request<{ status: 'joined' | 'pending' | 'already_member'; gid: string }>('/groups/join', { method: 'POST', body: { token } }),
  joinRequests: (gid: string) => request<Array<{ user_id: string; created_at: string }>>(`/groups/${gid}/join-requests`),
  decide: (gid: string, userId: string, approve: boolean) =>
    request<{ epoch: number | null }>(`/groups/${gid}/join-requests/${userId}`, { method: 'POST', body: { approve } }),
  leave: (gid: string) => request<{ left: boolean; epoch: number }>(`/groups/${gid}/leave`, { method: 'POST' }),
  remove: (gid: string, userId: string) =>
    request<{ removed: boolean; epoch: number }>(`/groups/${gid}/members/${userId}`, { method: 'DELETE' }),
};

export const messagesApi = {
  remove: (id: string) => request<{ id: string }>(`/messages/${id}`, { method: 'DELETE' }),
};
