/**
 * MTD event log — encrypted-at-rest via MMKV (key derived from identity).
 * Note: v0.1 uses MMKV; v0.2 upgrades to SQLCipher via react-native-quick-sqlite
 * when RN 0.73 bindings ship. For now MMKV's own AES encryption is sufficient.
 */
import { MMKV } from 'react-native-mmkv';
import { MtdEvent } from '../types';
import { getSecureKv } from '@services/keychain';

const KEY = 'xsec-mtd.eventlog';
const MAX_EVENTS = 1000;

let _kv: MMKV | null = null;
async function kv(): Promise<MMKV> {
  if (_kv) return _kv;
  _kv = await getSecureKv();
  return _kv;
}

export async function appendEvent(e: MtdEvent): Promise<void> {
  const store = await kv();
  const raw = store.getString(KEY);
  const arr: MtdEvent[] = raw ? JSON.parse(raw) : [];
  arr.push(e);
  if (arr.length > MAX_EVENTS) arr.splice(0, arr.length - MAX_EVENTS);
  store.set(KEY, JSON.stringify(arr));
}

export async function readEvents(limit = 200): Promise<MtdEvent[]> {
  const store = await kv();
  const raw = store.getString(KEY);
  if (!raw) return [];
  const arr: MtdEvent[] = JSON.parse(raw);
  return arr.slice(-limit).reverse();
}

export async function ackEvent(id: string): Promise<void> {
  const store = await kv();
  const raw = store.getString(KEY);
  if (!raw) return;
  const arr: MtdEvent[] = JSON.parse(raw);
  const m = arr.find((e) => e.id === id);
  if (m) { m.ack = true; store.set(KEY, JSON.stringify(arr)); }
}

export async function clearEvents(): Promise<void> {
  const store = await kv();
  store.delete(KEY);
}
