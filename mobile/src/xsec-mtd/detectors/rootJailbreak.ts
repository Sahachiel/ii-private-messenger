import { Platform, NativeModules } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { MtdEvent } from '../types';

const androidIndicators = [
  '/system/app/Superuser.apk',
  '/sbin/su', '/system/bin/su', '/system/xbin/su',
  '/data/local/xbin/su', '/data/local/bin/su',
  '/system/sd/xbin/su', '/system/bin/failsafe/su',
  '/system/etc/init.d/99SuperSUDaemon',
  '/data/adb/magisk', '/data/adb/modules',
];

const iosIndicators = [
  '/Applications/Cydia.app',
  '/Applications/Sileo.app',
  '/Applications/Zebra.app',
  '/Library/MobileSubstrate/MobileSubstrate.dylib',
  '/usr/libexec/cydia',
  '/bin/bash', '/usr/sbin/sshd', '/etc/apt',
  '/private/var/stash', '/private/var/lib/cydia',
];

export async function detectRootJailbreak(): Promise<MtdEvent[]> {
  const events: MtdEvent[] = [];
  let flagged = false;
  const detail: Record<string, unknown> = {};

  try {
    const isJailBroken = await (DeviceInfo as any).isJailBroken?.();
    if (isJailBroken) { flagged = true; detail.device_info = true; }
  } catch {}

  try {
    const emu = await DeviceInfo.isEmulator();
    if (emu) detail.emulator = true;
  } catch {}

  // Best-effort file existence check via react-native-fs would require extra dep;
  // use a native module call if available, else skip.
  const FS: any = NativeModules.RNFSManager || NativeModules.ReactNativeBlobUtil;
  if (FS && typeof FS.exists === 'function') {
    const list = Platform.OS === 'android' ? androidIndicators : iosIndicators;
    const hits: string[] = [];
    for (const p of list) {
      try { if (await FS.exists(p)) hits.push(p); } catch {}
    }
    if (hits.length > 0) { flagged = true; detail.indicators = hits; }
  }

  if (flagged) {
    events.push({
      id: `rj-${Date.now()}`,
      ts: Date.now(),
      category: 'root_jailbreak',
      severity: 'compromised',
      title: Platform.OS === 'ios' ? 'Jailbreak detected' : 'Root access detected',
      detail,
    });
  }
  return events;
}
