import { appKv } from '@services/keychain';

/**
 * Stato di verifica del numero di sicurezza per ogni peer. Se il numero cambia rispetto a quello
 * salvato (rotazione chiave o possibile MITM), la verifica decade automaticamente e va rifatta.
 */
export interface SafetyRecord { sn: string; verified: boolean; verifiedAt?: number }

const key = (peerId: string): string => `safety.${peerId}`;

export function getSafety(peerId: string): SafetyRecord | null {
  const raw = appKv.getString(key(peerId));
  if (!raw) return null;
  try { return JSON.parse(raw) as SafetyRecord; } catch { return null; }
}

export function setVerified(peerId: string, sn: string, verified: boolean): void {
  appKv.set(key(peerId), JSON.stringify({ sn, verified, verifiedAt: verified ? Date.now() : undefined }));
}

/** Allinea il record al numero corrente: se differisce, azzera la verifica. */
export function reconcile(peerId: string, currentSn: string): SafetyRecord {
  const rec = getSafety(peerId);
  if (rec && rec.sn === currentSn) return rec;
  const fresh: SafetyRecord = { sn: currentSn, verified: false };
  appKv.set(key(peerId), JSON.stringify(fresh));
  return fresh;
}
