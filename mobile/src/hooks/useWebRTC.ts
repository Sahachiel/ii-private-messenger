import { useEffect, useRef } from 'react';
import { MediaStream } from 'react-native-webrtc';
import { webrtc } from '@services/webrtc';
import { socket } from '@services/socket';
import { useAppDispatch, useAppSelector } from '@store/index';
import { setStatus, setConnectionQuality, tickDuration, endCall } from '@store/callSlice';
import { CallType } from '../types';

export function useWebRTC(peerId: string | null, callType: CallType, opts: { isCaller: boolean; remoteSDPInitial?: any; callId: string } = { isCaller: true, callId: '' }): {
  localStream: MediaStream | null; remoteStream: MediaStream | null;
} {
  const dispatch = useAppDispatch();
  const turn = useAppSelector((s) => s.auth.turnConfig);
  const iceCandidates = useAppSelector((s) => s.call.iceCandidates);
  const remoteSDP = useAppSelector((s) => s.call.remoteSDP);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const durationTimer = useRef<any>(null);
  const callId = opts.callId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  useEffect(() => {
    if (!peerId || !turn) return;
    let cancelled = false;

    (async () => {
      webrtc.onRemoteStream = (s) => { remoteRef.current = s; };
      webrtc.onIceCandidate = (c) => socket.send({ type: 'ice_candidate', callId, to: peerId, candidate: c });
      // Qualità REALE dal loop getStats (loss/jitter/rtt), non più un valore fisso.
      webrtc.onQuality = (q) => dispatch(setConnectionQuality(q));
      webrtc.onConnectionStateChange = (state) => {
        if (state === 'connected') {
          dispatch(setStatus('connected'));
          dispatch(setConnectionQuality('good'));
          durationTimer.current = setInterval(() => dispatch(tickDuration()), 1000);
        } else if (state === 'disconnected' || state === 'failed') {
          dispatch(setStatus('reconnecting'));
          dispatch(setConnectionQuality('poor'));
        }
      };

      await webrtc.initialize(turn, callType);
      if (cancelled) return;
      localRef.current = webrtc.localStream;

      if (opts.isCaller) {
        const offer = await webrtc.createOffer();
        socket.send({ type: 'call_offer', callId, to: peerId, sdp: JSON.stringify(offer), callType });
        dispatch(setStatus('dialing'));
      } else if (opts.remoteSDPInitial) {
        const answer = await webrtc.handleOffer(opts.remoteSDPInitial);
        socket.send({ type: 'call_answer', callId, to: peerId, sdp: JSON.stringify(answer) });
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(durationTimer.current);
      webrtc.hangup();
    };
  }, [peerId, turn, callType, dispatch, opts.isCaller, opts.remoteSDPInitial]);

  useEffect(() => {
    if (!remoteSDP || !opts.isCaller) return;
    webrtc.handleAnswer(remoteSDP).catch(() => dispatch(endCall()));
  }, [remoteSDP, opts.isCaller, dispatch]);

  useEffect(() => {
    if (!iceCandidates.length) return;
    const last = iceCandidates[iceCandidates.length - 1];
    webrtc.addIceCandidate(last).catch(() => {});
  }, [iceCandidates]);

  return { localStream: localRef.current, remoteStream: remoteRef.current };
}

export function sendCallEnd(callId: string, peerId: string, reason: string = 'hangup'): void {
  socket.send({ type: 'call_end', callId, to: peerId, reason });
}
