import { MtdEvent } from '../types';
import { loadBlocklist } from '../storage/blocklist';
import { b64, sha256Hex } from '@utils/crypto';

const URL_REGEX = /\bhttps?:\/\/[^\s<>'")]+/gi;
const SUSPICIOUS_PATTERNS: RegExp[] = [
  /bit\.ly\/[a-z0-9]{4,}/i, /tinyurl\.com\//i,
  /[a-z0-9-]{8,}\.tk\b/i, /[a-z0-9-]{8,}\.ml\b/i, /[a-z0-9-]{8,}\.ga\b/i,
  /login[-.]?[a-z0-9-]*\.(xyz|top|site|online|live)\b/i,
  /paypal[-.]?secure/i, /apple[-.]?id[-.]?verify/i,
  /[a-z0-9-]+\.oleven[0-9-]+/i, // impersonation Oleven
];

function extractHost(u: string): string | null {
  try { return new URL(u).host.toLowerCase(); } catch { return null; }
}

/**
 * Scan a string for suspicious URLs.
 * Returns one event per hit (severity warning; phishing blocklist hit = compromised).
 */
export async function scanTextForPhishing(text: string): Promise<MtdEvent[]> {
  const events: MtdEvent[] = [];
  if (!text) return events;

  const matches = text.match(URL_REGEX) ?? [];
  if (matches.length === 0) return events;

  const bl = await loadBlocklist('phishing');
  const blockedHosts = new Set<string>();
  for (const entry of bl) {
    try {
      const p = JSON.parse(b64.dec(entry.payload_b64).toString('utf8')) as { hashes: string[] };
      p.hashes.forEach((h) => blockedHosts.add(h));
    } catch {}
  }

  for (const url of matches) {
    const host = extractHost(url);
    if (!host) continue;
    const hostHash = sha256Hex(host);
    if (blockedHosts.has(hostHash)) {
      events.push({
        id: `ph-${Date.now()}-${hostHash.slice(0, 8)}`, ts: Date.now(),
        category: 'phishing', severity: 'compromised',
        title: `Phishing link: ${host}`,
        detail: { url, host },
      });
    } else if (SUSPICIOUS_PATTERNS.some((r) => r.test(url))) {
      events.push({
        id: `ph-heur-${Date.now()}-${hostHash.slice(0, 8)}`, ts: Date.now(),
        category: 'phishing', severity: 'warning',
        title: `Suspicious link pattern: ${host}`,
        detail: { url, host },
      });
    }
  }
  return events;
}
