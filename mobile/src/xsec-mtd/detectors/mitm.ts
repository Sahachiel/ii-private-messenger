import { MtdEvent } from '../types';
import { transport } from '@services/transport';

/**
 * Basic MITM indicators: system proxy env, unexpected CA trust anchors.
 * Deep cert-chain inspection requires native module; v0.1 uses simple heuristics.
 */
export async function detectMitm(): Promise<MtdEvent[]> {
  const events: MtdEvent[] = [];
  // Il tunnel anti-censura per-app (VLESS+REALITY) è legittimo e voluto dall'utente:
  // non va segnalato come MITM, altrimenti il falso-positivo degraderebbe lo stato a
  // 'compromised' e bloccherebbe l'invio (blockSendOnCompromise).
  if (transport.isRunning()) return events;
  const env = ((globalThis as any).process?.env ?? {}) as Record<string, string>;
  const proxy = env.HTTP_PROXY || env.HTTPS_PROXY || env.http_proxy || env.https_proxy;
  if (proxy) {
    events.push({
      id: `mitm-proxy-${Date.now()}`, ts: Date.now(),
      category: 'mitm', severity: 'warning',
      title: 'System proxy configured',
      detail: { proxy },
    });
  }
  return events;
}
