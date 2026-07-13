import { NativeModules, Platform } from 'react-native';
import { MtdEvent } from '../types';

/**
 * Detect unauthorized MDM/Device Admin enrollment.
 * iOS: enumerate installed configuration profiles (requires native module v0.3).
 * Android: list active device admin receivers (requires native bridge).
 * For now: stub that checks common telltales when available.
 */
export async function detectMdm(): Promise<MtdEvent[]> {
  const events: MtdEvent[] = [];
  const DS: any = (NativeModules as any).DeviceSecurity;
  const MDM: any = (NativeModules as any).MDMInspector;
  let profiles: string[] | null = null;
  // Reale su Android: device admin attivi (DevicePolicyManager) via DeviceSecurity.
  if (DS && typeof DS.listDeviceAdmins === 'function') {
    try { profiles = await DS.listDeviceAdmins(); } catch { profiles = null; }
  } else if (MDM && typeof MDM.list === 'function') {
    try { profiles = await MDM.list(); } catch { profiles = null; }
  }
  if (!profiles) return events; // modulo assente → non eseguito (la UI mostra N/A, non "OK")
  // Un dispositivo personale non dovrebbe avere device admin: qualunque admin non nostro è sospetto.
  const suspicious = profiles.filter((p) => !/oleven|iimsg/i.test(p));
  if (suspicious.length > 0) {
    events.push({
      id: `mdm-${Date.now()}`, ts: Date.now(),
      category: 'mdm_profile', severity: 'warning',
      title: `${suspicious.length} ${Platform.OS === 'ios' ? 'profilo di configurazione' : 'device admin'} non autorizzat${suspicious.length === 1 ? 'o' : 'i'}`,
      detail: { profiles: suspicious },
    });
  }
  return events;
}
