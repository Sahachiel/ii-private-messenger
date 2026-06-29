import {
  RTCPeerConnection, RTCSessionDescription, RTCIceCandidate,
  mediaDevices, MediaStream,
} from 'react-native-webrtc';
import CryptoJS from 'crypto-js';
import { TurnConfig, CallType } from '../types';

export interface TurnCredentials { username: string; credential: string; ttl: number }

export class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;

  onRemoteStream: (s: MediaStream) => void = () => {};
  onIceCandidate: (c: RTCIceCandidate) => void = () => {};
  onConnectionStateChange: (s: string) => void = () => {};
  onQuality: (q: 'excellent' | 'good' | 'poor') => void = () => {};

  private callType: CallType = 'voice';
  private statsTimer: any = null;

  static generateTurnCredentials(secret: string, userId: string, ttl = 86400): TurnCredentials {
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:${userId}`;
    const credential = CryptoJS.HmacSHA1(username, secret).toString(CryptoJS.enc.Base64);
    return { username, credential, ttl };
  }

  async initialize(turn: TurnConfig, callType: CallType): Promise<void> {
    this.callType = callType;
    const config: any = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: turn.urls, username: turn.username, credential: turn.credential },
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
    };
    this.pc = new RTCPeerConnection(config);

    const constraints: any = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: callType === 'video' ? { width: 1280, height: 720, frameRate: 30, facingMode: 'user' } : false,
    };
    this.localStream = await mediaDevices.getUserMedia(constraints);
    this.localStream.getTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!));

    (this.pc as any).addEventListener('track', (e: any) => {
      if (e.streams && e.streams[0]) {
        this.remoteStream = e.streams[0];
        this.onRemoteStream(e.streams[0]);
      }
    });
    (this.pc as any).addEventListener('icecandidate', (e: any) => {
      if (e.candidate) this.onIceCandidate(e.candidate);
    });
    (this.pc as any).addEventListener('connectionstatechange', () => {
      const st = (this.pc as any).connectionState;
      this.onConnectionStateChange(st);
      if (st === 'connected') this.startStats();
      else if (st === 'disconnected' || st === 'failed' || st === 'closed') this.stopStats();
    });
  }

  // --- Alta qualità: SDP munging (codec preferiti + bitrate) ---

  private munge(sdp: string): string {
    let out = this.preferCodec(sdp, 'audio', 'opus');
    out = this.tuneOpus(out);
    if (this.callType === 'video') {
      out = this.preferCodec(out, 'video', 'H264');           // accel. hardware iOS/Android, batteria
      out = this.setVideoBitrate(out, 2500);                  // ~2.5 Mbps target per il 720p
    }
    return out;
  }

  /** Riordina i payload type della m-line per preferire `codec`. */
  private preferCodec(sdp: string, kind: 'audio' | 'video', codec: string): string {
    const lines = sdp.split('\r\n');
    const mIdx = lines.findIndex((l) => l.startsWith('m=' + kind));
    if (mIdx === -1) return sdp;
    const re = new RegExp(`^a=rtpmap:([0-9]+) ${codec}/`, 'i');
    const pts = lines.filter((l) => re.test(l)).map((l) => l.match(re)![1]);
    if (!pts.length) return sdp;
    const parts = lines[mIdx].split(' ');
    const head = parts.slice(0, 3);
    const payloads = parts.slice(3);
    lines[mIdx] = [...head, ...pts, ...payloads.filter((p) => !pts.includes(p))].join(' ');
    return lines.join('\r\n');
  }

  /** Opus: stereo + fec + bitrate medio alto per audio in alta fedeltà. */
  private tuneOpus(sdp: string): string {
    const lines = sdp.split('\r\n');
    const pt = lines.map((l) => l.match(/^a=rtpmap:(\d+) opus\//i)).find(Boolean)?.[1];
    if (!pt) return sdp;
    const fmtpIdx = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt}`));
    const params = 'stereo=1;sprop-stereo=1;useinbandfec=1;maxaveragebitrate=64000';
    if (fmtpIdx !== -1) {
      if (!/stereo=/.test(lines[fmtpIdx])) lines[fmtpIdx] += `;${params}`;
    } else {
      const rtpmapIdx = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} opus`));
      if (rtpmapIdx !== -1) lines.splice(rtpmapIdx + 1, 0, `a=fmtp:${pt} ${params}`);
    }
    return lines.join('\r\n');
  }

  /** Inserisce un b=AS (kbps) sotto la m-line video per alzare il bitrate target. */
  private setVideoBitrate(sdp: string, kbps: number): string {
    const lines = sdp.split('\r\n');
    const mIdx = lines.findIndex((l) => l.startsWith('m=video'));
    if (mIdx === -1) return sdp;
    // rimuovi eventuale b= esistente subito dopo la m-line
    let insertAt = mIdx + 1;
    while (insertAt < lines.length && (lines[insertAt].startsWith('i=') || lines[insertAt].startsWith('c='))) insertAt++;
    if (lines[insertAt]?.startsWith('b=')) lines.splice(insertAt, 1);
    lines.splice(insertAt, 0, `b=AS:${kbps}`);
    return lines.join('\r\n');
  }

  private startStats(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(async () => {
      if (!this.pc) return;
      try {
        const stats: any = await (this.pc as any).getStats();
        let lost = 0; let recv = 0; let jitter = 0; let rtt = 0;
        stats.forEach((r: any) => {
          if (r.type === 'inbound-rtp') { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; jitter = Math.max(jitter, r.jitter || 0); }
          if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime) rtt = r.currentRoundTripTime;
        });
        const loss = recv > 0 ? lost / (lost + recv) : 0;
        let q: 'excellent' | 'good' | 'poor' = 'excellent';
        if (loss > 0.08 || jitter > 0.05 || rtt > 0.3) q = 'poor';
        else if (loss > 0.02 || jitter > 0.03 || rtt > 0.15) q = 'good';
        this.onQuality(q);
      } catch { /* ignore */ }
    }, 3000);
  }

  private stopStats(): void {
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
  }

  async createOffer(): Promise<RTCSessionDescription> {
    const offer = await this.pc!.createOffer({} as any);
    const desc = new RTCSessionDescription({ type: 'offer', sdp: this.munge((offer as any).sdp) });
    await this.pc!.setLocalDescription(desc);
    return desc as unknown as RTCSessionDescription;
  }

  async handleOffer(sdp: any): Promise<RTCSessionDescription> {
    await this.pc!.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await this.pc!.createAnswer();
    const desc = new RTCSessionDescription({ type: 'answer', sdp: this.munge((answer as any).sdp) });
    await this.pc!.setLocalDescription(desc);
    return desc as unknown as RTCSessionDescription;
  }

  async handleAnswer(sdp: any): Promise<void> {
    await this.pc!.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async addIceCandidate(candidate: any): Promise<void> {
    try { await this.pc!.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* swallow late */ }
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setVideoEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = enabled));
  }

  async switchCamera(): Promise<void> {
    const track = this.localStream?.getVideoTracks()[0] as any;
    if (track && typeof track._switchCamera === 'function') track._switchCamera();
  }

  async hangup(): Promise<void> {
    this.stopStats();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.remoteStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
  }
}

export const webrtc = new WebRTCService();
