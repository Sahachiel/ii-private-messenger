import { MMKV } from 'react-native-mmkv';
import { MtdPolicy, DEFAULT_POLICY } from './types';
import { appKv } from '@services/keychain';

const KEY = 'xsec-mtd.policy';
const kv: MMKV = appKv;

export function loadPolicy(): MtdPolicy {
  const raw = kv.getString(KEY);
  if (!raw) return { ...DEFAULT_POLICY };
  try { return { ...DEFAULT_POLICY, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_POLICY }; }
}

export function savePolicy(p: MtdPolicy): void {
  kv.set(KEY, JSON.stringify(p));
}

export function updatePolicy(patch: Partial<MtdPolicy>): MtdPolicy {
  const next = { ...loadPolicy(), ...patch };
  savePolicy(next);
  return next;
}
