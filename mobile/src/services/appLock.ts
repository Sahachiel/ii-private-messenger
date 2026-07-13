import * as Keychain from 'react-native-keychain';
import { appKv, KC, getSecureKv } from './keychain';
import { sha256Hex } from '@utils/crypto';

/**
 * Blocco applicazione con biometria / impronta / passcode.
 *
 * A sessione già attiva, se il blocco è abilitato l'app si apre (avvio a freddo o rientro da
 * background oltre la "grace") solo dopo l'autenticazione biometrica. Il trucco, con
 * react-native-keychain, è custodire un "canary" nel Keystore protetto da BIOMETRY_ANY_OR_
 * DEVICE_PASSCODE: leggerlo forza il prompt biometrico del sistema. Se la lettura riesce →
 * autenticato; se fallisce/annullato → resta bloccato. Nessun segreto reale è in gioco: è solo
 * un gate. Android ora; iPhone più avanti (stessa API keychain).
 */
const SERVICE = 'ii.applock';
const KEY_ENABLED = 'lock.enabled';
const KEY_GRACE = 'lock.graceSec';       // secondi di tolleranza dopo il background (0 = immediato)
const KEY_LASTBG = 'lock.lastBackgroundAt';

export function isLockEnabled(): boolean {
  return appKv.getBoolean(KEY_ENABLED) ?? false;
}

export function getGraceSec(): number {
  const v = appKv.getNumber(KEY_GRACE);
  return v === undefined ? 0 : v;
}
export function setGraceSec(sec: number): void { appKv.set(KEY_GRACE, sec); }

export async function getSupportedBiometry(): Promise<string | null> {
  try { return (await Keychain.getSupportedBiometryType()) as string | null; } catch { return null; }
}

/** Prompt biometrico: legge il canary protetto. true = autenticato. */
export async function authenticate(reason = 'Sblocca II Private Messenger'): Promise<boolean> {
  try {
    const r = await Keychain.getGenericPassword({
      service: SERVICE,
      authenticationPrompt: { title: reason },
    });
    return !!r;
  } catch {
    return false;
  }
}

/** Abilita il blocco: crea il canary protetto e conferma con una verifica reale. */
export async function enableLock(): Promise<boolean> {
  try {
    await Keychain.setGenericPassword('ii', 'locked', {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
      authenticationType: Keychain.AUTHENTICATION_TYPE.BIOMETRICS,
    });
  } catch {
    return false;
  }
  // Verifica subito: se l'utente non riesce a sbloccare, non attivare (evita lock-out).
  const ok = await authenticate('Conferma per attivare il blocco');
  if (!ok) { try { await Keychain.resetGenericPassword({ service: SERVICE }); } catch {} return false; }
  appKv.set(KEY_ENABLED, true);
  return true;
}

export async function disableLock(): Promise<void> {
  appKv.set(KEY_ENABLED, false);
  try { await Keychain.resetGenericPassword({ service: SERVICE }); } catch {}
}

/** true se al rientro in foreground bisogna richiedere lo sblocco. */
export function shouldLockOnForeground(): boolean {
  if (!isLockEnabled()) return false;
  const grace = getGraceSec();
  const last = appKv.getNumber(KEY_LASTBG);
  if (last === undefined) return true;
  return (Date.now() - last) / 1000 >= grace;
}

export function markBackground(): void {
  appKv.set(KEY_LASTBG, Date.now());
}

// ─── Panic / duress wipe ────────────────────────────────────────────────────────────────────
// Cancellazione TOTALE e irreversibile: distrugge identità Signal, sessioni Double Ratchet,
// chiavi ML-KEM, one-time prekey, chat, gruppi — tutto. Usata sia dall'utente (cancellazione
// d'emergenza) sia dal PIN di coercizione (chi è costretto a sbloccare digita un PIN che, invece
// di aprire, cancella tutto e mostra un'app vuota).
const KEY_DURESS = 'lock.duressHash';
const DURESS_SALT = 'iimsg-duress-v1:';

export function setDuressPin(pin: string | null): void {
  if (!pin) { appKv.delete(KEY_DURESS); return; }
  appKv.set(KEY_DURESS, sha256Hex(DURESS_SALT + pin));
}
export function hasDuressPin(): boolean { return !!appKv.getString(KEY_DURESS); }
export function isDuressPin(pin: string): boolean {
  const h = appKv.getString(KEY_DURESS);
  return !!h && !!pin && h === sha256Hex(DURESS_SALT + pin);
}

/** Distrugge ogni chiave e dato locale. Best-effort su ogni store (non si ferma al primo errore). */
export async function panicWipe(): Promise<void> {
  try { await KC.clearToken(); } catch { /* */ }
  try { await KC.clearCreds(); } catch { /* */ }
  try { await KC.clearIdentity(); } catch { /* */ }
  try { (await getSecureKv()).clearAll(); } catch { /* */ }
  try { appKv.clearAll(); } catch { /* */ }
}
