import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { PlayIcon, PauseIcon } from './Icons';
import { voice } from '../services/voice';
import { mediaDataUri } from '../services/media';
import { MediaRef } from '../types';
import { theme } from '../utils/theme';

// Inline waveform — deterministic pseudo-random bars seeded on message id so
// every render for the same message shows the same bars. Real waveform analysis
// is deferred to v0.3 (would require native DSP hook per-clip).
const BAR_COUNT = 28;
function waveformBars(seed: string): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (h * 16777619) ^ seed.charCodeAt(i % seed.length) ^ i;
    const v = Math.abs(h) % 100;
    out.push(0.25 + (v / 100) * 0.75);
  }
  return out;
}

export const VoicePlayer: React.FC<{ media: MediaRef; messageId: string; mine?: boolean }> = ({ media, messageId, mine }) => {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(media.durationMs ?? 0);
  const bars = useRef(waveformBars(messageId)).current;
  const uri = useRef(mediaDataUri(media)).current;

  const toggle = async (): Promise<void> => {
    if (playing) {
      await voice.stopPlay();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    await voice.play(uri, (p, d) => { setPos(p); if (d) setDur(d); }, () => { setPlaying(false); setPos(0); });
  };

  const progress = dur > 0 ? pos / dur : 0;
  const activeColor = mine ? 'rgba(255,255,255,0.95)' : theme.accentAlt;
  const inactiveColor = mine ? 'rgba(255,255,255,0.35)' : theme.border;
  const secs = Math.floor((dur > 0 ? (playing ? (dur - pos) : dur) : 0) / 1000);
  const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <View style={styles.c}>
      <Pressable onPress={toggle} style={[styles.btn, { backgroundColor: mine ? 'rgba(255,255,255,0.2)' : theme.accent }]}>
        {playing ? <PauseIcon size={16} color={mine ? '#fff' : theme.bg} /> : <PlayIcon size={16} color={mine ? '#fff' : theme.bg} />}
      </Pressable>
      <View style={styles.waveform}>
        {bars.map((h, i) => (
          <View
            key={i}
            style={{
              width: 2.5,
              height: 20 * h,
              borderRadius: 1.5,
              backgroundColor: i / BAR_COUNT < progress ? activeColor : inactiveColor,
            }}
          />
        ))}
      </View>
      <Text style={[styles.time, { color: mine ? 'rgba(255,255,255,0.75)' : theme.textDim }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  c: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2, minWidth: 200 },
  btn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1, height: 22 },
  time: { fontSize: 11, fontVariant: ['tabular-nums'], minWidth: 36, textAlign: 'right' },
});
