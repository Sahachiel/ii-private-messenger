/**
 * Sender Keys per i gruppi (E2EE scalabile, stile Signal Sender Keys).
 *
 * Ogni mittente possiede una propria "sender chain" per (gruppo, epoch):
 *   - chainKey ratchet via hash (SHA-512 troncato a 32B): forward secrecy IN AVANTI nell'epoch
 *     (le chiavi dei messaggi passati non si ricavano da quelle future);
 *   - una msgKey per messaggio → AEAD XSalsa20-Poly1305 (nacl.secretbox);
 *   - firma Ed25519 per messaggio (anti-spoof: nessun membro può impersonarne un altro).
 *
 * Distribuzione: alla creazione/rotazione, il mittente invia la propria chain-key CORRENTE +
 * la sua sign-pubkey ai membri via canale pairwise (signal.encrypt). Distribuendo la chiave
 * CORRENTE (non quella iniziale), un nuovo membro non può decifrare la storia precedente
 * (no storia pre-join). Su join/leave/kick il backend fa epoch++ → si rotea la sender key →
 * un ex-membro con la chiave della vecchia epoch non decifra i messaggi nuovi.
 *
 * Solo tweetnacl: compatibile React Native, nessuna nuova dipendenza nativa.
 *
 * NOTA: questo è il canale di GRUPPO. Il canale pairwise che trasporta le distribution
 * (signal.ts) è oggi nacl.box statico: il suo upgrade a Double Ratchet/ libsignal (PFS piena
 * anche sulle distribution) è un passo successivo da validare on-device — vedi report.
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { appKv } from './keychain';

const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };
const KV_KEY = 'senderkeys.v1';
const MAX_SKIP = 256; // tolleranza messaggi fuori ordine / persi per chain

const LBL_CHAIN = Uint8Array.of(0x02);
const LBL_MSG = Uint8Array.of(0x01);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
/** Ratchet/KDF: 32 byte da SHA-512(label || key). */
function kdf(label: Uint8Array, key: Uint8Array): Uint8Array {
  return nacl.hash(concat(label, key)).slice(0, 32);
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff; b[1] = (n >>> 16) & 0xff; b[2] = (n >>> 8) & 0xff; b[3] = n & 0xff;
  return b;
}
/** Messaggio da firmare: lega gid, epoch, iter, nonce e ciphertext. */
function sigMessage(gid: string, epoch: number, iter: number, nonce: Uint8Array, ct: Uint8Array): Uint8Array {
  const g = util.decodeUTF8(gid);
  return nacl.hash(concat(concat(concat(concat(g, u32(epoch)), u32(iter)), nonce), ct)).slice(0, 32);
}

export interface SenderKeyMessage { sid: string; e: number; i: number; n: string; c: string; s: string }
export interface SenderKeyDistribution { sid: string; e: number; ck: string; i: number; spk: string }

interface OwnChain { ck: string; i: number; spk: string; ssk: string }
interface PeerChain { ck: string; i: number; spk: string; skipped: Record<number, string> }

interface Store {
  own: Record<string, OwnChain>;        // key: gid:epoch
  peer: Record<string, PeerChain>;      // key: gid:epoch:senderId
}

class SenderKeyManager {
  private store: Store = this.load();

  private load(): Store {
    const raw = appKv.getString(KV_KEY);
    if (!raw) return { own: {}, peer: {} };
    try { return JSON.parse(raw) as Store; } catch { return { own: {}, peer: {} }; }
  }
  private save(): void {
    try { appKv.set(KV_KEY, JSON.stringify(this.store)); } catch { /* ignore */ }
  }
  private myId(): string { return appKv.getString('auth.userId') ?? ''; }

  private ownKey(gid: string, e: number): string { return `${gid}:${e}`; }
  private peerKey(gid: string, e: number, sid: string): string { return `${gid}:${e}:${sid}`; }

  private getOwn(gid: string, epoch: number): OwnChain {
    const k = this.ownKey(gid, epoch);
    let own = this.store.own[k];
    if (!own) {
      const ck = nacl.randomBytes(32);
      const signKp = nacl.sign.keyPair();
      own = { ck: b64.enc(ck), i: 0, spk: b64.enc(signKp.publicKey), ssk: b64.enc(signKp.secretKey) };
      this.store.own[k] = own;
      this.save();
    }
    return own;
  }

  /** Distribution da inviare ai membri (chiave corrente → niente storia pre-distribuzione). */
  myDistribution(gid: string, epoch: number): SenderKeyDistribution {
    const own = this.getOwn(gid, epoch);
    return { sid: this.myId(), e: epoch, ck: own.ck, i: own.i, spk: own.spk };
  }

  processDistribution(gid: string, d: SenderKeyDistribution): void {
    this.store.peer[this.peerKey(gid, d.e, d.sid)] = { ck: d.ck, i: d.i, spk: d.spk, skipped: {} };
    this.save();
  }

  hasPeer(gid: string, epoch: number, sid: string): boolean {
    return !!this.store.peer[this.peerKey(gid, epoch, sid)];
  }

  encryptGroup(gid: string, epoch: number, plaintext: string): SenderKeyMessage {
    const own = this.getOwn(gid, epoch);
    let chain = b64.dec(own.ck);
    const iter = own.i;
    const msgKey = kdf(LBL_MSG, chain);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const ct = nacl.secretbox(util.decodeUTF8(plaintext), nonce, msgKey);
    const sig = nacl.sign.detached(sigMessage(gid, epoch, iter, nonce, ct), b64.dec(own.ssk));
    // avanza il ratchet
    chain = kdf(LBL_CHAIN, chain);
    own.ck = b64.enc(chain);
    own.i = iter + 1;
    this.save();
    return { sid: this.myId(), e: epoch, i: iter, n: b64.enc(nonce), c: b64.enc(ct), s: b64.enc(sig) };
  }

  decryptGroup(gid: string, m: SenderKeyMessage): string {
    const pk = this.peerKey(gid, m.e, m.sid);
    const peer = this.store.peer[pk];
    if (!peer) throw new Error('no_sender_key');
    const nonce = b64.dec(m.n);
    const ct = b64.dec(m.c);
    // anti-spoof: firma del mittente sul contenuto
    if (!nacl.sign.detached.verify(sigMessage(gid, m.e, m.i, nonce, ct), b64.dec(m.s), b64.dec(peer.spk))) {
      throw new Error('bad_signature');
    }
    let msgKey: Uint8Array;
    if (m.i < peer.i) {
      const sk = peer.skipped[m.i];
      if (!sk) throw new Error('stale_or_replayed');
      msgKey = b64.dec(sk);
      delete peer.skipped[m.i];
    } else {
      if (m.i - peer.i > MAX_SKIP) throw new Error('too_far_ahead');
      let chain = b64.dec(peer.ck);
      for (let j = peer.i; j < m.i; j++) {
        peer.skipped[j] = b64.enc(kdf(LBL_MSG, chain)); // bufferizza chiavi saltate (out-of-order)
        chain = kdf(LBL_CHAIN, chain);
      }
      msgKey = kdf(LBL_MSG, chain);
      chain = kdf(LBL_CHAIN, chain);
      peer.ck = b64.enc(chain);
      peer.i = m.i + 1;
      // limita la finestra di compromissione delle skipped-keys
      const keys = Object.keys(peer.skipped);
      if (keys.length > MAX_SKIP) {
        keys.sort((a, c) => Number(a) - Number(c)).slice(0, keys.length - MAX_SKIP)
          .forEach((k) => delete peer.skipped[Number(k)]);
      }
    }
    const plain = nacl.secretbox.open(ct, nonce, msgKey);
    if (!plain) throw new Error('decrypt_failed');
    this.save();
    return util.encodeUTF8(plain);
  }

  /** Rotazione epoch: scarta tutte le chain (own+peer) del gruppo con epoch < newEpoch. */
  rotateEpoch(gid: string, newEpoch: number): void {
    for (const k of Object.keys(this.store.own)) {
      const [g, e] = k.split(':');
      if (g === gid && Number(e) < newEpoch) delete this.store.own[k];
    }
    for (const k of Object.keys(this.store.peer)) {
      const parts = k.split(':');
      if (parts[0] === gid && Number(parts[1]) < newEpoch) delete this.store.peer[k];
    }
    this.save();
  }
}

export const senderKeys = new SenderKeyManager();
