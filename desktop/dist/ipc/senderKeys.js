"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSenderKeysIpc = exports.senderKeys = void 0;
const tweetnacl_1 = __importDefault(require("tweetnacl"));
const tweetnacl_util_1 = __importDefault(require("tweetnacl-util"));
const electron_store_1 = __importDefault(require("electron-store"));
// Sender Keys per i gruppi — PORT FEDELE di mobile/src/services/senderKeys.ts.
// Stesso schema crittografico (tweetnacl): chain-key ratchet via SHA-512, msgKey → nacl.secretbox,
// firma Ed25519 per messaggio. Il formato di distribution (gskd) e del messaggio (gsk) sul filo è
// identico al mobile → interoperabilità telefono↔PC. L'unica differenza è la persistenza:
// appKv/MMKV del mobile → electron-store sul desktop; lo stato Sender Key è SOLO locale (non
// viaggia), quindi il formato di storage è libero.
const b64 = { enc: tweetnacl_util_1.default.encodeBase64, dec: tweetnacl_util_1.default.decodeBase64 };
const MAX_SKIP = 256;
const LBL_CHAIN = Uint8Array.of(0x02);
const LBL_MSG = Uint8Array.of(0x01);
function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}
// PADDING METADATI anche per i messaggi di gruppo — IDENTICO a mobile/senderKeys.ts.
const PAD_BUCKETS = [64, 256, 1024, 4096, 16384];
function padTo(pt) {
    const need = pt.length + 1;
    const target = PAD_BUCKETS.find((b) => need <= b) ?? Math.ceil(need / 16384) * 16384;
    const out = new Uint8Array(target);
    out.set(pt, 0);
    out[pt.length] = 0x80;
    return out;
}
function unpad(p) {
    let i = p.length - 1;
    while (i >= 0 && p[i] === 0x00)
        i--;
    if (i < 0 || p[i] !== 0x80)
        return p;
    return p.slice(0, i);
}
function kdf(label, key) {
    return tweetnacl_1.default.hash(concat(label, key)).slice(0, 32);
}
function u32(n) {
    const b = new Uint8Array(4);
    b[0] = (n >>> 24) & 0xff;
    b[1] = (n >>> 16) & 0xff;
    b[2] = (n >>> 8) & 0xff;
    b[3] = n & 0xff;
    return b;
}
function sigMessage(gid, epoch, iter, nonce, ct) {
    const g = tweetnacl_util_1.default.decodeUTF8(gid);
    return tweetnacl_1.default.hash(concat(concat(concat(concat(g, u32(epoch)), u32(iter)), nonce), ct)).slice(0, 32);
}
const SK_VERSION = 2; // v2 = sealed sender (sid opaco)
const skStore = new electron_store_1.default({ name: 'sender-keys' });
const cfg = new electron_store_1.default(); // default 'config', condivide userId con api.ts
class SenderKeyManager {
    store = this.load();
    load() {
        const s = skStore.get('state') ?? { own: {}, peer: {}, senderMap: {} };
        // MIGRAZIONE opaque-sid (vedi mobile): azzera peer + mappa così parte una distribuzione fresca.
        if (s.v !== SK_VERSION) {
            const migrated = { own: s.own ?? {}, peer: {}, senderMap: {}, v: SK_VERSION };
            try {
                skStore.set('state', migrated);
            }
            catch { /* ignore */ }
            return migrated;
        }
        return s;
    }
    save() {
        try {
            skStore.set('state', this.store);
        }
        catch { /* ignore */ }
    }
    myId() { return cfg.get('userId') ?? ''; }
    ownKey(gid, e) { return `${gid}:${e}`; }
    peerKey(gid, e, sid) { return `${gid}:${e}:${sid}`; }
    // SEALED SENDER — id mittente OPACO (identico a mobile): il relay non impara l'identità.
    opaqueSid(gid, uid) {
        return b64.enc(tweetnacl_1.default.hash(concat(tweetnacl_util_1.default.decodeUTF8(`${gid}:sender:`), tweetnacl_util_1.default.decodeUTF8(uid))).slice(0, 16));
    }
    resolveSender(sid) { return this.store.senderMap?.[sid]; }
    getOwn(gid, epoch) {
        const k = this.ownKey(gid, epoch);
        let own = this.store.own[k];
        if (!own) {
            const ck = tweetnacl_1.default.randomBytes(32);
            const signKp = tweetnacl_1.default.sign.keyPair();
            own = { ck: b64.enc(ck), i: 0, spk: b64.enc(signKp.publicKey), ssk: b64.enc(signKp.secretKey) };
            this.store.own[k] = own;
            this.save();
        }
        return own;
    }
    myDistribution(gid, epoch) {
        const own = this.getOwn(gid, epoch);
        return { sid: this.opaqueSid(gid, this.myId()), e: epoch, ck: own.ck, i: own.i, spk: own.spk };
    }
    processDistribution(gid, d, realSender) {
        // ANTI-POISONING: il sid opaco deve derivare dal mittente reale del canale pairwise.
        if (!realSender || d.sid !== this.opaqueSid(gid, realSender))
            return false;
        this.store.peer[this.peerKey(gid, d.e, d.sid)] = { ck: d.ck, i: d.i, spk: d.spk, skipped: {} };
        if (!this.store.senderMap)
            this.store.senderMap = {};
        this.store.senderMap[d.sid] = realSender;
        this.save();
        return true;
    }
    hasPeer(gid, epoch, sid) {
        return !!this.store.peer[this.peerKey(gid, epoch, sid)];
    }
    encryptGroup(gid, epoch, plaintext) {
        const own = this.getOwn(gid, epoch);
        let chain = b64.dec(own.ck);
        const iter = own.i;
        const msgKey = kdf(LBL_MSG, chain);
        const nonce = tweetnacl_1.default.randomBytes(tweetnacl_1.default.secretbox.nonceLength);
        const ct = tweetnacl_1.default.secretbox(padTo(tweetnacl_util_1.default.decodeUTF8(plaintext)), nonce, msgKey);
        const sig = tweetnacl_1.default.sign.detached(sigMessage(gid, epoch, iter, nonce, ct), b64.dec(own.ssk));
        chain = kdf(LBL_CHAIN, chain);
        own.ck = b64.enc(chain);
        own.i = iter + 1;
        this.save();
        return { sid: this.opaqueSid(gid, this.myId()), e: epoch, i: iter, n: b64.enc(nonce), c: b64.enc(ct), s: b64.enc(sig) };
    }
    decryptGroup(gid, m) {
        const pk = this.peerKey(gid, m.e, m.sid);
        const peer = this.store.peer[pk];
        if (!peer)
            throw new Error('no_sender_key');
        const nonce = b64.dec(m.n);
        const ct = b64.dec(m.c);
        if (!tweetnacl_1.default.sign.detached.verify(sigMessage(gid, m.e, m.i, nonce, ct), b64.dec(m.s), b64.dec(peer.spk))) {
            throw new Error('bad_signature');
        }
        let msgKey;
        if (m.i < peer.i) {
            const sk = peer.skipped[m.i];
            if (!sk)
                throw new Error('stale_or_replayed');
            msgKey = b64.dec(sk);
            delete peer.skipped[m.i];
        }
        else {
            if (m.i - peer.i > MAX_SKIP)
                throw new Error('too_far_ahead');
            let chain = b64.dec(peer.ck);
            for (let j = peer.i; j < m.i; j++) {
                peer.skipped[j] = b64.enc(kdf(LBL_MSG, chain));
                chain = kdf(LBL_CHAIN, chain);
            }
            msgKey = kdf(LBL_MSG, chain);
            chain = kdf(LBL_CHAIN, chain);
            peer.ck = b64.enc(chain);
            peer.i = m.i + 1;
            const keys = Object.keys(peer.skipped);
            if (keys.length > MAX_SKIP) {
                keys.sort((a, c) => Number(a) - Number(c)).slice(0, keys.length - MAX_SKIP)
                    .forEach((k) => delete peer.skipped[Number(k)]);
            }
        }
        const plain = tweetnacl_1.default.secretbox.open(ct, nonce, msgKey);
        if (!plain)
            throw new Error('decrypt_failed');
        this.save();
        return tweetnacl_util_1.default.encodeUTF8(unpad(plain));
    }
    rotateEpoch(gid, newEpoch) {
        for (const k of Object.keys(this.store.own)) {
            const [g, e] = k.split(':');
            if (g === gid && Number(e) < newEpoch)
                delete this.store.own[k];
        }
        for (const k of Object.keys(this.store.peer)) {
            const parts = k.split(':');
            if (parts[0] === gid && Number(parts[1]) < newEpoch)
                delete this.store.peer[k];
        }
        this.save();
    }
}
exports.senderKeys = new SenderKeyManager();
function registerSenderKeysIpc(ipc) {
    ipc.handle('senderkeys.myDistribution', async (_e, gid, epoch) => exports.senderKeys.myDistribution(gid, epoch));
    ipc.handle('senderkeys.processDistribution', async (_e, gid, d, realSender) => exports.senderKeys.processDistribution(gid, d, realSender));
    ipc.handle('senderkeys.resolveSender', async (_e, sid) => exports.senderKeys.resolveSender(sid) ?? null);
    ipc.handle('senderkeys.opaqueSid', async (_e, gid, uid) => exports.senderKeys.opaqueSid(gid, uid));
    ipc.handle('senderkeys.hasPeer', async (_e, gid, epoch, sid) => exports.senderKeys.hasPeer(gid, epoch, sid));
    ipc.handle('senderkeys.encryptGroup', async (_e, gid, epoch, plaintext) => exports.senderKeys.encryptGroup(gid, epoch, plaintext));
    ipc.handle('senderkeys.decryptGroup', async (_e, gid, m) => exports.senderKeys.decryptGroup(gid, m));
    ipc.handle('senderkeys.rotateEpoch', async (_e, gid, newEpoch) => { exports.senderKeys.rotateEpoch(gid, newEpoch); return true; });
}
exports.registerSenderKeysIpc = registerSenderKeysIpc;
