import * as Keychain from 'react-native-keychain';
import { MMKV } from 'react-native-mmkv';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

const KC_OPTS: Keychain.Options = {
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
  authenticationType: Keychain.AUTHENTICATION_TYPE.BIOMETRICS,
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
};

export const appKv = new MMKV({ id: 'ii-app' });

let encryptionKey: string | null = null;
async function ensureMmkvKey(): Promise<string> {
  if (encryptionKey) return encryptionKey;
  const existing = await Keychain.getInternetCredentials('ii.mmkv.key');
  if (existing && existing.password) { encryptionKey = existing.password; return encryptionKey; }
  const bytes = nacl.randomBytes(32);
  const key = Buffer.from(bytes).toString('hex');
  await Keychain.setInternetCredentials('ii.mmkv.key', 'ii', key, { accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  encryptionKey = key;
  return key;
}

let _secure: MMKV | null = null;
export async function getSecureKv(): Promise<MMKV> {
  if (_secure) return _secure;
  const key = await ensureMmkvKey();
  _secure = new MMKV({ id: 'ii-secure', encryptionKey: key });
  return _secure;
}

export const KC = {
  setCreds: (username: string, password: string) =>
    Keychain.setGenericPassword(username, password, { ...KC_OPTS, service: 'ii.creds' }),
  getCreds: () => Keychain.getGenericPassword({ service: 'ii.creds' }),
  clearCreds: () => Keychain.resetGenericPassword({ service: 'ii.creds' }),

  setToken: (token: string) =>
    Keychain.setInternetCredentials('ii.refreshToken', 'ii', token, {
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  getToken: () => Keychain.getInternetCredentials('ii.refreshToken'),
  clearToken: () => Keychain.resetInternetCredentials({ server: 'ii.refreshToken' }),

  setIdentity: (json: string) =>
    Keychain.setInternetCredentials('ii.signal.identity', 'ii', json, {
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  getIdentity: () => Keychain.getInternetCredentials('ii.signal.identity'),
  clearIdentity: () => Keychain.resetInternetCredentials({ server: 'ii.signal.identity' }),

  getSupportedBiometry: () => Keychain.getSupportedBiometryType(),
};
