import { NativeModules } from 'react-native';
import { MtdEvent, BlocklistEntry } from '../types';
import { loadBlocklist } from '../storage/blocklist';
import { b64, sha256Hex } from '@utils/crypto';

const KNOWN_KARMA_PATTERNS = [/^Free[\s_-]?Wi?Fi/i, /^Airport[\s_-]?Free/i, /^xfinitywifi$/i];

/**
 * Best-effort Wi-Fi threat scan.
 * Uses NetInfo for basic state; rogue BSSID detection requires native perm + module.
 */
export async function detectWifi(): Promise<MtdEvent[]> {
  const events: MtdEvent[] = [];
  // Try react-native-wifi-reborn if present
  const Wifi: any = (NativeModules as any).WifiManager || (NativeModules as any).RNCWifi;
  if (!Wifi || typeof Wifi.getCurrentWifiSSID !== 'function') {
    // No perms / not installed → skip silently
    return events;
  }
  try {
    const ssid: string = await Wifi.getCurrentWifiSSID();
    const bssid: string = typeof Wifi.getBSSID === 'function' ? await Wifi.getBSSID() : '';
    const secType: string = typeof Wifi.getCurrentCapabilities === 'function' ? await Wifi.getCurrentCapabilities() : '';
    const isOpen = !secType || /WPA|WEP|WPA2|WPA3/i.test(secType) === false;

    if (isOpen && ssid) {
      events.push({
        id: `wifi-open-${Date.now()}`, ts: Date.now(),
        category: 'wifi', severity: 'warning',
        title: `Connected to open network: ${ssid}`,
        detail: { ssid, bssid, secType },
      });
    }
    if (ssid && KNOWN_KARMA_PATTERNS.some((r) => r.test(ssid))) {
      events.push({
        id: `wifi-karma-${Date.now()}`, ts: Date.now(),
        category: 'wifi', severity: 'warning',
        title: 'Suspicious SSID (karma/decoy pattern)',
        detail: { ssid },
      });
    }

    // Rogue BSSID blocklist check
    const bl = await loadBlocklist('rogue_bssid');
    if (bssid && bl.length > 0) {
      const bssidHash = sha256Hex(bssid.toLowerCase());
      for (const entry of bl) {
        const payload = JSON.parse(b64.dec(entry.payload_b64).toString('utf8')) as { hashes: string[] };
        if (payload.hashes.includes(bssidHash)) {
          events.push({
            id: `wifi-rogue-${Date.now()}`, ts: Date.now(),
            category: 'wifi', severity: 'compromised',
            title: `Rogue access point detected`,
            detail: { bssid, list_version: entry.version },
          });
          break;
        }
      }
    }
  } catch {
    // no perm or error → ignore
  }
  return events;
}
