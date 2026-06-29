import { NativeModules, Platform } from 'react-native';
import { MtdEvent } from '../types';

/**
 * Frida / debugger detection heuristics. Best-effort JS-only; deeper checks
 * require a native module (TODO v0.3).
 */
export async function detectDebugger(): Promise<MtdEvent[]> {
  const events: MtdEvent[] = [];
  const detail: Record<string, unknown> = {};
  let flagged = false;

  // Proxy env vars (Frida often sets these on Android emulators)
  const proxyHost = (globalThis as any)?.process?.env?.HTTP_PROXY ?? '';
  if (proxyHost.includes('27042') || proxyHost.includes('frida')) {
    flagged = true; detail.proxy = proxyHost;
  }

  // Time-based: Frida slows down JS execution significantly
  const t0 = Date.now();
  // Hot loop: ~1M iterations should take < 50ms native; > 500ms under Frida
  let x = 0;
  for (let i = 0; i < 1_000_000; i++) x += i;
  const dt = Date.now() - t0;
  if (dt > 500) { flagged = true; detail.slow_exec_ms = dt; }
  if (x < 0) { /* keep x used */ }

  // Native debugger bridge (react-native dev mode only — warn if detected in prod)
  if (!__DEV__ && (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    flagged = true; detail.devtools_hook = true;
  }

  // Port 27042 reachable? Skip — needs raw socket not available in JS. Native module v0.3.
  void NativeModules; void Platform;

  if (flagged) {
    events.push({
      id: `dbg-${Date.now()}`,
      ts: Date.now(),
      category: 'debugger',
      severity: 'warning',
      title: 'Debugger/instrumentation indicators',
      detail,
    });
  }
  return events;
}
