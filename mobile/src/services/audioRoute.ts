import { NativeModules, Platform } from 'react-native';

/**
 * Instradamento audio delle chiamate (vivavoce). Difensivo: no-op se il modulo nativo è assente
 * (iOS / build senza il package). Su Android usa AudioManager in modalità comunicazione.
 */
const M = (NativeModules as { AudioRoute?: { setSpeaker(on: boolean): Promise<boolean> } }).AudioRoute;

export async function setSpeaker(on: boolean): Promise<void> {
  if (Platform.OS !== 'android' || !M?.setSpeaker) return;
  try { await M.setSpeaker(on); } catch { /* no-op */ }
}
