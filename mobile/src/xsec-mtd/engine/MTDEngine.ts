import { DeviceState, MtdEvent, MtdPolicy, ThreatCategory } from '../types';
import { appendEvent, readEvents } from '../storage/eventLog';
import { loadPolicy } from '../policy';
import { detectRootJailbreak } from '../detectors/rootJailbreak';
import { detectDebugger } from '../detectors/debugger';
import { detectSslPinning } from '../detectors/sslPinning';
import { detectMitm } from '../detectors/mitm';
import { detectWifi } from '../detectors/wifi';
import { detectMaliciousApps } from '../detectors/apps';
import { detectMdm } from '../detectors/mdm';
import { scanTextForPhishing } from '../detectors/phishing';
import { syncBlocklists } from '../sync/mirrorClient';

type Listener = (e: MtdEvent) => void;
type StateListener = (s: DeviceState) => void;
type ScanListener = (p: ScanProgress) => void;

export interface ScanProgress {
  scanning: boolean;
  detector?: ThreatCategory;           // currently running detector
  completed: ThreatCategory[];         // detectors finished this scan
  total: number;                       // detectors in this scan
  startedAt: number;
  finishedAt?: number;
  newEventsCount?: number;
}

class MTDEngine {
  private policy: MtdPolicy = loadPolicy();
  private state: DeviceState = 'secure';
  private score = 100;
  private scanTimer: any = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private scanListeners = new Set<ScanListener>();
  private lastScan = 0;
  private scanning = false;
  private lastProgress: ScanProgress | null = null;

  start(): void {
    if (this.scanTimer) return; // idempotent: already running
    this.policy = loadPolicy();
    this.runScan();
    syncBlocklists().catch(() => {});
    this.scanTimer = setInterval(() => this.runScan(), this.policy.scanIntervalMs);
  }

  stop(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
  }

  reloadPolicy(): void {
    this.policy = loadPolicy();
    this.stop(); this.start();
  }

  getState(): DeviceState { return this.state; }
  getScore(): number { return this.score; }
  getPolicy(): MtdPolicy { return this.policy; }
  getLastScan(): number { return this.lastScan; }
  isScanning(): boolean { return this.scanning; }
  getLastProgress(): ScanProgress | null { return this.lastProgress; }

  onEvent(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  onStateChange(l: StateListener): () => void { this.stateListeners.add(l); return () => this.stateListeners.delete(l); }
  onScanProgress(l: ScanListener): () => void { this.scanListeners.add(l); return () => this.scanListeners.delete(l); }

  private emitProgress(p: ScanProgress): void {
    this.lastProgress = p;
    this.scanListeners.forEach((l) => l(p));
  }

  async scanMessage(text: string): Promise<MtdEvent[]> {
    if (!this.policy.enabled.phishing || !this.policy.phishingLinkScan) return [];
    const events = await scanTextForPhishing(text);
    for (const e of events) await this.recordEvent(e);
    return events;
  }

  async runScan(): Promise<void> {
    if (this.scanning) return; // re-entrancy guard
    this.scanning = true;
    const startedAt = Date.now();
    this.lastScan = startedAt;

    // Watchdog: if a detector hangs (e.g. awaiting a permission prompt that never
    // resolves) the UI's "RUN FULL SCAN" button stays disabled forever. Force-release
    // the lock after SCAN_MAX_MS so the user can retry.
    const SCAN_MAX_MS = 45_000;
    const watchdog = setTimeout(() => {
      if (!this.scanning) return;
      this.scanning = false;
      this.emitProgress({
        scanning: false, completed: [], total: 0, startedAt,
        finishedAt: Date.now(), newEventsCount: 0,
      });
    }, SCAN_MAX_MS);

    try {
      const p = this.policy.enabled;
      const plan: Array<[ThreatCategory, () => Promise<MtdEvent[]>]> = [];
      if (p.root_jailbreak) plan.push(['root_jailbreak', detectRootJailbreak]);
      if (p.debugger)       plan.push(['debugger',       detectDebugger]);
      if (p.ssl_pinning)    plan.push(['ssl_pinning',    detectSslPinning]);
      if (p.mitm)           plan.push(['mitm',           detectMitm]);
      if (p.wifi)           plan.push(['wifi',           detectWifi]);
      if (p.app_blocklist)  plan.push(['app_blocklist',  detectMaliciousApps]);
      if (p.mdm_profile)    plan.push(['mdm_profile',    detectMdm]);

      const completed: ThreatCategory[] = [];
      this.emitProgress({ scanning: true, completed: [], total: plan.length, startedAt });

      const newEvents: MtdEvent[] = [];
      for (const [cat, fn] of plan) {
        this.emitProgress({ scanning: true, detector: cat, completed: [...completed], total: plan.length, startedAt });
        try {
          const evs = await withTimeout(fn(), 4_000);
          newEvents.push(...evs);
        } catch {
          // individual detector failure or timeout does not abort the scan
        }
        completed.push(cat);
        this.emitProgress({ scanning: true, completed: [...completed], total: plan.length, startedAt });
      }

      for (const e of newEvents) await this.recordEvent(e);
      this.recomputeState(newEvents);

      this.emitProgress({
        scanning: false, completed, total: plan.length, startedAt,
        finishedAt: Date.now(), newEventsCount: newEvents.length,
      });
    } finally {
      clearTimeout(watchdog);
      this.scanning = false;
    }
  }

  private async recordEvent(e: MtdEvent): Promise<void> {
    await appendEvent(e);
    this.listeners.forEach((l) => l(e));
  }

  private recomputeState(_new: MtdEvent[]): void {
    // Walk recent events (last 24h) and weight
    readEvents(500).then((events) => {
      const cutoff = Date.now() - 24 * 3600_000;
      let score = 100;
      let worstSev: DeviceState = 'secure';
      const recentCats = new Set<ThreatCategory>();
      for (const e of events) {
        if (e.ts < cutoff) continue;
        if (e.ack) continue;
        if (e.severity === 'compromised') { score -= 40; worstSev = 'compromised'; }
        else if (e.severity === 'warning') { score -= 10; if (worstSev === 'secure') worstSev = 'warning'; }
        recentCats.add(e.category);
      }
      score = Math.max(0, score);
      const prev = this.state;
      this.state = worstSev;
      this.score = score;
      if (prev !== this.state) this.stateListeners.forEach((l) => l(this.state));
    });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('detector_timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export const mtd = new MTDEngine();
