import { NativeModules, Platform } from 'react-native';
import type { ThreatCategory } from '../types';

const DS = (NativeModules as {
  DeviceSecurity?: { getWifiInfo?: unknown; getInstalledPackages?: unknown; listDeviceAdmins?: unknown };
}).DeviceSecurity;

/**
 * true se il detector può eseguire un controllo REALE su questa piattaforma/build.
 * Serve alla UI per NON mostrare "OK" (verdetto pulito) quando in realtà il controllo non è
 * stato eseguito (modulo nativo assente / iOS): in quel caso mostra "N/A". I detector JS-only
 * (root/jailbreak, debugger, SSL pinning, MITM, phishing) sono sempre disponibili.
 */
export function detectorAvailable(cat: ThreatCategory): boolean {
  switch (cat) {
    case 'wifi':          return Platform.OS === 'android' && !!DS?.getWifiInfo;
    case 'app_blocklist': return Platform.OS === 'android' && !!DS?.getInstalledPackages;
    case 'mdm_profile':   return Platform.OS === 'android' && !!DS?.listDeviceAdmins;
    default:              return true;
  }
}
