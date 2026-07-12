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

function render() {
  const app = $('#app');
  app.innerHTML = '';
  const root = el('div', { class: 'col main' });
  const titlebar = el('div', { class: 'titlebar' }, [
    el('span', { class: 'brand' }, 'II PRIVATE MESSENGER'),
    state.authed ? el('div', { class: 'titlebar-actions' }, [
      el('button', { class: 'icon-btn', onClick: () => { state.view = state.view === 'pairing' ? 'chat' : 'pairing'; render(); } }, state.view === 'pairing' ? 'CHAT' : 'LINK PHONE'),
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
  const searchBox = el('div', { class: 'search-box' });
  const searchInput = el('input', {
    placeholder: 'Search username…',
    onInput: async (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) { state.users = []; renderResults(); return; }
      try { state.users = await iimsg.api.searchUsers(q); renderResults(); } catch {}
    },
  });
  searchBox.appendChild(searchInput);
  side.appendChild(searchBox);

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
          state.replyTo = null;
          if (!state.chats[u.id]) {
            state.chats[u.id] = { peerId: u.id, peerName: u.display_name ?? u.username, messages: [] };
            try {
              const bundle = await iimsg.api.getUserKeys(u.id);
              await iimsg.crypto.buildSession(u.id, bundle.identityPublicKey);
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
  const chat = el('div', { class: 'chat' });
  const peerId = state.activeChat;
  if (!peerId) { chat.appendChild(el('div', { class: 'empty' }, 'Select a contact to chat')); return chat; }
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
  wrap.appendChild(el('h1', {}, 'LINK A MOBILE DEVICE'));
  const card = el('div', { class: 'pairing-card' });
  const qrHolder = el('div', { id: 'qr-holder', class: 'qr-holder' });
  card.appendChild(qrHolder);
  const user = el('div', { class: 'pairing-user' }, '@' + (state.me.username ?? ''));
  const fp = el('div', { class: 'pairing-fp' }, 'FP · ' + ((state.me.fingerprint ?? '').slice(0, 24) || '(no identity)'));
  card.appendChild(user);
  card.appendChild(fp);
  const hint = el('div', { class: 'pairing-hint' }, 'On your phone: Profile → Link a desktop → Scan. Nonce rotates every 2 min.');
  card.appendChild(hint);
  const refresh = el('button', { class: 'ghost', onClick: () => drawQR() }, 'ROTATE NONCE');
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

// Socket incoming message handler — decodes v2 envelope
iimsg.socket.onMessage(async (ev) => {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'message' && ev.from && ev.ciphertext) {
    try {
      const outer = JSON.parse(ev.ciphertext);
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
          await iimsg.crypto.buildSession(ev.from, bundle.identityPublicKey);
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
    }
  } catch {}
  render();
})();
