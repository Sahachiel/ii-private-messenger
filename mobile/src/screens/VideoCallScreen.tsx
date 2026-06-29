import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder, Animated } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { CallControls } from '@components/CallControls';
import { useAppDispatch, useAppSelector } from '@store/index';
import { toggleMute, toggleVideo, endCall, setStatus } from '@store/callSlice';
import { useWebRTC } from '@hooks/useWebRTC';
import { socket } from '@services/socket';
import { webrtc } from '@services/webrtc';
import { theme } from '@utils/theme';

export const VideoCallScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const { peerId, peerName } = route.params;
  const dispatch = useAppDispatch();
  const call = useAppSelector((s) => s.call);

  const callId = React.useMemo(() => `${peerId}-${Date.now()}`, [peerId]);
  const { localStream, remoteStream } = useWebRTC(peerId, 'video', {
    isCaller: call.activeCall?.isOutgoing !== false,
    remoteSDPInitial: call.activeCall?.isOutgoing === false ? call.remoteSDP : undefined,
    callId,
  });

  const [controls, setControls] = useState(true);
  const hideTimer = useRef<any>(null);
  const pos = useRef(new Animated.ValueXY({ x: 20, y: 60 })).current;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => pos.extractOffset(),
  })).current;

  useEffect(() => {
    hideTimer.current = setTimeout(() => setControls(false), 3000);
    return () => clearTimeout(hideTimer.current);
  }, [controls]);

  useEffect(() => { if (!call.activeCall || call.activeCall.status === 'ended') navigation.goBack(); }, [call.activeCall, navigation]);

  const onEnd = () => {
    socket.send({ type: 'call_end', callId, to: peerId, reason: 'hangup' });
    webrtc.hangup();
    dispatch(setStatus('ended'));
    dispatch(endCall());
    navigation.goBack();
  };

  const quality = call.connectionQuality;
  const qColor = quality === 'excellent' ? theme.success : quality === 'good' ? theme.warning : quality === 'poor' ? theme.alert : theme.textDim;

  return (
    <Pressable style={styles.root} onPress={() => setControls(true)}>
      {remoteStream ? (
        <RTCView streamURL={(remoteStream as any).toURL()} style={styles.remote} objectFit="cover" />
      ) : (
        <View style={styles.remoteFallback}><Text style={styles.waiting}>{peerName}</Text></View>
      )}

      {localStream && (
        <Animated.View style={[styles.localWrap, { transform: pos.getTranslateTransform() }]} {...pan.panHandlers}>
          <RTCView streamURL={(localStream as any).toURL()} style={styles.local} objectFit="cover" mirror />
        </Animated.View>
      )}

      {controls && (
        <>
          <View style={styles.topBar}>
            <Text style={styles.peer}>{peerName}</Text>
            <View style={[styles.qualityDot, { backgroundColor: qColor }]} />
          </View>
          <View style={styles.bottom}>
            <CallControls
              isMuted={call.isMuted}
              isVideo
              isVideoEnabled={call.isVideoEnabled}
              onToggleMute={() => { dispatch(toggleMute()); webrtc.setMuted(!call.isMuted); }}
              onToggleVideo={() => { dispatch(toggleVideo()); webrtc.setVideoEnabled(!call.isVideoEnabled); }}
              onSwitchCamera={() => webrtc.switchCamera()}
              onEnd={onEnd}
            />
          </View>
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  remote: { ...StyleSheet.absoluteFillObject },
  remoteFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  waiting: { color: theme.textDim, fontSize: 18, letterSpacing: 2 },
  localWrap: { position: 'absolute', width: 120, height: 160, borderWidth: 1, borderColor: theme.accent },
  local: { flex: 1 },
  topBar: { position: 'absolute', top: 40, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  peer: { color: theme.text, fontSize: 18, fontWeight: '900', letterSpacing: 2, textShadowColor: '#000', textShadowRadius: 4 },
  qualityDot: { width: 12, height: 12 },
  bottom: { position: 'absolute', bottom: 20, left: 0, right: 0 },
});
