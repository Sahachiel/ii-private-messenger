import type { Region, ProxyConfig } from '../types';

function required(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  // Defer throwing to runtime init — compile-time tolerant
  return '';
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface RegionNode {
  relay_url: string;
  turn_url: string;
  proxy_config?: ProxyConfig;
}

/**
 * Costruisce la ProxyConfig anti-censura per una region da env vars `PROXY_*_<SUFFIX>`,
 * con default opzionali. Ritorna undefined se non c'è un server (proxy disattivato per
 * quella region → il payload espone proxy_config: null).
 */
function proxyEnv(suffix: string, defaults?: Partial<ProxyConfig>): ProxyConfig | undefined {
  const server = required(`PROXY_SERVER_${suffix}`, defaults?.server ?? '');
  if (!server) return undefined;
  return {
    server,
    port: intEnv(`PROXY_PORT_${suffix}`, defaults?.port ?? 443),
    uuid: required(`PROXY_UUID_${suffix}`, defaults?.uuid ?? ''),
    pbk: required(`PROXY_PBK_${suffix}`, defaults?.pbk ?? ''),
    sid: required(`PROXY_SID_${suffix}`, defaults?.sid ?? ''),
    sni: required(`PROXY_SNI_${suffix}`, defaults?.sni ?? 'www.apple.com'),
    flow: required(`PROXY_FLOW_${suffix}`, defaults?.flow ?? 'xtls-rprx-vision'),
    fp: required(`PROXY_FP_${suffix}`, defaults?.fp ?? 'chrome'),
  };
}

export const REGION_NODES: Readonly<Record<Region, RegionNode>> = {
  ru: {
    relay_url: required('RELAY_URL_RU', 'wss://iimsg-ru.oleven-group.com/ws'),
    turn_url: required('TURN_URL_RU', 'turns:iimsg-ru.oleven-group.com:5349'),
    // Tunnel anti-censura per gli utenti in Russia: VPS REALITY in Helsinki.
    // Credenziali SOLO da env (PROXY_SERVER_RU/PROXY_UUID_RU/PROXY_PBK_RU/PROXY_SID_RU/...):
    // nessun segreto del proxy nel sorgente (il repo è pubblico). Se PROXY_SERVER_RU non è
    // impostata, proxy_config = null e il transport resta disattivato per quella region.
    proxy_config: proxyEnv('RU'),
  },
  ge: {
    relay_url: required('RELAY_URL_GE', 'wss://iimsg-ge.oleven-group.com/ws'),
    turn_url: required('TURN_URL_GE', 'turns:iimsg-ge.oleven-group.com:5349'),
  },
  fi: {
    // fi routing collassato su ge finché non si provisiona un VPS fi dedicato.
    relay_url: required('RELAY_URL_FI', 'wss://iimsg-ge.oleven-group.com/ws'),
    turn_url: required('TURN_URL_FI', 'turns:iimsg-ge.oleven-group.com:5349'),
  },
};

export const config = {
  nodeEnv: required('NODE_ENV', 'development'),
  port: intEnv('PORT', 3000),

  databaseUrl: required('DATABASE_URL', 'postgres://iipm:iipm@localhost:5432/iipm'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  // Password redis separata (opzionale): redis gira con --requirepass; passandola qui il client
  // autentica anche se l'URL è solo host:port. Vuota/assente = redis senza auth.
  redisPassword: process.env.REDIS_PASSWORD || undefined,

  jwt: {
    secret: required('JWT_SECRET', 'dev-insecure-jwt-secret-change-me'),
    accessTtl: required('JWT_ACCESS_TTL', '15m'),
    refreshTtl: required('JWT_REFRESH_TTL', '30d'),
    refreshTtlSeconds: 60 * 60 * 24 * 30,
    accessTtlSeconds: 60 * 15,
  },

  interNodeSecret: required('INTER_NODE_SECRET', 'dev-inter-node-secret'),

  turn: {
    sharedSecret: required('TURN_SHARED_SECRET', 'dev-turn-secret'),
    ttlSeconds: intEnv('TURN_TTL_SECONDS', 86400),
  },

  firebaseServiceAccountJson: process.env['FIREBASE_SERVICE_ACCOUNT_JSON'] ?? '',

  corsOrigins: required('CORS_ORIGINS', '*'),

  rateLimit: {
    authPerMin: intEnv('RATE_LIMIT_AUTH_PER_MIN', 10),
    generalPerMin: intEnv('RATE_LIMIT_GENERAL_PER_MIN', 100),
  },

  bcryptRounds: 12,
  otpReplenishThreshold: 10,
  otpReplenishBatch: 50,
} as const;

export type AppConfig = typeof config;
