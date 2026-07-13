import { NativeModules, DeviceEventEmitter, EmitterSubscription } from 'react-native';
import { appKv } from './keychain';
import { ProxyConfig, Region } from '../types';

/**
 * Transport anti-censura per-app (VLESS + XTLS-Vision + REALITY).
 *
 * Ponte JS verso il modulo nativo Android `AntiCensorship` (VpnService per-app +
 * sing-box, tun ristretto al solo package dell'app). Quando il modulo nativo NON è
 * presente — build senza layer nativo, o iOS in attesa — tutti i metodi degradano a
 * no-op, così il resto dell'app gira invariato e la Fase JS è testabile da sola.
 *
 * IMPORTANTE: questo file NON deve importare da `xsec-mtd` (è il detector `mitm` a
 * importare `transport`, non il contrario) per evitare cicli di import.
 */

const Native: any = (NativeModules as any).AntiCensorship;

// Paesi con censura/DPI pesante dove il transport REALITY va attivato DI DEFAULT (senza che
// l'utente debba saperlo): Russia, Iran, Cina, Bielorussia, Turkmenistan, Corea del Nord, ecc.
const HOSTILE_COUNTRIES = new Set(['RU', 'IR', 'CN', 'BY', 'TM', 'KP', 'SY', 'CU', 'UZ']);

const KEY_MANUAL = 'transport.manualEnabled';
const KEY_LAST_CFG = 'transport.lastProxyConfig';
// Oltre questo tempo senza un 'connected' consideriamo il tunnel fallito e proseguiamo in diretta.
const START_TIMEOUT_MS = 15000;

export type TransportState = 'idle' | 'connecting' | 'connected' | 'error';
type StateListener = (s: TransportState) => void;

class TransportService {
  private state: TransportState = 'idle';
  private listeners = new Set<StateListener>();
  private nativeSub: EmitterSubscription | null = null;

  constructor() {
    // Il modulo nativo emette 'AntiCensorship:state' con { state }.
    this.nativeSub = DeviceEventEmitter.addListener('AntiCensorship:state', (e: any) => {
      this.setState((e?.state as TransportState) ?? 'idle');
    });
  }

  /** true se il layer nativo è compilato e disponibile (Android col modulo). */
  isAvailable(): boolean {
    return !!Native && typeof Native.start === 'function';
  }

  isRunning(): boolean {
    return this.state === 'connected' || this.state === 'connecting';
  }

  getState(): TransportState {
    return this.state;
  }

  /** Richiede il consenso VPN di sistema (una tantum). Risolve true se concesso. */
  async prepare(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try { return !!(await Native.prepare()); } catch { return false; }
  }

  /**
   * Avvia il tunnel per-app verso il proxy REALITY. Persiste sempre la config.
   * ONESTÀ: NON ritorna true finché il tunnel non è realmente 'connected'. Se il core nativo
   * fallisce (es. .aar non linkato → 'error') o non risponde entro il timeout, ritorna false così
   * il chiamante (login) prosegue in DIRETTA invece di credersi protetto e restare senza rete.
   */
  async start(cfg: ProxyConfig): Promise<boolean> {
    this.persistLastConfig(cfg);
    if (!this.isAvailable()) return false;
    this.setState('connecting');
    const settled = this.waitForSettled(START_TIMEOUT_MS);
    try {
      await Native.start({
        server: cfg.server, port: cfg.port, uuid: cfg.uuid,
        pbk: cfg.pbk, sid: cfg.sid, sni: cfg.sni, flow: cfg.flow, fp: cfg.fp,
      });
    } catch {
      this.setState('error');
      return false;
    }
    // Il tun si stabilisce/instrada in modo asincrono: il modulo nativo emette 'connected' o 'error'.
    return (await settled) === 'connected';
  }

  /** Attende la prima transizione a 'connected'/'error'; su timeout considera fallito (false). */
  private waitForSettled(timeoutMs: number): Promise<TransportState> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (s: TransportState): void => {
        if (done) return; done = true;
        clearTimeout(timer); off();
        resolve(s);
      };
      const off = this.onState((s) => { if (s === 'connected' || s === 'error') finish(s); });
      const timer = setTimeout(() => finish(this.state === 'connected' ? 'connected' : 'error'), timeoutMs);
    });
  }

  async stop(): Promise<void> {
    if (this.isAvailable()) { try { await Native.stop(); } catch {} }
    this.setState('idle');
  }

  /**
   * Avvia automaticamente il transport se le condizioni lo richiedono (region ru,
   * toggle manuale, o fallback dopo un blocco diretto). Usa la config passata o, in
   * mancanza, l'ultima persistita. No-op (false) se il nativo non è disponibile.
   */
  async maybeAutoStart(region: Region | null, cfg: ProxyConfig | null, directFailed = false): Promise<boolean> {
    const conf = cfg ?? this.getLastConfig();
    if (!conf) return false;
    if (!this.shouldAutoEnable(region, directFailed)) return false;
    const ok = await this.prepare();
    if (!ok) return false;
    return this.start(conf);
  }

  shouldAutoEnable(region: Region | null, directFailed = false): boolean {
    if (this.getManualEnabled()) return true;
    if (region === 'ru') return true;
    // Auto-default in paesi censurati: l'utente non deve sapere che serve — REALITY parte da solo.
    const cc = (appKv.getString('auth.countryCode') || '').toUpperCase();
    if (cc && HOSTILE_COUNTRIES.has(cc)) return true;
    if (directFailed) return true;
    return false;
  }

  onState(cb: StateListener): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => { this.listeners.delete(cb); };
  }

  // ---- persistenza (MMKV) ----
  getManualEnabled(): boolean {
    return appKv.getBoolean(KEY_MANUAL) ?? false;
  }
  setManualEnabled(v: boolean): void {
    appKv.set(KEY_MANUAL, v);
  }
  getLastConfig(): ProxyConfig | null {
    const raw = appKv.getString(KEY_LAST_CFG);
    if (!raw) return null;
    try { return JSON.parse(raw) as ProxyConfig; } catch { return null; }
  }
  private persistLastConfig(cfg: ProxyConfig): void {
    try { appKv.set(KEY_LAST_CFG, JSON.stringify(cfg)); } catch {}
  }

  private setState(s: TransportState): void {
    if (s === this.state) return;
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }
}

export const transport = new TransportService();
