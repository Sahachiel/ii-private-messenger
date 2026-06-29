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
  const MDM: any = (NativeModules as any).MDMInspector;
  if (!MDM || typeof MDM.list !== 'function') return events;
  try {
    const profiles: string[] = await MDM.list();
    const suspicious = profiles.filter((p) => !/oleven|iimsg/i.test(p));
    if (suspicious.length > 0) {
      events.push({
        id: `mdm-${Date.now()}`, ts: Date.now(),
        category: 'mdm_profile', severity: 'warning',
        title: `${suspicious.length} unauthorized ${Platform.OS === 'ios' ? 'configuration profile' : 'device admin'}(s)`,
        detail: { profiles: suspicious },
      });
    }
  } catch {}
  return events;
}
