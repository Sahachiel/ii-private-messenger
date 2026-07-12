import { NativeModules, Platform } from 'react-native';
import { appKv } from './keychain';

/**
 * Sicurezza schermo: FLAG_SECURE nativo (anti-screenshot / anti screen-recording / anteprima
 * app-switcher oscurata). Difensivo: se il modulo nativo non è presente (build senza il package,
 * o iOS) è un no-op. Default ATTIVO (privacy by default).
 */
const M = (NativeModules as { ScreenSecurity?: { setSecure(enabled: boolean): Promise<boolean> } }).ScreenSecurity;
const KEY = 'security.screenProtect';

export function isScreenProtectEnabled(): boolean {
  return appKv.getBoolean(KEY) ?? true;
}

/** Applica lo stato corrente (o quello passato, persistendolo) alla finestra nativa. */
export async function applyScreenProtect(enabled?: boolean): Promise<void> {
  if (typeof enabled === 'boolean') appKv.set(KEY, enabled);
  const on = enabled ?? isScreenProtectEnabled();
  if (Platform.OS !== 'android' || !M?.setSecure) return;
  try { await M.setSecure(on); } catch { /* no-op se il nativo fallisce */ }
}
