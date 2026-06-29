import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ActiveCall, CallStatus } from '../types';

export interface CallState {
  activeCall: ActiveCall | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  callDuration: number;
  remoteSDP: any | null;
  iceCandidates: any[];
  connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown';
}

const initial: CallState = {
  activeCall: null, isMuted: false, isVideoEnabled: true, callDuration: 0,
  remoteSDP: null, iceCandidates: [], connectionQuality: 'unknown',
};

const slice = createSlice({
  name: 'call',
  initialState: initial,
  reducers: {
    initiateCall(state, a: PayloadAction<ActiveCall>) {
      state.activeCall = { ...a.payload, status: 'dialing', isOutgoing: true };
      state.isMuted = false;
      state.isVideoEnabled = a.payload.type === 'video';
      state.callDuration = 0;
      state.iceCandidates = [];
      state.remoteSDP = null;
    },
    receiveCall(state, a: PayloadAction<{ call: ActiveCall; sdp: any }>) {
      state.activeCall = { ...a.payload.call, status: 'ringing', isOutgoing: false };
      state.remoteSDP = a.payload.sdp;
      state.isMuted = false;
      state.isVideoEnabled = a.payload.call.type === 'video';
    },
    answerCall(state) {
      if (state.activeCall) {
        state.activeCall.status = 'connected';
        state.activeCall.startedAt = Date.now();
      }
    },
    setStatus(state, a: PayloadAction<CallStatus>) {
      if (state.activeCall) state.activeCall.status = a.payload;
    },
    tickDuration(state) {
      if (state.activeCall?.status === 'connected') state.callDuration += 1;
    },
    toggleMute(state) { state.isMuted = !state.isMuted; },
    toggleVideo(state) { state.isVideoEnabled = !state.isVideoEnabled; },
    setConnectionQuality(state, a: PayloadAction<CallState['connectionQuality']>) { state.connectionQuality = a.payload; },
    addIceCandidate(state, a: PayloadAction<any>) { state.iceCandidates.push(a.payload); },
    setRemoteSDP(state, a: PayloadAction<any>) { state.remoteSDP = a.payload; },
    endCall() { return { ...initial }; },
  },
});

export const {
  initiateCall, receiveCall, answerCall, setStatus, tickDuration,
  toggleMute, toggleVideo, setConnectionQuality, addIceCandidate, setRemoteSDP, endCall,
} = slice.actions;
export default slice.reducer;
