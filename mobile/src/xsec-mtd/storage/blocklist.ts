/**
 * Blocklist cache — signed blobs fetched from iimsg-api/mtd/blocklist.
 * Signature verification: Ed25519 over sha256(payload), signer_pub_b64 must match
 * the pinned Oleven blocklist signer key.
 */
import { MMKV } from 'react-native-mmkv';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { BlocklistEntry, ThreatCategory } from '../types';
import { getSecureKv } from '@services/keychain';
import { b64 } from '@utils/crypto';

// Pinned Oleven blocklist signing public key (Ed25519 raw, base64).
// Generated 2026-04-15. Rotation requires APK rebuild. fp=0f35f5eb8a8b1bcb...
export const PINNED_SIGNER_PUB_B64 = 'wgRU/4Tl8OpP0iZSoSphRzGT6mLxFYWZKCWx13ozTvU=';

type Kind = 'apps' | 'phishing' | 'rogue_bssid' | 'malicious_ip' | 'cert_pins';
const kvKey = (k: Kind) => `xsec-mtd.blocklist.${k}`;
const verKey = (k: Kind) => `xsec-mtd.blocklist.${k}.ver`;

let _kv: MMKV | null = null;
async function kv(): Promise<MMKV> { if (!_kv) _kv = await getSecureKv(); return _kv; }

export async function loadBlocklist(kind: ThreatCategory | Kind): Promise<BlocklistEntry[]> {
  // Map category -> list kind
  const k: Kind = (kind === 'app_blocklist' ? 'apps'
                 : kind === 'wifi' ? 'rogue_bssid'
                 : kind === 'mitm' ? 'cert_pins'
                 : kind as Kind);
  const store = await kv();
  const raw = store.getString(kvKey(k));
  return raw ? JSON.parse(raw) : [];
}

export async function getVersion(kind: Kind): Promise<number> {
  const store = await kv();
  const v = store.getString(verKey(kind));
  return v ? parseInt(v, 10) : 0;
}

/**
 * Verify and persist an entry. Returns true if accepted.
 */
export async function acceptEntry(kind: Kind, entry: BlocklistEntry): Promise<boolean> {
  // Pin check
  if (PINNED_SIGNER_PUB_B64 !== '__OLEVEN_BLOCKLIST_SIGNER_PUB__' &&
      entry.signer_pub_b64 !== PINNED_SIGNER_PUB_B64) {
    return false;
  }
  try {
    // signature is Ed25519 over raw payload bytes (Ed25519 hashes internally)
    const payload = new Uint8Array(b64.dec(entry.payload_b64));
    const sig = util.decodeBase64(entry.signature_b64);
    const pub = util.decodeBase64(entry.signer_pub_b64);
    if (!nacl.sign.detached.verify(payload, sig, pub)) return false;
  } catch { return false; }

  const store = await kv();
  const raw = store.getString(kvKey(kind));
  const arr: BlocklistEntry[] = raw ? JSON.parse(raw) : [];
  if (arr.some((e) => e.version === entry.version)) return true; // dedupe
  arr.push(entry);
  // keep last 10 versions only
  arr.sort((a, b) => a.version - b.version);
  if (arr.length > 10) arr.splice(0, arr.length - 10);
  store.set(kvKey(kind), JSON.stringify(arr));
  store.set(verKey(kind), String(arr[arr.length - 1].version));
  return true;
}
