/* eslint-env browser */
/* global window, iimsg */

// Envelope v2 decoder — mirrors mobile/src/services/envelope.ts. Messages from
// mobile v0.2.5+ carry a JSON envelope inside the E2EE plaintext; older clients
// just send raw text, so we fall back to treat the plaintext as the body.
function decodeEnvelope(plain) {
  const t = (plain ?? '').trim();
  if (!t.startsWith('{')) return { v: 2, kind: 'text', body: plain ?? '' };
  try {
    const o = JSON.parse(t);
    if (o && o.v === 2 && typeof o.kind === 'string') return { body: '', ...o };
  } catch {}
  return { v: 2, kind: 'text', body: plain ?? '' };
}
function encodeEnvelope(e) { return JSON.stringify(e); }

const state = {
  authed: false,
  me: { userId: null, username: null, fingerprint: null },
  chats: {},        // peerId -> { peerName, messages: [...] }
  activeChat: null,
  groups: {},       // gid -> { id, name, epoch, memberIds:[], messages:[] }
  activeGroup: null,
  distSent: {},     // gid -> epoch (sender-key distribution già inviata per quell'epoch)
  users: [],        // search results
  peerTrust: {},    // peerId -> { level, score, ts }
  replyTo: null,    // { id, senderId, preview, kind } — set by tapping Reply on a bubble
  view: 'chat',     // 'chat' | 'pairing'
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'onClick') n.onclick = attrs[k];
    else if (k === 'onInput') n.oninput = attrs[k];
    else if (k === 'onKey') n.onkeydown = attrs[k];
    else if (k === 'class') n.className = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
};

// ---------- Invio media (foto/video/vocali/file) — stesso envelope v2 del mobile ----------
const MAX_B64 = 1_500_000; // ~1.1MB raw, come il cap del mobile (media inline base64)
let mediaRecorder = null;
let recChunks = [];

function kindForMime(mime) {
  if (/^image\//.test(mime)) return 'image';
  if (/^video\//.test(mime)) return 'video';
  if (/^audio\//.test(mime)) return 'voice';
  return 'file';
}
function blobToMedia(blob, name) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const d = String(r.result);
      const b64 = d.slice(d.indexOf(',') + 1);
      if (b64.length > MAX_B64) { reject(new Error('File troppo grande (max ~1.1MB inline)')); return; }
      resolve({ mime: blob.type || 'application/octet-stream', data: b64, size: blob.size, name: name });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function sendMediaMessage(peerId, kind, body, media) {
  const convo = state.chats[peerId];
  if (!convo) return;
  const clientMsgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const envelope = { v: 2, kind, body: body || '', media, clientMsgId };
  const payload = await iimsg.crypto.encrypt(peerId, encodeEnvelope(envelope));
  await iimsg.socket.send({
    type: 'send_message', messageId: clientMsgId, to: peerId,
    conversationId: peerId, ciphertext: JSON.stringify({ payload }),
    messageType: kind, timestamp: Date.now(),
  });
  convo.messages.push({ id: clientMsgId, mine: true, kind, body: body || '', media, ts: Date.now(), status: 'sent' });
  render();
}
async function toggleRecord(peerId, btn) {
  if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      btn.textContent = '🎤'; btn.classList.remove('recording');
      try {
        const blob = new Blob(recChunks, { type: 'audio/webm' });
        const media = await blobToMedia(blob, 'voice.webm');
        await sendMediaMessage(peerId, 'voice', '', media);
      } catch (e) { alert(e.message || String(e)); }
      mediaRecorder = null;
    };
    mediaRecorder.start();
    btn.textContent = '⏹'; btn.classList.add('recording');
  } catch (e) { alert('Microfono non disponibile'); }
}

// ============================ GRUPPI (interop col mobile group-centric) ============================
// Il backend richiede che ogni messaggio di chat sia di gruppo (gid + capability firmata + Sender
// Keys). Qui il desktop parla lo STESSO protocollo del mobile: capability dal backend, distribuzione
// della sender key via canale pairwise Double Ratchet, poi fan-out del ciphertext sender-key ai membri.

function persistGroups() {
  try { localStorage.setItem('iimsg.groups', JSON.stringify(state.groups)); } catch {}
}
async function loadGroups() {
  try { Object.assign(state.groups, JSON.parse(localStorage.getItem('iimsg.groups') || '{}')); } catch {}
  try {
    const gl = await iimsg.groups.list();
    for (const gs of (gl || [])) {
      if (!state.groups[gs.id]) state.groups[gs.id] = { id: gs.id, name: 'Gruppo ' + gs.id.slice(0, 6), epoch: gs.epoch, memberIds: [], messages: [] };
      else state.groups[gs.id].epoch = gs.epoch;
    }
  } catch {}
  persistGroups();
}

// Electron NON supporta window.prompt() (ritorna sempre null) → modal di input custom.
function askInput(title, placeholder, opts) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'lightbox' });
    const card = el('div', { style: 'background:#FFFFFF;padding:22px;border-radius:14px;max-width:440px;width:88%;color:#111B21;font:13px system-ui;' });
    card.appendChild(el('div', { style: 'font-weight:700;margin-bottom:12px;font-size:15px;' }, title));
    const input = el(opts && opts.multiline ? 'textarea' : 'input', {
      placeholder: placeholder || '',
      style: 'width:100%;box-sizing:border-box;padding:10px;background:#F0F2F5;color:#111B21;border:1px solid #E9EDEF;border-radius:8px;font:13px system-ui;' + (opts && opts.multiline ? 'height:72px;resize:vertical;' : ''),
    });
    card.appendChild(input);
    const done = (v) => { overlay.remove(); resolve(v); };
    const row = el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;' }, [
      el('button', { class: 'ghost', onClick: () => done(null) }, 'Annulla'),
      el('button', { onClick: () => done(input.value.trim() || null) }, 'OK'),
    ]);
    card.appendChild(row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !(opts && opts.multiline)) done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    };
    setTimeout(() => input.focus(), 30);
  });
}

async function createGroupFlow() {
  const name = await askInput('Nuovo gruppo', 'Nome del gruppo (solo lato client)…');
  if (!name) return;
  try {
    const res = await iimsg.groups.create(50);
    state.groups[res.id] = { id: res.id, name: name.trim(), epoch: res.epoch, memberIds: [state.me.userId], messages: [] };
    state.activeGroup = res.id; state.activeChat = null;
    persistGroups(); render();
    inviteToGroup(res.id); // apri subito l'invito così puoi aggiungere qualcuno
  } catch (e) { toast('Creazione gruppo fallita: ' + (e.message || e)); }
}

// Estrae il token invito da qualunque forma: token grezzo, JSON {k:'gi',t:...} (QR mobile),
// oppure deep-link iimsg://join?t=<token>.
function extractInviteToken(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  try { const o = JSON.parse(s); if (o && o.k === 'gi' && typeof o.t === 'string') return o.t; } catch {}
  const m = s.match(/[?&]t=([^&\s]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return s;
}

async function joinGroupFlow() {
  const input = await askInput('Unisciti a un gruppo', 'Incolla il token, il QR {k:"gi",…} o il link iimsg://join…', { multiline: true });
  if (!input) return;
  const token = extractInviteToken(input);
  if (!token) { toast('Invito non riconosciuto'); return; }
  try {
    const res = await iimsg.groups.join(token);
    if (res.status === 'joined' || res.status === 'already_member') {
      if (!state.groups[res.gid]) state.groups[res.gid] = { id: res.gid, name: 'Gruppo ' + res.gid.slice(0, 6), epoch: 0, memberIds: [], messages: [] };
      state.activeGroup = res.gid; state.activeChat = null;
      state.distSent[res.gid] = -1; // forza (ri)distribuzione della mia sender key al primo invio
      persistGroups(); render();
      toast('Entrato nel gruppo.', 'ok');
    } else {
      toast('Richiesta di ingresso inviata: in attesa di approvazione.');
    }
  } catch (e) { toast('Ingresso fallito: ' + (e.message || e)); }
}

// Aggiunge un contatto col suo CODICE: risolve il codice → crea un gruppo 1:1 con invito
// vincolato al destinatario (monouso, senza approvazione) → recapita l'invito "seamless" via
// relay (contact_invite). Appena l'altro accetta, entra nel gruppo e la chat è attiva ed E2EE.
async function addByCodeFlow(rawCode) {
  const q = (rawCode || '').trim().toUpperCase();
  if (q.length < 6) { toast('Codice non valido (es. IIM-XXXX-XXXX-XXXX)'); return; }
  if (state.me.code && q === state.me.code.toUpperCase()) { toast('Questo è il tuo codice'); return; }
  try {
    const found = await iimsg.api.byCode(q);
    if (!found) { toast('Nessun utente con questo codice'); return; }
    if (found.id === state.me.userId) { toast('Questo è il tuo codice'); return; }
    const g = await iimsg.groups.create(2);
    const inv = await iimsg.groups.invite(g.id, {
      bound_user_id: found.id, requires_approval: false, max_uses: 1, ttl_seconds: 7 * 24 * 3600,
    });
    const myName = state.me.displayName || state.me.username || 'Qualcuno';
    // Il socket desktop NON accoda: se non è OPEN, send ritorna false e l'invito andrebbe perso.
    // Verifichiamo la consegna prima di creare lo stato locale, così non diamo un falso successo.
    const sent = await iimsg.socket.send({ type: 'contact_invite', to: found.id, token: inv.token, fromName: myName, fromCode: state.me.code || '' });
    if (!sent) { toast('Connessione al relay non pronta: riprova tra un istante.'); return; }
    const nm = found.displayName || 'Contatto';
    state.groups[g.id] = { id: g.id, name: nm, epoch: g.epoch, memberIds: [state.me.userId], messages: [] };
    state.distSent[g.id] = -1; // forza distribuzione sender key al primo invio
    state.activeGroup = g.id; state.activeChat = null;
    persistGroups(); render();
    toast('Richiesta inviata a ' + nm + '. Appena accetta, la chat è attiva.', 'ok');
  } catch (e) { toast('Aggiunta contatto fallita: ' + (e.message || e)); }
}

async function leaveGroupFlow(gid) {
  const g = state.groups[gid];
  if (!g) return;
  if (!confirm('Uscire ed eliminare "' + g.name + '" dalla lista?')) return;
  try { await iimsg.groups.leave(gid); } catch (e) { /* rimuovi localmente anche se il backend fallisce */ }
  delete state.groups[gid];
  delete state.distSent[gid];
  if (state.activeGroup === gid) state.activeGroup = null;
  persistGroups();
  render();
  toast('Gruppo rimosso', 'ok');
}

// Verifica identità (numero di sicurezza) per una chat 1:1. Risolve l'altro membro, ne prende
// l'identity key e calcola il numero a 60 cifre (stesso algoritmo del mobile → i numeri coincidono).
// Avvia una chiamata da una chat di gruppo 1:1 (2 membri): risolve l'altro membro e chiama.
async function startGroupCall(gid, isVideo) {
  try {
    const members = await iimsg.groups.members(gid);
    const others = members.map((m) => m.user_id).filter((u) => u !== state.me.userId);
    if (others.length !== 1) { toast('Le chiamate sono disponibili solo nelle chat 1:1.'); return; }
    const name = (state.groups[gid] && state.groups[gid].name) || 'Contatto';
    if (window.iimsgCall && window.iimsgCall.start) window.iimsgCall.start(others[0], name, isVideo);
    else toast('Modulo chiamate non disponibile.');
  } catch (e) { toast('Impossibile avviare la chiamata: ' + (e.message || e)); }
}

async function verifyGroupFlow(gid) {
  try {
    const members = await iimsg.groups.members(gid);
    const others = members.map((m) => m.user_id).filter((u) => u !== state.me.userId);
    if (others.length === 0) { toast('Nessun altro membro da verificare.'); return; }
    if (others.length > 1) { toast('La verifica è disponibile solo per le chat 1:1.'); return; }
    const bundle = await iimsg.api.getUserKeys(others[0]);
    const sn = await iimsg.crypto.safetyNumber(bundle.identityPublicKey);
    showSafetyDialog((state.groups[gid] && state.groups[gid].name) || 'Contatto', sn);
  } catch (e) { toast('Impossibile calcolare il numero di sicurezza: ' + (e.message || e)); }
}

function showSafetyDialog(peerName, sn) {
  const overlay = el('div', { class: 'lightbox', onClick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const card = el('div', { style: 'background:#FFFFFF;padding:24px;border-radius:14px;max-width:460px;color:#111B21;font:13px system-ui;text-align:center;' });
  card.appendChild(el('div', { style: 'font-weight:800;margin-bottom:4px;font-size:16px;' }, 'Verifica identità'));
  card.appendChild(el('div', { style: 'opacity:.7;margin-bottom:14px;' }, peerName));
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#F0F2F5;border:1px solid #E9EDEF;border-radius:10px;padding:16px;font:600 17px ui-monospace,monospace;letter-spacing:1px;color:#111B21;' });
  for (const part of sn.split(' ')) grid.appendChild(el('div', {}, part));
  card.appendChild(grid);
  card.appendChild(el('div', { style: 'opacity:.7;margin:14px 0;line-height:1.4;font-size:12px;' },
    'Confronta questo numero con ' + peerName + ' di persona o su un canale già fidato. Se è identico su entrambi i dispositivi, nessuno si è inserito nella conversazione.'));
  card.appendChild(el('button', { onClick: () => { navigator.clipboard.writeText(sn); toast('Numero copiato', 'ok'); } }, 'Copia numero'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function inviteToGroup(gid) {
  try {
    const res = await iimsg.groups.invite(gid, { requires_approval: false, max_uses: 5, ttl_seconds: 86400 });
    showInviteDialog(res.token, (state.groups[gid] && state.groups[gid].name) || '');
  } catch (e) { toast('Generazione invito fallita: ' + (e.message || e)); }
}

function showInviteDialog(token, groupName) {
  const overlay = el('div', { class: 'lightbox', onClick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const card = el('div', { style: 'background:#FFFFFF;padding:22px;border-radius:14px;max-width:440px;color:#111B21;font:13px system-ui;text-align:center;' });
  card.appendChild(el('div', { style: 'font-weight:700;margin-bottom:8px;font-size:15px;' }, 'Invito al gruppo'));
  card.appendChild(el('div', { style: 'opacity:.8;margin-bottom:12px;line-height:1.4;' }, 'Condividi questo token: l’altra persona lo incolla su "Unisciti" (desktop) o scansiona il QR dal telefono.'));
  const ta = el('textarea', { readonly: '', style: 'width:100%;height:64px;background:#F0F2F5;color:#027EB5;border:1px solid #E9EDEF;border-radius:8px;padding:8px;font:11px monospace;box-sizing:border-box;' });
  ta.value = token;
  card.appendChild(ta);
  const qr = el('div', { style: 'margin:12px auto;' });
  if (typeof window.qrcode === 'function') {
    // Il mobile scansiona SOLO il formato {k:'gi', t:<token>} (GroupInviteScreen). Codificare il
    // token grezzo faceva "QR non valido/formato non riconosciuto" sul telefono.
    const qrPayload = JSON.stringify(groupName ? { k: 'gi', t: token, n: groupName } : { k: 'gi', t: token });
    try { const q = window.qrcode(0, 'M'); q.addData(qrPayload); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 }); const svg = qr.querySelector('svg'); if (svg) { svg.setAttribute('width', '200'); svg.setAttribute('height', '200'); } } catch {}
  }
  card.appendChild(qr);
  card.appendChild(el('button', { onClick: () => { navigator.clipboard.writeText(token); toast('Token copiato', 'ok'); } }, 'Copia token'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// Invia read_receipt (spunte blu) per i messaggi ricevuti del gruppo attivo. Idempotente via readAcked.
async function sendGroupReadReceipts(gid) {
  const g = state.groups[gid];
  if (!g || !g.messages) return;
  state.readAcked = state.readAcked || {};
  const toAck = g.messages.filter((m) => !m.mine && m.from && m.id && !state.readAcked[m.id]);
  if (!toAck.length) return;
  let cap;
  try { cap = (await iimsg.groups.capability(gid)).cap; } catch { return; }
  for (const m of toAck) {
    state.readAcked[m.id] = true;
    try { await iimsg.socket.send({ type: 'read_receipt', to: m.from, messageId: m.id, conversationId: gid, gid, cap }); } catch {}
  }
}

async function sendToGroup(gid, kind, body, media, replyTo) {
  const g = state.groups[gid];
  if (!g) return;
  const myId = state.me.userId;
  const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let cap, epoch, others;
  try {
    const c = await iimsg.groups.capability(gid);
    cap = c.cap; epoch = c.epoch;
    const members = await iimsg.groups.members(gid);
    g.memberIds = members.map((m) => m.user_id);
    g.epoch = epoch;
    others = g.memberIds.filter((u) => u !== myId);
  } catch (e) { toast('Gruppo non disponibile: ' + (e.message || e)); return; }

  await iimsg.senderKeys.rotateEpoch(gid, epoch);

  // Distribuzione della MIA sender key ai membri (una volta per epoch), via canale pairwise.
  if ((state.distSent[gid] ?? -1) < epoch) {
    const distPlain = JSON.stringify(await iimsg.senderKeys.myDistribution(gid, epoch));
    for (const peer of others) {
      try {
        try { const bundle = await iimsg.api.getUserKeys(peer); await iimsg.crypto.buildSession(peer, bundle); } catch {}
        const payload = await iimsg.crypto.encrypt(peer, distPlain);
        await iimsg.socket.send({
          type: 'send_message', messageId: `${msgId}-d-${peer}`, to: peer,
          conversationId: gid, gid, epoch, cap,
          ciphertext: JSON.stringify({ gskd: payload, from: myId }),
          messageType: 'system', timestamp: Date.now(),
        });
      } catch {}
    }
    state.distSent[gid] = epoch;
  }

  // UNA cifratura sender-key; lo stesso ciphertext va a ciascun membro.
  const env = { v: 2, kind, body: body || '', media, replyTo: replyTo || undefined, groupId: gid, epoch, gname: g.name, clientMsgId: msgId };
  const skm = await iimsg.senderKeys.encryptGroup(gid, epoch, encodeEnvelope(env));
  const ciphertext = JSON.stringify({ gsk: skm });
  let anyPeer = false;
  for (const peer of others) {
    const ok = await iimsg.socket.send({
      type: 'send_message', messageId: `${msgId}-${peer}`, to: peer,
      conversationId: gid, gid, epoch, cap,
      ciphertext, messageType: kind, timestamp: Date.now(),
    });
    anyPeer = anyPeer || ok;
  }
  // Onestà sullo stato: se ci sono destinatari ma il socket non ha inviato a nessuno (relay
  // disconnesso), il messaggio NON è partito → status 'failed', niente falsa spunta ✓.
  const status = (others.length > 0 && !anyPeer) ? 'failed' : 'sent';
  g.messages.push({ id: msgId, mine: true, kind, body: body || '', media, replyTo, ts: Date.now(), status });
  if (others.length === 0) toast('Sei solo nel gruppo: invita qualcuno con ➕ per far arrivare i messaggi.');
  else if (!anyPeer) toast('Relay non connesso: messaggio non inviato (riprova quando torni online).');
  persistGroups(); render();
}

function renderGroupChat(gid) {
  const g = state.groups[gid];
  const chat = el('div', { class: 'chat' });
  if (!g) { chat.appendChild(el('div', { class: 'empty' }, 'Gruppo non trovato')); return chat; }
  sendGroupReadReceipts(gid); // conferme di lettura per i messaggi ricevuti (fire-and-forget)
  chat.appendChild(el('div', { class: 'chat-header' }, [
    el('div', { class: 'name-col' }, [
      el('div', { class: 'name-row' }, [el('div', { class: 'name' }, '# ' + g.name)]),
      el('div', { class: 'sub' }, '🔒 GRUPPO E2E · SENDER KEYS · ' + (g.memberIds ? g.memberIds.length : 0) + ' membri'),
    ]),
    el('div', { class: 'call-buttons' }, [
      // Chiamate solo nelle chat 1:1 (2 membri): il path di gruppo è l'unico reale.
      ...((g.memberIds && g.memberIds.length <= 2) ? [
        el('button', { class: 'call-hdr-btn', title: 'Chiamata audio', onClick: () => startGroupCall(gid, false) }, '📞'),
        el('button', { class: 'call-hdr-btn', title: 'Videochiamata', onClick: () => startGroupCall(gid, true) }, '📹'),
      ] : []),
      el('button', { class: 'call-hdr-btn', title: 'Verifica identità', onClick: () => verifyGroupFlow(gid) }, '🔒'),
      el('button', { class: 'call-hdr-btn', title: 'Invita nel gruppo', onClick: () => inviteToGroup(gid) }, '➕'),
    ]),
  ]));
  const now = Date.now();
  const visible = (g.messages || []).filter((m) => !m.expiresAt || m.expiresAt > now);
  const msgs = el('div', { class: 'messages', id: 'msgs' });
  for (const m of visible) {
    const b = el('div', { class: 'bubble ' + (m.mine ? 'mine' : 'theirs') });
    const media = renderMediaBlock(m); if (media) b.appendChild(media);
    if (m.body && m.kind !== 'voice' && m.kind !== 'file') b.appendChild(el('div', { class: 'bubble-text' }, m.body));
    b.appendChild(el('div', { class: 'bubble-meta' }, [
      el('span', { class: 'ts' }, new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      m.mine ? el('span', { class: 'tick ' + (m.status || 'sent'), style: m.status === 'read' ? 'color:#53BDEB;' : m.status === 'failed' ? 'color:#EA4335;' : '' },
        m.status === 'failed' ? '⚠' : (m.status === 'delivered' || m.status === 'read') ? '✓✓' : '✓') : null,
    ]));
    msgs.appendChild(b);
  }
  chat.appendChild(msgs);
  const composer = el('div', { class: 'composer' });
  const inputRow = el('div', { class: 'composer-row' });
  const fileInput = el('input', { type: 'file', style: 'display:none' });
  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) { try { const media = await blobToMedia(f, f.name); const kind = kindForMime(media.mime); await sendToGroup(gid, kind, kind === 'file' ? f.name : '', media); } catch (e) { alert(e.message || String(e)); } }
    fileInput.value = '';
  };
  const attachBtn = el('button', { class: 'composer-icon', title: 'Allega file / foto / video', onClick: () => fileInput.click() }, '📎');
  const input = el('input', { placeholder: 'Messaggio di gruppo cifrato…' });
  const sendBtn = el('button', {
    onClick: async () => { const body = input.value.trim(); if (!body) return; input.value = ''; await sendToGroup(gid, 'text', body, undefined); },
  }, '➤');
  input.onkeydown = (e) => { if (e.key === 'Enter') sendBtn.click(); };
  inputRow.appendChild(fileInput); inputRow.appendChild(attachBtn); inputRow.appendChild(input); inputRow.appendChild(sendBtn);
  composer.appendChild(inputRow);
  chat.appendChild(composer);
  setTimeout(() => { const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight; }, 10);
  return chat;
}

function render() {
  const app = $('#app');
  app.innerHTML = '';
  const root = el('div', { class: 'col main' });
  const titlebar = el('div', { class: 'titlebar' }, [
    el('span', { class: 'brand' }, 'II PRIVATE MESSENGER'),
    state.authed ? el('div', { class: 'titlebar-actions' }, [
      el('span', { id: 'conn-state', class: 'conn-state', style: 'font-size:12px;margin-right:10px;color:' + (state.connState === 'connected' ? '#1f8a4c' : '#c98a00') + ';' },
        state.connState === 'connected' ? '● online' : state.connState === 'reconnecting' ? '● riconnessione…' : '● offline'),
      el('button', { class: 'icon-btn', onClick: () => { state.view = state.view === 'pairing' ? 'chat' : 'pairing'; render(); } }, state.view === 'pairing' ? 'CHAT' : 'VERIFICA ID'),
    ]) : null,
  ]);
  root.appendChild(titlebar);
  if (!state.authed) root.appendChild(renderAuth());
  else if (state.view === 'pairing') root.appendChild(renderPairing());
  else root.appendChild(renderMain());
  app.appendChild(root);
}

function renderAuth() {
  const view = el('div', { class: 'auth' });
  const mode = state.authMode ?? 'login';
  view.appendChild(el('h1', {}, mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'));
  const username = el('input', { placeholder: 'username' });
  const password = el('input', { type: 'password', placeholder: 'password' });
  const dispname = mode === 'register' ? el('input', { placeholder: 'display name' }) : null;
  view.appendChild(username); view.appendChild(password);
  if (mode === 'register') {
    const pwHint = el('div', { class: 'pw-hint' });
    const reqs = [
      { re: /.{8,}/, txt: '8+ caratteri' },
      { re: /[A-Z]/, txt: '1 maiuscola' },
      { re: /[a-z]/, txt: '1 minuscola' },
      { re: /[0-9]/, txt: '1 numero' },
    ];
    const paint = () => {
      pwHint.innerHTML = '';
      for (const r of reqs) {
        const ok = r.re.test(password.value);
        pwHint.appendChild(el('span', { class: 'pw-req ' + (ok ? 'ok' : 'no') }, (ok ? '✓ ' : '○ ') + r.txt));
      }
    };
    password.oninput = paint;
    paint();
    view.appendChild(pwHint);
  }
  if (dispname) view.appendChild(dispname);
  view.appendChild(el('div', { class: 'hint' }, 'End-to-end encrypted. Keys stored on this device only.'));
  const errBox = el('div', { class: 'err' }, '');
  const btn = el('button', {
    onClick: async () => {
      errBox.textContent = '';
      if (mode === 'register') {
        if (username.value.trim().length < 3) { errBox.textContent = 'Username: minimo 3 caratteri'; return; }
        const pw = password.value;
        if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
          errBox.textContent = 'Password: minimo 8 caratteri, con almeno 1 MAIUSCOLA, 1 minuscola e 1 numero.';
          return;
        }
      }
      try {
        if (mode === 'login') {
          await iimsg.api.login(username.value.trim(), password.value);
        } else {
          const bundle = await iimsg.crypto.generateIdentity();
          await iimsg.api.register({
            username: username.value.trim(),
            displayName: dispname.value.trim() || username.value.trim(),
            password: password.value,
            countryCode: 'QA',
            ...bundle,
          });
        }
        const node = await iimsg.api.myNode();
        const tok = await getAccessToken();
        if (tok) await iimsg.socket.connect(node.relayUrl, tok);
        state.authed = true;
        state.me.username = username.value.trim();
        const sess = await iimsg.api.session().catch(() => ({}));
        state.me.userId = sess?.userId ?? null;
        state.me.fingerprint = sess?.fingerprint ?? null;
        await loadGroups();
        render();
      } catch (e) { errBox.textContent = e.message ?? String(e); }
    },
  }, mode === 'login' ? 'SIGN IN' : 'REGISTER');
  view.appendChild(btn);
  view.appendChild(el('button', {
    class: 'ghost',
    onClick: () => { state.authMode = mode === 'login' ? 'register' : 'login'; render(); },
  }, mode === 'login' ? 'Create account' : 'I have an account'));
  view.appendChild(errBox);
  return view;
}

async function getAccessToken() { return 'in-main-process'; }

function renderMain() {
  const row = el('div', { style: 'display:flex; flex:1; min-height:0;' });
  row.appendChild(renderSidebar());
  row.appendChild(renderChat());
  return row;
}

function renderSidebar() {
  const side = el('div', { class: 'sidebar' });
  const header = el('div', { class: 'sidebar-header' }, [
    el('h2', {}, `@${state.me.username ?? ''}`),
    el('button', { onClick: async () => { await iimsg.api.logout(); location.reload(); } }, 'LOGOUT'),
  ]);
  side.appendChild(header);
  // Discovery SOLO-CODICE: niente ricerca per username. Si aggiunge un contatto col suo codice.
  const searchBox = el('div', { class: 'search-box' });
  const codeInput = el('input', {
    placeholder: 'Aggiungi con codice IIM-XXXX-XXXX-XXXX…',
    onKeyDown: (e) => { if (e.key === 'Enter') { const v = e.target.value; e.target.value = ''; addByCodeFlow(v); } },
  });
  searchBox.appendChild(codeInput);
  side.appendChild(searchBox);

  // Il MIO codice, da condividere per farsi trovare (nessuno può cercarti per nome).
  const myCodeBar = el('div', { style: 'display:flex;align-items:center;gap:8px;padding:6px 12px;font-size:11px;color:#54656F;' });
  const myCodeVal = el('span', { style: 'font-weight:700;color:#00A884;letter-spacing:1px;' }, state.me.code || '…');
  myCodeBar.appendChild(el('span', { style: 'opacity:.7;' }, 'Il mio codice:'));
  myCodeBar.appendChild(myCodeVal);
  myCodeBar.appendChild(el('button', {
    class: 'ghost', style: 'padding:1px 8px;font-size:11px;',
    onClick: () => { if (state.me.code) { navigator.clipboard.writeText(state.me.code); toast('Codice copiato', 'ok'); } },
  }, 'copia'));
  side.appendChild(myCodeBar);
  if (!state.me.code) {
    iimsg.api.myCode().then((c) => { state.me.code = c; myCodeVal.textContent = c; }).catch(() => {});
  }

  const results = el('div', { class: 'chat-list', id: 'chat-list' });
  side.appendChild(results);
  function renderResults() {
    results.innerHTML = '';
    const list = state.users.length > 0 ? state.users : Object.values(state.chats).map((c) => ({
      id: c.peerId, username: c.peerName, display_name: c.peerName,
    }));
    for (const u of list) {
      const trust = state.peerTrust[u.id];
      const trustDot = trust ? el('span', { class: 'trust-dot ' + trust.level }, '') : null;
      const r = el('div', {
        class: 'chat-row' + (state.activeChat === u.id ? ' active' : ''),
        onClick: async () => {
          state.activeChat = u.id;
          state.activeGroup = null;
          state.replyTo = null;
          if (!state.chats[u.id]) {
            state.chats[u.id] = { peerId: u.id, peerName: u.display_name ?? u.username, messages: [] };
            try {
              const bundle = await iimsg.api.getUserKeys(u.id);
              await iimsg.crypto.buildSession(u.id, bundle);
            } catch (e) { console.error('session build fail', e); }
          }
          render();
        },
      }, [
        el('div', { class: 'name-row' }, [
          el('div', { class: 'name' }, u.display_name ?? u.username),
          trustDot,
        ]),
        el('div', { class: 'preview' }, '@' + u.username),
      ]);
      results.appendChild(r);
    }
  }
  renderResults();

  // ---- Sezione GRUPPI (canale che funziona davvero col backend group-centric) ----
  const grpHead = el('div', { class: 'grp-head', style: 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px 4px;font-size:11px;letter-spacing:.08em;opacity:.7;' }, [
    el('span', {}, 'GRUPPI'),
    el('div', { style: 'display:flex;gap:6px;' }, [
      el('button', { class: 'ghost', style: 'padding:2px 8px;font-size:11px;', onClick: createGroupFlow }, '+ Nuovo'),
      el('button', { class: 'ghost', style: 'padding:2px 8px;font-size:11px;', onClick: joinGroupFlow }, 'Unisciti'),
    ]),
  ]);
  side.appendChild(grpHead);
  const grpList = el('div', { class: 'chat-list' });
  const gids = Object.keys(state.groups);
  if (gids.length === 0) grpList.appendChild(el('div', { class: 'preview', style: 'padding:6px 12px;opacity:.5;' }, 'Nessun gruppo. "+ Nuovo" per iniziare.'));
  for (const gid of gids) {
    const g = state.groups[gid];
    const last = (g.messages && g.messages.length) ? g.messages[g.messages.length - 1] : null;
    const grpRow = el('div', {
      class: 'chat-row' + (state.activeGroup === gid ? ' active' : ''),
      title: 'Tasto destro per uscire/eliminare il gruppo',
      onClick: () => { state.activeGroup = gid; state.activeChat = null; state.replyTo = null; render(); },
    }, [
      el('div', { class: 'name-row' }, [el('div', { class: 'name' }, '# ' + g.name)]),
      el('div', { class: 'preview' }, last ? kindPreview(last.kind, last.body) : ((g.memberIds ? g.memberIds.length : 1) + ' membri')),
    ]);
    grpRow.oncontextmenu = (e) => { e.preventDefault(); leaveGroupFlow(gid); };
    grpList.appendChild(grpRow);
  }
  side.appendChild(grpList);
  return side;
}

function kindPreview(kind, body) {
  if (kind === 'voice')    return '🎤 Voice message';
  if (kind === 'image')    return '📷 Photo';
  if (kind === 'video')    return '🎬 Video';
  if (kind === 'file')     return '📎 File';
  if (kind === 'location') return '📍 Location';
  return body || '…';
}

function renderMediaBlock(msg) {
  if (!msg.media || !msg.media.data) return null;
  const mime = msg.media.mime || 'application/octet-stream';
  const src = `data:${mime};base64,${msg.media.data}`;
  if (msg.kind === 'image') {
    const img = el('img', { class: 'bubble-img', src });
    img.onclick = () => {
      // Minimal lightbox — open the image in a new bg.
      const overlay = el('div', { class: 'lightbox', onClick: () => overlay.remove() }, [el('img', { src })]);
      document.body.appendChild(overlay);
    };
    return img;
  }
  if (msg.kind === 'voice') {
    return el('audio', { class: 'bubble-voice', controls: '', src });
  }
  if (msg.kind === 'video') {
    return el('video', { class: 'bubble-video', controls: '', src });
  }
  if (msg.kind === 'file') {
    const a = el('a', { class: 'bubble-file', href: src, download: 'attachment' }, [
      el('span', { class: 'file-icon' }, '📎'),
      el('span', { class: 'file-name' }, msg.body || 'attachment'),
      el('span', { class: 'file-size' }, msg.media.size ? Math.round(msg.media.size / 1024) + ' KB' : ''),
    ]);
    return a;
  }
  return null;
}

function renderReactions(reactions) {
  if (!reactions) return null;
  const entries = Object.entries(reactions).filter(([, users]) => users && users.length > 0);
  if (entries.length === 0) return null;
  return el('div', { class: 'reactions' }, entries.map(([emoji, users]) =>
    el('span', { class: 'reaction-chip' }, [
      document.createTextNode(emoji),
      users.length > 1 ? el('span', { class: 'reaction-count' }, String(users.length)) : null,
    ])
  ));
}

function findMessageById(convo, id) {
  return convo.messages.find((m) => m.id === id);
}

function renderReplyPreview(convo, replyTo) {
  if (!replyTo) return null;
  return el('div', { class: 'reply-strip' }, [
    el('div', { class: 'reply-sender' }, 'In reply to'),
    el('div', { class: 'reply-text' }, kindPreview(replyTo.kind, replyTo.preview)),
  ]);
}

function renderChat() {
  if (state.activeGroup) return renderGroupChat(state.activeGroup);
  const chat = el('div', { class: 'chat' });
  const peerId = state.activeChat;
  if (!peerId) { chat.appendChild(el('div', { class: 'empty' }, 'Seleziona un contatto o un gruppo')); return chat; }
  const convo = state.chats[peerId];
  const trust = state.peerTrust[peerId];
  chat.appendChild(el('div', { class: 'chat-header' }, [
    el('div', { class: 'name-col' }, [
      el('div', { class: 'name-row' }, [
        el('div', { class: 'name' }, convo.peerName),
        trust ? el('span', { class: 'trust-pill ' + trust.level }, trust.level.toUpperCase() + (typeof trust.score === 'number' ? ' · ' + trust.score : '')) : null,
      ]),
      el('div', { class: 'sub' }, '🔒 E2E ENCRYPTED · ENVELOPE V2'),
    ]),
    el('div', { class: 'call-buttons' }, [
      el('button', { class: 'call-hdr-btn', title: 'Chiamata audio', onClick: () => window.iimsgCall && window.iimsgCall.start(peerId, convo.peerName, false) }, '📞'),
      el('button', { class: 'call-hdr-btn', title: 'Videochiamata', onClick: () => window.iimsgCall && window.iimsgCall.start(peerId, convo.peerName, true) }, '📹'),
    ]),
  ]));

  // Client-side disappearing messages — filter out expired entries at render time.
  // A background sweep also runs every 30s (see init block below) to free memory.
  const now = Date.now();
  const visible = convo.messages.filter((m) => !m.expiresAt || m.expiresAt > now);

  const msgs = el('div', { class: 'messages', id: 'msgs' });
  for (const m of visible) {
    const sideClass = m.mine ? 'mine' : 'theirs';
    const b = el('div', { class: 'bubble ' + sideClass });

    // reply-to preview inside bubble
    if (m.replyTo) {
      const quoted = findMessageById(convo, m.replyTo.id);
      b.appendChild(el('div', { class: 'reply-inbubble' }, [
        el('div', { class: 'reply-sender' }, quoted ? (quoted.mine ? 'You' : convo.peerName) : '…'),
        el('div', { class: 'reply-text' }, kindPreview(m.replyTo.kind, m.replyTo.preview)),
      ]));
    }

    const media = renderMediaBlock(m);
    if (media) b.appendChild(media);

    if (m.body && m.kind !== 'voice' && m.kind !== 'file') {
      b.appendChild(el('div', { class: 'bubble-text' }, m.body));
    }

    // meta (timestamp + TTL indicator)
    const meta = el('div', { class: 'bubble-meta' }, [
      m.expiresAt ? el('span', { class: 'ttl' }, '⏱') : null,
      el('span', { class: 'ts' }, new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      m.mine ? el('span', { class: 'tick ' + (m.status || 'sent') }, m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : '✓') : null,
    ]);
    b.appendChild(meta);

    b.appendChild(renderReactions(m.reactions));

    // actions row on hover — reply/react/copy
    const actions = el('div', { class: 'bubble-actions' }, [
      el('button', { class: 'act', onClick: () => { state.replyTo = { id: m.id, senderId: m.mine ? state.me.userId : peerId, preview: (m.body ?? '').slice(0, 80), kind: m.kind }; render(); } }, '↩'),
      el('button', { class: 'act', onClick: () => { navigator.clipboard.writeText(m.body ?? ''); } }, '⎘'),
    ]);
    b.appendChild(actions);
    msgs.appendChild(b);
  }
  chat.appendChild(msgs);

  // Composer
  const composer = el('div', { class: 'composer' });
  if (state.replyTo) {
    const strip = el('div', { class: 'reply-bar' }, [
      el('div', { class: 'reply-sender' }, 'Replying to'),
      el('div', { class: 'reply-text' }, kindPreview(state.replyTo.kind, state.replyTo.preview)),
      el('button', { class: 'reply-close', onClick: () => { state.replyTo = null; render(); } }, '✕'),
    ]);
    composer.appendChild(strip);
  }
  const inputRow = el('div', { class: 'composer-row' });
  // allega file/foto/video (input file nascosto)
  const fileInput = el('input', { type: 'file', style: 'display:none' });
  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) {
      try {
        const media = await blobToMedia(f, f.name);
        const kind = kindForMime(media.mime);
        await sendMediaMessage(peerId, kind, kind === 'file' ? f.name : '', media);
      } catch (e) { alert(e.message || String(e)); }
    }
    fileInput.value = '';
  };
  const attachBtn = el('button', { class: 'composer-icon', title: 'Allega file / foto / video', onClick: () => fileInput.click() }, '📎');
  const recBtn = el('button', { class: 'composer-icon', title: 'Registra vocale (clic per iniziare/fermare)' }, '🎤');
  recBtn.onclick = () => toggleRecord(peerId, recBtn);
  const input = el('input', { placeholder: 'Encrypted message…' });
  const sendBtn = el('button', {
    onClick: async () => {
      const body = input.value.trim(); if (!body) return;
      input.value = '';
      const envelope = {
        v: 2, kind: 'text', body,
        replyTo: state.replyTo ?? undefined,
        clientMsgId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const plain = encodeEnvelope(envelope);
      const payload = await iimsg.crypto.encrypt(peerId, plain);
      const msgId = envelope.clientMsgId;
      await iimsg.socket.send({
        type: 'send_message', messageId: msgId, to: peerId,
        conversationId: peerId, ciphertext: JSON.stringify({ payload }),
        messageType: 'text', timestamp: Date.now(),
      });
      convo.messages.push({
        id: msgId, mine: true, body, kind: 'text',
        replyTo: envelope.replyTo, ts: Date.now(), status: 'sent',
      });
      state.replyTo = null;
      render();
    },
  }, '➤');
  input.onkeydown = (e) => { if (e.key === 'Enter') sendBtn.click(); };
  inputRow.appendChild(fileInput);
  inputRow.appendChild(attachBtn);
  inputRow.appendChild(recBtn);
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  composer.appendChild(inputRow);
  chat.appendChild(composer);
  setTimeout(() => { const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight; }, 10);
  return chat;
}

function renderPairing() {
  const wrap = el('div', { class: 'pairing-wrap' });
  wrap.appendChild(el('h1', {}, 'VERIFICA IDENTITÀ'));
  const card = el('div', { class: 'pairing-card' });
  const qrHolder = el('div', { id: 'qr-holder', class: 'qr-holder' });
  card.appendChild(qrHolder);
  const user = el('div', { class: 'pairing-user' }, '@' + (state.me.username ?? ''));
  const fp = el('div', { class: 'pairing-fp' }, 'FP · ' + ((state.me.fingerprint ?? '').slice(0, 24) || '(no identity)'));
  card.appendChild(user);
  card.appendChild(fp);
  const hint = el('div', { class: 'pairing-hint' }, 'Dal telefono: Profilo → Verifica identità → Scansiona, poi confronta l’impronta qui sopra. Serve a verificare che sia lo stesso account: non collega né sincronizza account tra dispositivi.');
  card.appendChild(hint);
  const refresh = el('button', { class: 'ghost', onClick: () => drawQR() }, 'NUOVO QR');
  card.appendChild(refresh);
  wrap.appendChild(card);
  setTimeout(drawQR, 30);
  return wrap;

  function drawQR() {
    const holder = document.getElementById('qr-holder');
    if (!holder) return;
    // qrcode-generator exports a `qrcode` global. Build a v=auto M-level QR,
    // render as SVG so it scales crisp and is easy to theme.
    if (typeof window.qrcode !== 'function') { holder.textContent = '(QR lib missing)'; return; }
    const payload = {
      v: 1, appId: 'iimsg',
      userId: state.me.userId ?? '',
      username: state.me.username ?? '',
      fingerprint: (state.me.fingerprint ?? '').slice(0, 24),
      nonce: cryptoRandomNonce(),
      issuedAt: Date.now(),
      expiresAt: Date.now() + 120_000,
    };
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(JSON.stringify(payload));
      qr.make();
      holder.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2 });
      // style the generated <svg> to honor theme colors
      const svg = holder.querySelector('svg');
      if (svg) { svg.setAttribute('width', '260'); svg.setAttribute('height', '260'); }
    } catch (e) {
      holder.textContent = String(e);
    }
  }
}
function cryptoRandomNonce() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

// Toast/notice minimale (non c'era): mostra errori relay e stato connessione invece di fallire in silenzio.
function toast(text, kind) {
  let el = document.getElementById('iimsg-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'iimsg-toast';
    el.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:9999;'
      + 'padding:10px 16px;border-radius:10px;font:13px system-ui;color:#fff;max-width:80%;'
      + 'box-shadow:0 6px 24px rgba(0,0,0,.35);transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.style.background = kind === 'ok' ? '#1f8a4c' : '#b3261e';
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 4200);
}

function setConnState(s) {
  state.connState = s;
  const el = document.getElementById('conn-state');
  if (el) {
    el.textContent = s === 'connected' ? '● online' : s === 'reconnecting' ? '● riconnessione…' : '● offline';
    el.style.color = s === 'connected' ? '#1f8a4c' : '#c98a00';
  }
}

// Socket incoming message handler — decodes v2 envelope
iimsg.socket.onMessage(async (ev) => {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'socket_state') { setConnState(ev.state); return; }
  if (ev.type === 'error') {
    const map = {
      gid_required: 'Le chat di gruppo non sono ancora attive sul desktop: messaggio non inviato.',
      group_forbidden: 'Non sei membro di questo gruppo.',
      epoch_stale: 'Chiave del gruppo aggiornata: riprova a inviare.',
      no_access_token: 'Sessione non valida: esci e rientra.',
      auth_failed: 'Autenticazione al relay fallita: esci e rientra.',
    };
    toast(map[ev.error] || ('Errore relay: ' + ev.error));
    return;
  }
  // Conferme di consegna/lettura → spunte ✓✓ (grigie=consegnato, blu=letto).
  if ((ev.type === 'delivery_receipt' || ev.type === 'read_receipt') && ev.messageId) {
    const status = ev.type === 'read_receipt' ? 'read' : 'delivered';
    const rank = { sent: 1, delivered: 2, read: 3 };
    const bump = (arr) => { if (!arr) return; for (const m of arr) {
      if (!m.mine) continue;
      // i messageId di gruppo hanno suffisso -<peer>: il receipt combacia col prefisso base
      if (m.id === ev.messageId || ev.messageId === m.id || ev.messageId.startsWith(m.id + '-')) {
        if ((rank[status] || 0) > (rank[m.status] || 0)) m.status = status;
      }
    } };
    for (const gid in state.groups) bump(state.groups[gid].messages);
    for (const pid in state.chats) bump(state.chats[pid].messages);
    persistGroups(); render();
    return;
  }
  // Richiesta di contatto "seamless": qualcuno ci ha trovati col codice e ci invita.
  if (ev.type === 'contact_invite' && ev.token) {
    const nm = ev.fromName || 'Qualcuno';
    if (confirm(nm + ' vuole contattarti su II Private Messenger. Accettare?')) {
      try {
        const res = await iimsg.groups.join(ev.token);
        if (res.status === 'joined' || res.status === 'already_member') {
          if (!state.groups[res.gid]) state.groups[res.gid] = { id: res.gid, name: nm, epoch: 0, memberIds: [], messages: [] };
          else state.groups[res.gid].name = nm;
          state.distSent[res.gid] = -1;
          state.activeGroup = res.gid; state.activeChat = null;
          persistGroups(); render();
          toast('Contatto aggiunto: ' + nm, 'ok');
        } else {
          toast('Richiesta inviata: in attesa di approvazione.');
        }
      } catch (e) { toast('Invito non valido o scaduto.'); }
    }
    return;
  }
  if (ev.type === 'message' && ev.from && ev.ciphertext) {
    try {
      const outer = JSON.parse(ev.ciphertext);
      const gid = ev.gid;

      // (1) Distribuzione Sender Key di gruppo (canale pairwise) — registra la chain del mittente.
      if (gid && outer.gskd) {
        try {
          const distPlain = await iimsg.crypto.decrypt(ev.from, outer.gskd.ciphertext);
          const dist = JSON.parse(distPlain);
          // ANTI-POISONING: accetta solo se il mittente dichiarato (sid) coincide con args.from.
          if (dist && dist.sid === ev.from && typeof dist.e === 'number' && typeof dist.ck === 'string' && typeof dist.spk === 'string') {
            await iimsg.senderKeys.processDistribution(gid, dist);
          }
        } catch {}
        return;
      }

      // (2) Messaggio di gruppo cifrato con Sender Key.
      if (gid && outer.gsk) {
        const gk = outer.gsk;
        const validGsk = gk && typeof gk.sid === 'string' && typeof gk.e === 'number' && typeof gk.i === 'number'
          && typeof gk.n === 'string' && typeof gk.c === 'string' && typeof gk.s === 'string';
        if (!validGsk) return;
        let plain;
        try { plain = await iimsg.senderKeys.decryptGroup(gid, gk); } catch (e) { console.error('group decrypt', e); return; }
        const envelope = decodeEnvelope(plain);
        if (!state.groups[gid]) state.groups[gid] = { id: gid, name: envelope.gname || ('Gruppo ' + gid.slice(0, 6)), epoch: ev.epoch || 0, memberIds: [], messages: [] };
        else if (envelope.gname && (!state.groups[gid].name || state.groups[gid].name.startsWith('Gruppo '))) state.groups[gid].name = envelope.gname;
        state.groups[gid].messages.push({
          id: envelope.clientMsgId ?? ev.messageId ?? (Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
          mine: false, from: ev.from, kind: envelope.kind, body: envelope.body ?? '', replyTo: envelope.replyTo, media: envelope.media,
          ts: Date.now(), status: 'delivered', expiresAt: envelope.ttlMs ? Date.now() + envelope.ttlMs : undefined,
        });
        persistGroups(); render();
        // Se sto guardando questo gruppo, invia subito le conferme di lettura (spunte blu).
        if (state.activeGroup === gid) sendGroupReadReceipts(gid);
        return;
      }

      const payload = outer.payload ?? outer;
      // Record peer trust (unverified here — mobile did attestation signature check).
      if (outer.attestation) {
        state.peerTrust[ev.from] = {
          level: outer.attestation.state || 'unknown',
          score: outer.attestation.healthScore ?? 0,
          ts: Date.now(),
        };
      }
      if (!state.chats[ev.from]) {
        state.chats[ev.from] = { peerId: ev.from, peerName: ev.from.slice(0, 8), messages: [] };
        try {
          const bundle = await iimsg.api.getUserKeys(ev.from);
          await iimsg.crypto.buildSession(ev.from, bundle);
        } catch {}
      }
      const plain = await iimsg.crypto.decrypt(ev.from, payload.ciphertext);
      const envelope = decodeEnvelope(plain);

      // Reaction update — patch target message in place, don't add a row.
      if (envelope.kind === 'reaction' && envelope.reactTarget) {
        const convo = state.chats[ev.from];
        const target = convo.messages.find((m) => m.id === envelope.reactTarget.id);
        if (target) {
          target.reactions = target.reactions || {};
          // one reaction per user
          for (const k of Object.keys(target.reactions)) {
            target.reactions[k] = (target.reactions[k] || []).filter((u) => u !== ev.from);
            if (target.reactions[k].length === 0) delete target.reactions[k];
          }
          if (!envelope.reactTarget.remove) {
            const e = envelope.reactTarget.emoji;
            target.reactions[e] = target.reactions[e] || [];
            if (!target.reactions[e].includes(ev.from)) target.reactions[e].push(ev.from);
          }
        }
        render();
        return;
      }

      // Stories: surface as a badge on the sidebar (MVP — no fullscreen viewer on desktop yet)
      if (envelope.storyId) {
        // Silently accept; a future version shows a story rail.
        render();
        return;
      }

      const msg = {
        id: envelope.clientMsgId ?? ev.messageId ?? (Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
        mine: false,
        kind: envelope.kind,
        body: envelope.body ?? '',
        replyTo: envelope.replyTo,
        media: envelope.media,
        ts: Date.now(),
        status: 'delivered',
        expiresAt: envelope.ttlMs ? Date.now() + envelope.ttlMs : undefined,
      };
      state.chats[ev.from].messages.push(msg);
      render();
    } catch (e) { console.error('decrypt error', e); }
  }
});

// Periodic sweep for disappearing messages — every 30s drop anything past TTL.
setInterval(() => {
  const now = Date.now();
  let dirty = false;
  for (const cid of Object.keys(state.chats)) {
    const c = state.chats[cid];
    const before = c.messages.length;
    c.messages = c.messages.filter((m) => !m.expiresAt || m.expiresAt > now);
    if (c.messages.length !== before) dirty = true;
  }
  if (dirty) render();
}, 30_000);

(async () => {
  try {
    const s = await iimsg.api.session();
    if (s && s.username) {
      state.authed = true;
      state.me.userId = s.userId;
      state.me.username = s.username;
      state.me.fingerprint = s.fingerprint;
      try {
        const node = await iimsg.api.myNode();
        await iimsg.socket.connect(node.relayUrl, 'in-main-process');
      } catch {}
      await loadGroups();
    }
  } catch {}
  render();
})();
