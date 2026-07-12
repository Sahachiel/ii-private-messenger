/* eslint-env browser */
/* global window, document, iimsg, RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, navigator */

// Chiamate 1:1 WebRTC per il desktop (Electron/Chromium ha WebRTC nativo).
// Segnalazione via relay, identica al mobile:
//   OUT: {type:'call_offer', callId, to, sdp, callType} / {type:'call_answer', callId, to, sdp}
//        {type:'ice_candidate', callId, to, candidate} / {type:'call_end', callId, to, reason}
//   IN : call_offer(ev.from, ev.callType, ev.sdp, ev.callId) / call_answer(ev.sdp) /
//        ice_candidate(ev.candidate) / call_end
(function () {
  let turnCfg = null;
  let pc = null;
  let localStream = null;
  let call = null;        // { callId, peerId, peerName, callType, isOutgoing, pendingOffer }
  let pendingIce = [];
  let durTimer = null;
  let startedAt = 0;

  async function getTurn() {
    if (turnCfg) return turnCfg;
    try { const node = await iimsg.api.myNode(); turnCfg = node && node.turnConfig ? node.turnConfig : null; } catch {}
    return turnCfg;
  }

  function iceServers(t) {
    const s = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (t && t.urls) {
      const urls = Array.isArray(t.urls) ? t.urls : [t.urls];
      if (urls.filter(Boolean).length) s.push({ urls: urls.filter(Boolean), username: t.username || '', credential: t.credential || '' });
    }
    return s;
  }

  function newPeer(t) {
    const p = new RTCPeerConnection({ iceServers: iceServers(t) });
    p.onicecandidate = (e) => {
      if (e.candidate && call) {
        const cand = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
        iimsg.socket.send({ type: 'ice_candidate', callId: call.callId, to: call.peerId, candidate: cand });
      }
    };
    p.ontrack = (e) => {
      const rv = document.getElementById('call-remote');
      if (rv && e.streams && e.streams[0]) rv.srcObject = e.streams[0];
    };
    p.onconnectionstatechange = () => {
      if (!p) return;
      if (p.connectionState === 'connected') onConnected();
      else if (p.connectionState === 'failed') setStatus('Connessione fallita');
      else if (p.connectionState === 'disconnected') setStatus('Riconnessione…');
    };
    return p;
  }

  async function ensureMedia(video) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!video });
    const lv = document.getElementById('call-local');
    if (lv) { lv.srcObject = localStream; lv.muted = true; }
    return localStream;
  }

  function onConnected() {
    setStatus('In chiamata');
    setMode('incall');
    if (!durTimer) {
      startedAt = Date.now();
      durTimer = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        const t = document.getElementById('call-timer');
        if (t) t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      }, 1000);
    }
  }

  // ---------- outgoing ----------
  async function start(peerId, peerName, video) {
    if (call) return;
    const t = await getTurn();
    const callId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    call = { callId, peerId, peerName: peerName || String(peerId).slice(0, 8), callType: video ? 'video' : 'audio', isOutgoing: true };
    showOverlay(); setMode('calling'); setStatus('Chiamata in corso…');
    try {
      pc = newPeer(t);
      await ensureMedia(video);
      localStream.getTracks().forEach((tr) => pc.addTrack(tr, localStream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      iimsg.socket.send({ type: 'call_offer', callId, to: peerId, sdp: JSON.stringify(offer), callType: call.callType });
    } catch (e) { setStatus('Errore microfono/camera'); setTimeout(() => hangup(true), 1500); }
  }

  // ---------- incoming ----------
  async function onOffer(ev) {
    if (call) { iimsg.socket.send({ type: 'call_end', callId: ev.callId, to: ev.from, reason: 'busy' }); return; }
    let sdp; try { sdp = JSON.parse(ev.sdp); } catch { sdp = ev.sdp; }
    call = { callId: ev.callId, peerId: ev.from, peerName: String(ev.from).slice(0, 8), callType: ev.callType || 'audio', isOutgoing: false, pendingOffer: sdp };
    showOverlay(); setMode('incoming');
    setStatus((call.callType === 'video' ? 'Videochiamata' : 'Chiamata') + ' in arrivo…');
  }

  async function accept() {
    if (!call || call.isOutgoing) return;
    const t = await getTurn();
    setMode('incall'); setStatus('Connessione…');
    try {
      pc = newPeer(t);
      await ensureMedia(call.callType === 'video');
      localStream.getTracks().forEach((tr) => pc.addTrack(tr, localStream));
      await pc.setRemoteDescription(new RTCSessionDescription(call.pendingOffer));
      for (const c of pendingIce) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
      pendingIce = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      iimsg.socket.send({ type: 'call_answer', callId: call.callId, to: call.peerId, sdp: JSON.stringify(answer) });
    } catch (e) { setStatus('Errore microfono/camera'); setTimeout(() => hangup(true), 1500); }
  }

  async function onAnswer(ev) {
    if (!call || !pc) return;
    let sdp; try { sdp = JSON.parse(ev.sdp); } catch { sdp = ev.sdp; }
    try { await pc.setRemoteDescription(new RTCSessionDescription(sdp)); setStatus('Connessione…'); } catch {}
  }

  async function onIce(ev) {
    if (!ev.candidate) return;
    if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(new RTCIceCandidate(ev.candidate)); } catch {} }
    else pendingIce.push(ev.candidate);
  }

  function hangup(sendEnd) {
    if (call && sendEnd) iimsg.socket.send({ type: 'call_end', callId: call.callId, to: call.peerId, reason: 'hangup' });
    if (durTimer) { clearInterval(durTimer); durTimer = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    call = null; pendingIce = [];
    hideOverlay();
  }

  function toggleMute() {
    if (!localStream) return;
    const a = localStream.getAudioTracks()[0]; if (!a) return;
    a.enabled = !a.enabled;
    const b = document.getElementById('call-mute'); if (b) b.textContent = a.enabled ? '🎙️' : '🔇';
  }
  function toggleCam() {
    if (!localStream) return;
    const v = localStream.getVideoTracks()[0]; if (!v) return;
    v.enabled = !v.enabled;
    const b = document.getElementById('call-cam'); if (b) b.textContent = v.enabled ? '📹' : '📵';
  }

  // ---------- UI overlay ----------
  function showOverlay() {
    if (document.getElementById('call-overlay')) return;
    const o = document.createElement('div');
    o.id = 'call-overlay';
    o.innerHTML =
      '<div class="call-box">' +
      '  <video id="call-remote" autoplay playsinline></video>' +
      '  <video id="call-local" autoplay playsinline muted></video>' +
      '  <div class="call-info"><div id="call-peer" class="call-peer"></div>' +
      '     <div id="call-status" class="call-status"></div><div id="call-timer" class="call-timer"></div></div>' +
      '  <div id="call-controls" class="call-controls"></div>' +
      '</div>';
    document.body.appendChild(o);
    document.getElementById('call-peer').textContent = call ? call.peerName : '';
  }
  function hideOverlay() { const o = document.getElementById('call-overlay'); if (o) o.remove(); }
  function setStatus(s) { const e = document.getElementById('call-status'); if (e) e.textContent = s; }
  function setMode(mode) {
    const c = document.getElementById('call-controls'); if (!c) return;
    c.innerHTML = '';
    const btn = (id, label, cls, fn) => { const b = document.createElement('button'); b.id = id; b.className = 'call-btn ' + (cls || ''); b.textContent = label; b.onclick = fn; return b; };
    if (mode === 'incoming') {
      c.appendChild(btn('call-accept', '✅ Accetta', 'accept', accept));
      c.appendChild(btn('call-reject', '⛔ Rifiuta', 'reject', () => hangup(true)));
    } else {
      c.appendChild(btn('call-mute', '🎙️', 'ctl', toggleMute));
      if (call && call.callType === 'video') c.appendChild(btn('call-cam', '📹', 'ctl', toggleCam));
      c.appendChild(btn('call-hangup', '📞 Chiudi', 'reject', () => hangup(true)));
    }
  }

  // ---------- socket ----------
  iimsg.socket.onMessage((ev) => {
    if (!ev || typeof ev !== 'object') return;
    switch (ev.type) {
      case 'call_offer': onOffer(ev); break;
      case 'call_answer': onAnswer(ev); break;
      case 'ice_candidate': onIce(ev); break;
      case 'call_end': hangup(false); break;
    }
  });

  window.iimsgCall = { start: start, accept: accept, hangup: () => hangup(true) };
})();
