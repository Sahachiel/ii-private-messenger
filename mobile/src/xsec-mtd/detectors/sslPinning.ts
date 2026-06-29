import { MtdEvent } from '../types';

/**
 * Passive SSL-pinning signal.
 *
 * The previous active probe (fetch with a bogus pin) is unreliable on this library
 * version because `react-native-ssl-pinning` caches OkHttpClient per-domain and
 * ignores new options on subsequent calls. After the first real api.ts request
 * (pkPinning), the cached client accepts valid certs → the bogus-pin probe
 * returns 200 → false positive "SSL pinning bypassed" → auto-wipe trigger.
 *
 * Real MITM detection already happens: every api.ts request exercises the pin.
 * A request failure surfaces as a thunk rejection handled by each caller. A
 * native-module-backed cert-chain inspector lands in v0.3.
 */
export async function detectSslPinning(): Promise<MtdEvent[]> {
  return [] as MtdEvent[];
}
