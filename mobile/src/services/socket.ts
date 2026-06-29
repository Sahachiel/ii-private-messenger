import { RelayMessage, RelayEvent } from '../types';

type Listener = (e: RelayEvent) => void;

export class SocketService {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private token: string | null = null;
  private listeners = new Set<Listener>();
  private outbound: RelayMessage[] = [];
  private backoff = 1000;
  private pingTimer: any = null;
  private intentional = false;

  connect(url: string, token: string): void {
    this.url = url;
    this.token = token;
    this.intentional = false;
    this.open();
  }

  private open(): void {
    if (!this.url) return;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.backoff = 1000;
      this.send({ type: 'auth', token: this.token! });
      while (this.outbound.length) this.rawSend(this.outbound.shift()!);
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25000);
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as RelayEvent;
        this.listeners.forEach((l) => l(data));
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => { this.ws?.close(); };

    this.ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.intentional) return;
      setTimeout(() => this.open(), Math.min(this.backoff, 30000));
      this.backoff *= 2;
    };
  }

  private rawSend(m: RelayMessage): void {
    this.ws?.send(JSON.stringify(m));
  }

  send(m: RelayMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.rawSend(m);
    else this.outbound.push(m);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  disconnect(): void {
    this.intentional = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  isOpen(): boolean { return this.ws?.readyState === WebSocket.OPEN; }
}

export const socket = new SocketService();
