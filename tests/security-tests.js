/**
 * Suite riproducibile delle invarianti di SICUREZZA di II Private Messenger.
 *   cd tests && npm install && npm test
 *
 * Replica fedelmente gli algoritmi del prodotto (stessi primitivi: Ed25519, X25519,
 * SHA-512, XSalsa20-Poly1305) per provare, in isolamento e in modo deterministico:
 *   1) Inviti firmati (per-tipo, bind, scadenza, anti-tamper)
 *   2) Membership-capability lato relay (ricostruzione SPKI, anti-forgery)
 *   3) Sender Keys di gruppo (anti-spoof, ISOLAMENTO su rotazione epoch)
 *   4) Double Ratchet pairwise (forward secrecy, out-of-order, anti-tamper)
 *
 * NON copre l'isolamento a livello di route HTTP (404 ai non-membri, drop relay): quelli
 * richiedono backend+relay+DB attivi — vedi SECURITY_TESTS.md per la checklist d'integrazione.
 */
const crypto = require('crypto');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');

const b64 = { enc: util.encodeBase64, dec: util.decodeBase64 };
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); };
const section = (s) => console.log(`\n=== ${s} ===`);

// ---------- 1) INVITI FIRMATI (Ed25519, per-tipo) ----------
section('1) Inviti firmati');
{
  const kp = crypto.generateKeyPairSync('ed25519');
  const pub = crypto.createPublicKey(kp.privateKey);
  const u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fu = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sign = (p) => { const b = u(Buffer.from(JSON.stringify(p))); return b + '.' + u(crypto.sign(null, Buffer.from(b), kp.privateKey)); };
  const verify = (t, type) => { const a = t.split('.'); if (a.length !== 2) return null; if (!crypto.verify(null, Buffer.from(a[0]), pub, fu(a[1]))) return null; const p = JSON.parse(fu(a[0])); if (p.t !== type) return null; if (p.exp < Math.floor(Date.now() / 1000)) return null; return p; };
  const now = Math.floor(Date.now() / 1000);
  const inv = sign({ t: 'gi', gid: 'G', jti: 'n', exp: now + 60, bnd: 'user-x' });
  ok(verify(inv, 'gi')?.bnd === 'user-x', 'invito valido + bind al destinatario');
  ok(verify(inv, 'cap') === null, 'tipo errato (gi usato come cap) RIFIUTATO');
  ok(verify(inv.slice(0, -3) + 'AAA', 'gi') === null, 'firma manomessa RIFIUTATA');
  ok(verify(sign({ t: 'gi', gid: 'G', jti: 'n', exp: now - 1 }), 'gi') === null, 'invito scaduto RIFIUTATO');
}

// ---------- 2) MEMBERSHIP-CAPABILITY (verifica lato relay) ----------
section('2) Membership-capability (relay)');
{
  const kp = crypto.generateKeyPairSync('ed25519');
  const rawPub = crypto.createPublicKey(kp.privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fu = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const signCap = (p) => { const b = u(Buffer.from(JSON.stringify(p))); return b + '.' + u(crypto.sign(null, Buffer.from(b), kp.privateKey)); };
  // relay ricostruisce la pubkey da raw32 via prefisso SPKI Ed25519
  const relayKey = (rb) => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(rb, 'base64')]), format: 'der', type: 'spki' });
  const relayVerify = (cap, key) => { const a = cap.split('.'); if (a.length !== 2) return null; if (!crypto.verify(null, Buffer.from(a[0]), key, fu(a[1]))) return null; const p = JSON.parse(fu(a[0])); if (p.t !== 'cap') return null; if (p.exp < Math.floor(Date.now() / 1000)) return null; return p; };
  const key = relayKey(rawPub);
  const now = Math.floor(Date.now() / 1000);
  ok(relayVerify(signCap({ t: 'cap', gid: 'G', uid: 'U', epoch: 5, exp: now + 60 }), key)?.epoch === 5, 'relay verifica capability del backend (SPKI ok)');
  const other = crypto.generateKeyPairSync('ed25519');
  const forged = (() => { const b = u(Buffer.from(JSON.stringify({ t: 'cap', gid: 'G', uid: 'U', epoch: 5, exp: now + 60 }))); return b + '.' + u(crypto.sign(null, Buffer.from(b), other.privateKey)); })();
  ok(relayVerify(forged, key) === null, 'capability firmata da ALTRA chiave RIFIUTATA');
}

// ---------- 3) SENDER KEYS (isolamento su rotazione epoch) ----------
section('3) Sender Keys di gruppo');
{
  const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };
  const kdf = (l, k) => nacl.hash(cat(l, k)).slice(0, 32);
  const LC = Uint8Array.of(2), LM = Uint8Array.of(1);
  const u32 = (n) => { const b = new Uint8Array(4); b[0] = (n >>> 24) & 255; b[1] = (n >>> 16) & 255; b[2] = (n >>> 8) & 255; b[3] = n & 255; return b; };
  const sm = (g, e, i, n, c) => nacl.hash(cat(cat(cat(cat(util.decodeUTF8(g), u32(e)), u32(i)), n), c)).slice(0, 32);
  function M(id) { this.id = id; this.own = {}; this.peer = {}; }
  M.prototype.go = function (g, e) { const k = g + ':' + e; if (!this.own[k]) { const c = nacl.randomBytes(32); const s = nacl.sign.keyPair(); this.own[k] = { ck: b64.enc(c), i: 0, spk: b64.enc(s.publicKey), ssk: b64.enc(s.secretKey) }; } return this.own[k]; };
  M.prototype.dist = function (g, e) { const o = this.go(g, e); return { sid: this.id, e, ck: o.ck, i: o.i, spk: o.spk }; };
  M.prototype.proc = function (g, d) { this.peer[g + ':' + d.e + ':' + d.sid] = { ck: d.ck, i: d.i, spk: d.spk }; };
  M.prototype.enc = function (g, e, pt) { const o = this.go(g, e); let ch = b64.dec(o.ck); const it = o.i; const mk = kdf(LM, ch); const n = nacl.randomBytes(24); const c = nacl.secretbox(util.decodeUTF8(pt), n, mk); const s = nacl.sign.detached(sm(g, e, it, n, c), b64.dec(o.ssk)); o.ck = b64.enc(kdf(LC, ch)); o.i = it + 1; return { sid: this.id, e, i: it, n: b64.enc(n), c: b64.enc(c), s: b64.enc(s) }; };
  M.prototype.dec = function (g, m) { const p = this.peer[g + ':' + m.e + ':' + m.sid]; if (!p) throw new Error('no_sender_key'); const n = b64.dec(m.n), c = b64.dec(m.c); if (!nacl.sign.detached.verify(sm(g, m.e, m.i, n, c), b64.dec(m.s), b64.dec(p.spk))) throw new Error('bad_signature'); let ch = b64.dec(p.ck); const mk = kdf(LM, ch); const pt = nacl.secretbox.open(c, n, mk); if (!pt) throw new Error('decrypt'); return util.encodeUTF8(pt); };
  const G = 'g'; const al = new M('al'); const bob = new M('bob');
  bob.proc(G, al.dist(G, 1));
  ok(bob.dec(G, al.enc(G, 1, 'ciao')) === 'ciao', 'roundtrip sender-key');
  const mal = new M('mal'); const forged = mal.enc(G, 1, 'spoof'); forged.sid = 'al';
  let r; try { const fr = new M('fr'); fr.proc(G, al.dist(G, 1)); fr.dec(G, forged); r = false; } catch (e) { r = e.message === 'bad_signature'; } ok(r, 'spoof (firma di altro membro) RIFIUTATO');
  const eve = new M('eve'); eve.proc(G, al.dist(G, 1));
  let iso; try { eve.dec(G, new M('al').enc(G, 2, 'post-kick')); iso = false; } catch (e) { iso = e.message === 'no_sender_key'; }
  ok(iso, 'ISOLAMENTO: ex-membro (epoch 1) NON decifra epoch 2');
}

// ---------- 4) DOUBLE RATCHET (forward secrecy pairwise) ----------
section('4) Double Ratchet pairwise');
{
  const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };
  const dh = (s, p) => nacl.box.before(b64.dec(p), b64.dec(s));
  const kRK = (rk, d) => { const h = nacl.hash(cat(b64.dec(rk), d)); return { rk: b64.enc(h.slice(0, 32)), ck: b64.enc(h.slice(32, 64)) }; };
  const kCK = (ck) => { const c = b64.dec(ck); return { ck: b64.enc(nacl.hash(cat(Uint8Array.of(2), c)).slice(0, 32)), mk: nacl.hash(cat(Uint8Array.of(1), c)).slice(0, 32) }; };
  const eM = (mk, pt) => { const n = nacl.randomBytes(24); return b64.enc(cat(n, nacl.secretbox(util.decodeUTF8(pt), n, mk))); };
  const dM = (mk, pb) => { const r = b64.dec(pb); const p = nacl.secretbox.open(r.slice(24), r.slice(0, 24), mk); if (!p) throw new Error('fail'); return util.encodeUTF8(p); };
  const A = (iks, ikp, tik, tspk) => { const sk = b64.enc(dh(iks, tik)); const k = nacl.box.keyPair(); const dp = b64.enc(k.publicKey), ds = b64.enc(k.secretKey); const { rk, ck } = kRK(sk, dh(ds, tspk)); return { rk, dhsPub: dp, dhsSec: ds, dhrPub: tspk, cks: ck, ckr: null, ns: 0, nr: 0, pn: 0, ik: ikp, skip: {} }; };
  const B = (iks, ikp, sp, ss, h) => ({ rk: b64.enc(dh(iks, h.ik)), dhsPub: sp, dhsSec: ss, dhrPub: null, cks: null, ckr: null, ns: 0, nr: 0, pn: 0, ik: ikp, skip: {} });
  const enc = (s, pt) => { const { ck, mk } = kCK(s.cks); s.cks = ck; const h = { dh: s.dhsPub, pn: s.pn, n: s.ns, ik: s.ik }; s.ns++; return { h, c: eM(mk, pt) }; };
  const sk = (s, u) => { if (s.ckr === null) return; while (s.nr < u) { const { ck, mk } = kCK(s.ckr); s.skip[s.dhrPub + ':' + s.nr] = b64.enc(mk); s.ckr = ck; s.nr++; } };
  const rt = (s, h) => { s.pn = s.ns; s.ns = 0; s.nr = 0; s.dhrPub = h.dh; let r = kRK(s.rk, dh(s.dhsSec, s.dhrPub)); s.rk = r.rk; s.ckr = r.ck; const k = nacl.box.keyPair(); s.dhsPub = b64.enc(k.publicKey); s.dhsSec = b64.enc(k.secretKey); r = kRK(s.rk, dh(s.dhsSec, s.dhrPub)); s.rk = r.rk; s.cks = r.ck; };
  const dec = (s, h, c) => { const kk = h.dh + ':' + h.n; if (s.skip[kk]) { const mk = b64.dec(s.skip[kk]); delete s.skip[kk]; return dM(mk, c); } if (h.dh !== s.dhrPub) { sk(s, h.pn); rt(s, h); } sk(s, h.n); const { ck, mk } = kCK(s.ckr); s.ckr = ck; s.nr++; return dM(mk, c); };
  const aik = nacl.box.keyPair(), bik = nacl.box.keyPair(), bspk = nacl.box.keyPair();
  const a = A(b64.enc(aik.secretKey), b64.enc(aik.publicKey), b64.enc(bik.publicKey), b64.enc(bspk.publicKey));
  const m1 = enc(a, 'ciao'); const bo = B(b64.enc(bik.secretKey), b64.enc(bik.publicKey), b64.enc(bspk.publicKey), b64.enc(bspk.secretKey), m1.h);
  ok(dec(bo, m1.h, m1.c) === 'ciao', 'bootstrap X3DH + decifratura 1° messaggio');
  const m2 = enc(bo, 'risposta'); ok(dec(a, m2.h, m2.c) === 'risposta', 'DH ratchet bidirezionale');
  const o1 = enc(a, 'uno'), o2 = enc(a, 'due'), o3 = enc(a, 'tre');
  ok(dec(bo, o3.h, o3.c) === 'tre' && dec(bo, o1.h, o1.c) === 'uno' && dec(bo, o2.h, o2.c) === 'due', 'out-of-order (skipped keys)');
  const tm = enc(a, 'x'); let tf; try { dec(bo, tm.h, tm.c.slice(0, -4) + 'AAAA'); tf = false; } catch (e) { tf = true; } ok(tf, 'ciphertext manomesso RIFIUTATO');
}

console.log(`\n${'='.repeat(40)}\nTOTALE: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
