import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { Avatar } from '@components/Avatar';
import { CallControls } from '@components/CallControls';
import { useAppDispatch, useAppSelector } from '@store/index';
import { toggleMute, endCall, setStatus } from '@store/callSlice';
import { useWebRTC } from '@hooks/useWebRTC';
import { socket } from '@services/socket';
import { webrtc } from '@services/webrtc';
import { setSpeaker } from '@services/audioRoute';
import { theme } from '@utils/theme';
import { COUNTRY_LIST } from '@utils/countries';

export const CallScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const { peerId, peerName } = route.params;
  const dispatch = useAppDispatch();
  const call = useAppSelector((s) => s.call);
  const region = useAppSelector((s) => s.auth.region);
  const regionEntry = COUNTRY_LIST.find((c) => c.region === region);

  const callId = React.useMemo(() => `${peerId}-${Date.now()}`, [peerId]);
  useWebRTC(peerId, 'voice', { isCaller: call.activeCall?.isOutgoing !== false, remoteSDPInitial: call.activeCall?.isOutgoing === false ? call.remoteSDP : undefined, callId });

  useEffect(() => {
    if (!call.activeCall) navigation.goBack();
    if (call.activeCall?.status === 'ended') navigation.goBack();
  }, [call.activeCall, navigation]);

  const onEnd = () => {
    socket.send({ type: 'call_end', callId, to: peerId, reason: 'hangup' });
    webrtc.hangup();
    dispatch(setStatus('ended'));
    dispatch(endCall());
    navigation.goBack();
  };
  const onMute = () => { dispatch(toggleMute()); webrtc.setMuted(!call.isMuted); };
  const [speakerOn, setSpeakerOn] = useState(false);
  const onSpeaker = () => { const next = !speakerOn; setSpeakerOn(next); void setSpeaker(next); };
  // Al termine della chiamata riporta l'audio all'auricolare.
  useEffect(() => () => { void setSpeaker(false); }, []);

  const mm = String(Math.floor(call.callDuration / 60)).padStart(2, '0');
  const ss = String(call.callDuration % 60).padStart(2, '0');

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.regionBadge}>
        <Text style={styles.regionText}>ROUTED VIA {regionEntry?.flag} {region?.toUpperCase()} — ENCRYPTED</Text>
      </View>

      <View style={styles.center}>
        <View style={styles.pulseRing}><Avatar name={peerName} size={140} /></View>
        <Text style={styles.name}>{peerName}</Text>
        <Text style={styles.status}>
          {call.activeCall?.status === 'dialing' && 'CALLING…'}
          {call.activeCall?.status === 'ringing' && 'RINGING…'}
          {call.activeCall?.status === 'connected' && `${mm}:${ss}`}
          {call.activeCall?.status === 'reconnecting' && 'RECONNECTING…'}
        </Text>
      </View>

      <CallControls
        isMuted={call.isMuted}
        isVideo={false}
        isVideoEnabled={false}
        onToggleMute={onMute}
        onSpeaker={onSpeaker}
        isSpeakerOn={speakerOn}
        onEnd={onEnd}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg, justifyContent: 'space-between' },
  regionBadge: { alignSelf: 'center', marginTop: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: theme.accent },
  regionText: { color: theme.accent, fontSize: 10, letterSpacing: 2, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  pulseRing: { padding: 20, borderWidth: 2, borderColor: theme.accent, borderRadius: 200 },
  name: { color: theme.text, fontSize: 26, fontWeight: '900', letterSpacing: 2 },
  status: { color: theme.accent, fontSize: 16, letterSpacing: 2, fontFamily: theme.font.mono },
});
