import DeviceInfo from 'react-native-device-info';
import { NativeModules, Platform } from 'react-native';
import { MtdEvent } from '../types';
import { loadBlocklist } from '../storage/blocklist';
import { b64, sha256Hex } from '@utils/crypto';

/**
 * Enumerate installed apps (Android only reliably via native) and hash-check
 * each package name against the blocklist.
 */
export async function detectMaliciousApps(): Promise<MtdEvent[]> {
  const events: MtdEvent[] = [];
  if (Platform.OS !== 'android') return events;

  let packages: string[] = [];
  try {
    const InstalledApps: any = (NativeModules as any).InstalledApps || (NativeModules as any).RNInstalledApps;
    if (InstalledApps && typeof InstalledApps.getInstalledApps === 'function') {
      const apps = await InstalledApps.getInstalledApps();
      packages = apps.map((a: any) => a.packageName).filter(Boolean);
    } else if (typeof (DeviceInfo as any).getInstalledApplications === 'function') {
      const apps = await (DeviceInfo as any).getInstalledApplications();
      packages = apps.map((a: any) => a.packageName).filter(Boolean);
    }
  } catch {}

  if (packages.length === 0) return events;

  const bl = await loadBlocklist('apps');
  if (bl.length === 0) return events;

  const combined = new Set<string>();
  for (const entry of bl) {
    try {
      const p = JSON.parse(b64.dec(entry.payload_b64).toString('utf8')) as { hashes: string[] };
      p.hashes.forEach((h) => combined.add(h));
    } catch {}
  }
  const hits: string[] = [];
  for (const pkg of packages) {
    if (combined.has(sha256Hex(pkg))) hits.push(pkg);
  }
  if (hits.length > 0) {
    events.push({
      id: `apps-${Date.now()}`, ts: Date.now(),
      category: 'app_blocklist', severity: 'compromised',
      title: `${hits.length} flagged app(s) installed`,
      detail: { packages: hits },
    });
  }
  return events;
}
