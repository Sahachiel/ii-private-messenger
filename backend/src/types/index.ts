export type Region = 'ru' | 'ge' | 'fi';

export interface User {
  id: string;
  username: string;
  phone: string | null;
  display_name: string;
  avatar_url: string | null;
  country_code: string;
  region: Region;
  password_hash: string;
  identity_public_key: string;
  signed_prekey: string;
  registration_id: number;
  fcm_token: string | null;
  last_seen: Date | null;
  is_active: boolean;
  created_at: Date;
}

export interface SignedPrekey {
  key_id: number;
  public_key: string;
  signature: string;
}

export interface OneTimePrekey {
  key_id: number;
  public_key: string;
}

export interface KeyBundle {
  identity_public_key: string;
  signed_prekey: SignedPrekey | string;
  one_time_prekey: OneTimePrekey | null;
  registration_id: number;
}

export interface RegisterRequest {
  username: string;
  display_name: string;
  phone?: string;
  password: string;
  country_code: string;
  identity_public_key: string;
  signed_prekey: string;
  registration_id: number;
  one_time_prekeys: OneTimePrekey[];
  fcm_token?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  fcm_token?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TurnConfig {
  urls: string;
  username: string;
  credential: string;
  ttl: number;
}

/**
 * Config del transport anti-censura (VLESS + XTLS-Vision + REALITY).
 * Distribuita ai client nella region soggetta a censura (ru): il client la usa
 * per avviare il proprio tunnel per-app verso il VPS REALITY. I campi pbk/sid/sni
 * sono pubblici per natura; uuid è la credenziale di accesso al proxy.
 */
export interface ProxyConfig {
  server: string;
  port: number;
  uuid: string;
  pbk: string;
  sid: string;
  sni: string;
  flow: string;
  fp: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  region: Region;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
