"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.kemDecapsulate = exports.kemEncapsulate = exports.kemKeygen = void 0;
const tweetnacl_util_1 = __importDefault(require("tweetnacl-util"));
/**
 * ML-KEM-768 (FIPS 203) per l'accordo di chiave ibrido post-quantum, allineato a
 * mobile/src/services/pqkem.ts. @noble/post-quantum è ESM-only e Electron (Node 20) non fa
 * require(ESM): usiamo un dynamic import REALE. Il Function-trick evita che tsc (module=commonjs)
 * lo transpili in require(). Caricamento lazy + cache del modulo.
 */
const b64 = { enc: tweetnacl_util_1.default.encodeBase64, dec: tweetnacl_util_1.default.decodeBase64 };
const dynImport = new Function('m', 'return import(m)');
let cached = null;
async function mlkem() {
    if (!cached)
        cached = (await dynImport('@noble/post-quantum/ml-kem.js')).ml_kem768;
    return cached;
}
async function kemKeygen() {
    const k = await mlkem();
    const kp = k.keygen();
    return { pub: b64.enc(kp.publicKey), sec: b64.enc(kp.secretKey) };
}
exports.kemKeygen = kemKeygen;
async function kemEncapsulate(peerPubB64) {
    const k = await mlkem();
    const { cipherText, sharedSecret } = k.encapsulate(b64.dec(peerPubB64));
    return { ct: b64.enc(cipherText), ss: b64.enc(sharedSecret) };
}
exports.kemEncapsulate = kemEncapsulate;
async function kemDecapsulate(ctB64, mySecB64) {
    const k = await mlkem();
    return b64.enc(k.decapsulate(b64.dec(ctB64), b64.dec(mySecB64)));
}
exports.kemDecapsulate = kemDecapsulate;
