import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing, PermissionsAndroid, Platform, Alert } from 'react-native';
import { MicIcon, TrashIcon, SendIcon } from './Icons';
import { voice, MAX_VOICE_MS } from '../services/voice';
import { MediaRef } from '../types';
import { theme } from '../utils/theme';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

interface Props {
  onSend: (m: MediaRef) => void;
}

// Hold-to-record mic button. Releasing sends; swipe-up + release cancels.
// On recording start, we render a slide-to-cancel hint and a live timer.
export const VoiceRecorder: React.FC<Props> = ({ onSend }) => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (recording) {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      l.start();
      return () => l.stop();
    }
    return undefined;
  }, [recording, pulse]);

  const start = async (): Promise<void> => {
    const ok = await ensureMicPermission();
    if (!ok) { Alert.alert('Permesso microfono negato', 'Consenti il microfono nelle impostazioni per registrare vocali.'); return; }
    ReactNativeHapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
    try {
      setRecording(true);
      await voice.startRecord((ms) => setElapsed(ms));
    } catch (e) {
      setRecording(false);
      setElapsed(0);
      Alert.alert('Microfono non disponibile', (e as Error)?.message ?? 'Impossibile avviare la registrazione.');
    }
  };

  const commit = async (): Promise<void> => {
    if (!recording) return;
    setRecording(false);
    const m = await voice.stopRecord();
    if (m) onSend({ ...m, durationMs: Math.min(elapsed, MAX_VOICE_MS) });
    setElapsed(0);
  };

  const cancel = async (): Promise<void> => {
    if (!recording) return;
    setRecording(false);
    await voice.cancelRecord();
    setElapsed(0);
  };

  if (!recording) {
    return (
      <Pressable onPress={start} onLongPress={start} delayLongPress={180} style={styles.micBtn} hitSlop={10}>
        <MicIcon size={22} color={theme.text} />
      </Pressable>
    );
  }

  const secs = Math.floor(elapsed / 1000);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]} />
      <Text style={styles.time}>{time}</Text>
      <Text style={styles.hint}>Tocca ➤ per inviare · 🗑 per annullare</Text>
      <Pressable onPress={cancel} style={[styles.act, { backgroundColor: theme.alert }]}>
        <TrashIcon size={16} color="#fff" />
      </Pressable>
      <Pressable onPress={commit} style={[styles.act, { backgroundColor: theme.accent }]}>
        <SendIcon size={16} color={theme.bg} />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  micBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 6, flex: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.alert },
  time: { color: theme.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 44 },
  hint: { color: theme.textDim, fontSize: 11, flex: 1 },
  act: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
