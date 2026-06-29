import axios from 'axios';
import { BlocklistEntry, ThreatCategory } from '../types';
import { acceptEntry, getVersion } from '../storage/blocklist';

type Kind = 'apps' | 'phishing' | 'rogue_bssid' | 'malicious_ip' | 'cert_pins';
const KINDS: Kind[] = ['apps', 'phishing', 'rogue_bssid', 'malicious_ip', 'cert_pins'];

function apiBase(): string {
  return __DEV__ ? 'http://10.0.2.2:3000/api' : 'https://iimsg-api.oleven-group.com/api';
}

export async function syncBlocklists(): Promise<{ kind: Kind; accepted: number; rejected: number }[]> {
  const results = [] as { kind: Kind; accepted: number; rejected: number }[];
  for (const kind of KINDS) {
    const since = await getVersion(kind);
    try {
      const { data } = await axios.get(`${apiBase()}/mtd/blocklist`, {
        params: { kind, since }, timeout: 15000,
      });
      const entries: BlocklistEntry[] = data?.data?.entries ?? [];
      let ok = 0, bad = 0;
      for (const e of entries) {
        const accepted = await acceptEntry(kind, e);
        if (accepted) ok++; else bad++;
      }
      results.push({ kind, accepted: ok, rejected: bad });
    } catch { results.push({ kind, accepted: 0, rejected: 0 }); }
  }
  return results;
}

export async function fetchAdminPubkey(): Promise<{ public_key_b64: string; fingerprint: string } | null> {
  try {
    const { data } = await axios.get(`${apiBase()}/mtd/admin-pubkey`, { timeout: 10000 });
    if (data?.success) return data.data;
  } catch {}
  return null;
}

// stash helper (we don't want a dep cycle with types)
export const _kinds = KINDS; void (null as unknown as ThreatCategory);
