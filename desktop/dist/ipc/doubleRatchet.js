"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.drDecrypt = exports.drEncrypt = exports.initBob = exports.initAlice = void 0;
/**
 * Double Ratchet (Signal) — PORTATO 1:1 da mobile/src/services/doubleRatchet.ts.
 * Modulo PURO (tweetnacl + base64) → identico bit-per-bit al mobile per l'interop E2EE.
 * NON modificare gli algoritmi/KDF senza allinearli anche sul mobile.
 */
const tweetnacl_1 = __importDefault(require("tweetnacl"));
const tweetnacl_util_1 = __importDefault(require("tweetnacl-util"));
const b64 = { enc: tweetnacl_util_1.default.encodeBase64, dec: tweetnacl_util_1.default.decodeBase64 };
const MAX_SKIP = 256;
function concat(a, b) {
    const o = new Uint8Array(a.length + b.length);
    o.set(a, 0);
    o.set(b, a.length);
    return o;
}
function dh(secB64, pubB64) {
    return tweetnacl_1.default.box.before(b64.dec(pubB64), b64.dec(secB64));
}
function kdfRK(rkB64, dhOut) {
    const h = tweetnacl_1.default.hash(concat(b64.dec(rkB64), dhOut));
    return { rk: b64.enc(h.slice(0, 32)), ck: b64.enc(h.slice(32, 64)) };
}
function kdfCK(ckB64) {
    const ck = b64.dec(ckB64);
    const mk = tweetnacl_1.default.hash(concat(Uint8Array.of(0x01), ck)).slice(0, 32);
    const nck = tweetnacl_1.default.hash(concat(Uint8Array.of(0x02), ck)).slice(0, 32);
    return { ck: b64.enc(nck), mk };
}
// PADDING METADATI (taglia fissa, ISO/IEC 7816-4) — IDENTICO a mobile/doubleRatchet.ts.
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
function encryptMsg(mk, plaintext) {
    const nonce = tweetnacl_1.default.randomBytes(tweetnacl_1.default.secretbox.nonceLength);
    const ct = tweetnacl_1.default.secretbox(padTo(tweetnacl_util_1.default.decodeUTF8(plaintext)), nonce, mk);
    return b64.enc(concat(nonce, ct));
}
function decryptMsg(mk, packedB64) {
    const raw = b64.dec(packedB64);
    const nonce = raw.slice(0, tweetnacl_1.default.secretbox.nonceLength);
    const ct = raw.slice(tweetnacl_1.default.secretbox.nonceLength);
    const pt = tweetnacl_1.default.secretbox.open(ct, nonce, mk);
    if (!pt)
        throw new Error('dr_decrypt_failed');
    return tweetnacl_util_1.default.encodeUTF8(unpad(pt));
}
/**
 * X3DH ibrido post-quantum (PQXDH). SK = H( DH(IK_a,IK_b) || DH(IK_a,OTP_b)? || ss_pq? )[:32].
 * Ordine fisso classico→OTP→ML-KEM. Identico al mobile per l'interop.
 */
function x3dhSecret(dhIkIk, dhIkOtp, pqSecret) {
    if (!dhIkOtp && !pqSecret)
        return b64.enc(dhIkIk);
    let acc = dhIkIk;
    if (dhIkOtp)
        acc = concat(acc, dhIkOtp);
    if (pqSecret)
        acc = concat(acc, pqSecret);
    return b64.enc(tweetnacl_1.default.hash(acc).slice(0, 32));
}
function initAlice(myIKSec, myIKPub, theirIKPub, theirSPKPub, theirOTP, pqSecret, pqCt) {
    const sk = x3dhSecret(dh(myIKSec, theirIKPub), theirOTP ? dh(myIKSec, theirOTP.pub) : undefined, pqSecret ? b64.dec(pqSecret) : undefined);
    const dhs = tweetnacl_1.default.box.keyPair();
    const dhsPub = b64.enc(dhs.publicKey);
    const dhsSec = b64.enc(dhs.secretKey);
    const { rk, ck } = kdfRK(sk, dh(dhsSec, theirSPKPub));
    return { rk, dhsPub, dhsSec, dhrPub: theirSPKPub, cks: ck, ckr: null, ns: 0, nr: 0, pn: 0, ikPub: myIKPub, otpId: theirOTP?.keyId, pqct: pqCt, skipped: {} };
}
exports.initAlice = initAlice;
function initBob(myIKSec, myIKPub, mySPKPub, mySPKSec, header, myOTPSec, pqSecret) {
    const useOtp = header.otpId != null && !!myOTPSec;
    const sk = x3dhSecret(dh(myIKSec, header.ik), useOtp ? dh(myOTPSec, header.ik) : undefined, pqSecret ? b64.dec(pqSecret) : undefined);
    return { rk: sk, dhsPub: mySPKPub, dhsSec: mySPKSec, dhrPub: null, cks: null, ckr: null, ns: 0, nr: 0, pn: 0, ikPub: myIKPub, skipped: {} };
}
exports.initBob = initBob;
function drEncrypt(s, plaintext) {
    if (!s.cks)
        throw new Error('no_sending_chain');
    const { ck, mk } = kdfCK(s.cks);
    s.cks = ck;
    const header = { dh: s.dhsPub, pn: s.pn, n: s.ns, ik: s.ikPub };
    // OTP e ciphertext ML-KEM SOLO nel primissimo messaggio dell'initiator (flag one-shot, ns si azzera al ratchet).
    if (s.otpId != null) {
        header.otpId = s.otpId;
        s.otpId = undefined;
    }
    if (s.pqct != null) {
        header.pqct = s.pqct;
        s.pqct = undefined;
    }
    s.ns += 1;
    return { header, ct: encryptMsg(mk, plaintext) };
}
exports.drEncrypt = drEncrypt;
function skipMessageKeys(s, until) {
    if (s.ckr === null)
        return;
    if (s.nr + MAX_SKIP < until)
        throw new Error('too_many_skipped');
    while (s.nr < until) {
        const { ck, mk } = kdfCK(s.ckr);
        s.skipped[`${s.dhrPub}:${s.nr}`] = b64.enc(mk);
        s.ckr = ck;
        s.nr += 1;
    }
    const keys = Object.keys(s.skipped);
    if (keys.length > MAX_SKIP)
        keys.slice(0, keys.length - MAX_SKIP).forEach((k) => delete s.skipped[k]);
}
function dhRatchet(s, header) {
    s.pn = s.ns;
    s.ns = 0;
    s.nr = 0;
    s.dhrPub = header.dh;
    const r1 = kdfRK(s.rk, dh(s.dhsSec, s.dhrPub));
    s.rk = r1.rk;
    s.ckr = r1.ck;
    const kp = tweetnacl_1.default.box.keyPair();
    s.dhsPub = b64.enc(kp.publicKey);
    s.dhsSec = b64.enc(kp.secretKey);
    const r2 = kdfRK(s.rk, dh(s.dhsSec, s.dhrPub));
    s.rk = r2.rk;
    s.cks = r2.ck;
}
function drDecrypt(s, header, ct) {
    const skKey = `${header.dh}:${header.n}`;
    if (s.skipped[skKey]) {
        const mk = b64.dec(s.skipped[skKey]);
        delete s.skipped[skKey];
        return decryptMsg(mk, ct);
    }
    if (header.dh !== s.dhrPub) {
        skipMessageKeys(s, header.pn);
        dhRatchet(s, header);
    }
    skipMessageKeys(s, header.n);
    if (!s.ckr)
        throw new Error('no_receiving_chain');
    const { ck, mk } = kdfCK(s.ckr);
    s.ckr = ck;
    s.nr += 1;
    return decryptMsg(mk, ct);
}
exports.drDecrypt = drDecrypt;
