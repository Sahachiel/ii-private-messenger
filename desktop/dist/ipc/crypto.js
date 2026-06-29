"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCryptoIpc = void 0;
const tweetnacl_1 = __importDefault(require("tweetnacl"));
const tweetnacl_util_1 = __importDefault(require("tweetnacl-util"));
const keytar_1 = __importDefault(require("keytar"));
const SERVICE = 'ii-private-messenger';
const IDENTITY_ACC = 'identity';
const peerKeys = new Map();
let identityCache = null;
async function getOrCreateIdentity() {
    if (identityCache)
        return identityCache;
    const stored = await keytar_1.default.getPassword(SERVICE, IDENTITY_ACC);
    if (stored) {
        const m = JSON.parse(stored);
        identityCache = {
            kp: { publicKey: tweetnacl_util_1.default.decodeBase64(m.pub), secretKey: tweetnacl_util_1.default.decodeBase64(m.priv) },
            regId: m.regId,
        };
        return identityCache;
    }
    const kp = tweetnacl_1.default.box.keyPair();
    const regId = Math.floor(Math.random() * 16380) + 1;
    await keytar_1.default.setPassword(SERVICE, IDENTITY_ACC, JSON.stringify({
        pub: tweetnacl_util_1.default.encodeBase64(kp.publicKey),
        priv: tweetnacl_util_1.default.encodeBase64(kp.secretKey),
        regId,
    }));
    identityCache = { kp, regId };
    return identityCache;
}
function registerCryptoIpc(ipc) {
    ipc.handle('crypto.generateIdentity', async () => {
        const id = await getOrCreateIdentity();
        // Also build the matching Ed25519 signing key (for attestation compat with mobile)
        const seed = tweetnacl_1.default.hash(id.kp.secretKey).slice(0, 32);
        const signKp = tweetnacl_1.default.sign.keyPair.fromSeed(seed);
        const signedPriv = tweetnacl_1.default.box.keyPair();
        const signature = tweetnacl_1.default.sign.detached(signedPriv.publicKey, signKp.secretKey);
        return {
            identityPublicKey: tweetnacl_util_1.default.encodeBase64(id.kp.publicKey),
            signedPreKey: {
                keyId: 1,
                publicKey: tweetnacl_util_1.default.encodeBase64(signedPriv.publicKey),
                signature: tweetnacl_util_1.default.encodeBase64(signature),
            },
            registrationId: id.regId,
            oneTimePreKeys: [{ keyId: 1, publicKey: tweetnacl_util_1.default.encodeBase64(tweetnacl_1.default.box.keyPair().publicKey) }],
        };
    });
    ipc.handle('crypto.getIdentityPub', async () => {
        const id = await getOrCreateIdentity();
        return tweetnacl_util_1.default.encodeBase64(id.kp.publicKey);
    });
    ipc.handle('crypto.buildSession', async (_e, peer, theirPubB64) => {
        peerKeys.set(peer, tweetnacl_util_1.default.decodeBase64(theirPubB64));
        return true;
    });
    ipc.handle('crypto.encrypt', async (_e, peer, plaintext) => {
        const id = await getOrCreateIdentity();
        const peerPub = peerKeys.get(peer);
        if (!peerPub)
            throw new Error(`no session with ${peer}`);
        const nonce = tweetnacl_1.default.randomBytes(tweetnacl_1.default.box.nonceLength);
        const msg = tweetnacl_util_1.default.decodeUTF8(plaintext);
        const cipher = tweetnacl_1.default.box(msg, nonce, peerPub, id.kp.secretKey);
        const out = new Uint8Array(nonce.length + cipher.length);
        out.set(nonce, 0);
        out.set(cipher, nonce.length);
        return { type: 1, ciphertext: tweetnacl_util_1.default.encodeBase64(out) };
    });
    ipc.handle('crypto.decrypt', async (_e, peer, cipherB64) => {
        const id = await getOrCreateIdentity();
        const peerPub = peerKeys.get(peer);
        if (!peerPub)
            throw new Error(`no session with ${peer}`);
        const raw = tweetnacl_util_1.default.decodeBase64(cipherB64);
        const nonce = raw.slice(0, tweetnacl_1.default.box.nonceLength);
        const cipher = raw.slice(tweetnacl_1.default.box.nonceLength);
        const plain = tweetnacl_1.default.box.open(cipher, nonce, peerPub, id.kp.secretKey);
        if (!plain)
            throw new Error('decryption failed');
        return tweetnacl_util_1.default.encodeUTF8(plain);
    });
}
exports.registerCryptoIpc = registerCryptoIpc;
