import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme, WALLPAPERS } from '@utils/theme';
import LinearGradient from 'react-native-linear-gradient';
import { TrashIcon, ClockIcon } from './Icons';

interface Props {
  currentWallpaperId?: string;
  onPickWallpaper: (id: string) => void;
  onSetTimer: (ms?: number) => void;
  onClear: () => void;
  onClose: () => void;
}

const TIMER_PRESETS: Array<[string, number | undefined]> = [
  ['Off',  undefined],
  ['1 h',   3_600_000],
  ['24 h', 86_400_000],
  ['7 d',  604_800_000],
  ['30 d', 2_592_000_000],
];

export const ChatHeaderMenu: React.FC<Props> = (p) => {
  return (
    <View style={styles.c}>
      <Text style={styles.section}>WALLPAPER</Text>
      <View style={styles.wallRow}>
        {WALLPAPERS.map((w) => (
          <Pressable key={w.id} onPress={() => p.onPickWallpaper(w.id)} style={[styles.wallTile, p.currentWallpaperId === w.id && styles.wallTileActive]}>
            <LinearGradient colors={w.colors} style={styles.wallGradient} />
            <Text style={styles.wallLabel}>{w.name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>DISAPPEARING</Text>
      <View style={styles.timerRow}>
        {TIMER_PRESETS.map(([label, ms]) => (
          <Pressable key={label} onPress={() => p.onSetTimer(ms)} style={styles.timerChip}>
            <ClockIcon size={12} color={theme.accent} />
            <Text style={styles.timerLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={p.onClear} style={styles.dangerRow}>
        <TrashIcon size={18} color={theme.alert} />
        <Text style={styles.dangerLabel}>Clear chat history (local)</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  c: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  section: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '900', marginTop: 12, marginBottom: 10 },

  wallRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  wallTile: {
    width: 70, alignItems: 'center',
    borderRadius: 10, borderWidth: 2, borderColor: 'transparent',
    overflow: 'hidden', paddingBottom: 4,
  },
  wallTileActive: { borderColor: theme.accent },
  wallGradient: { width: 70, height: 56 },
  wallLabel: { color: theme.text, fontSize: 10, marginTop: 4 },

  timerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  timerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border,
  },
  timerLabel: { color: theme.text, fontSize: 12, fontWeight: '600' },

  dangerRow: {
    marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,75,110,0.08)', borderRadius: 10,
  },
  dangerLabel: { color: theme.alert, fontSize: 13, fontWeight: '700' },
});
