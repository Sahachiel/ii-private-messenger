import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrustLevel } from '../types';
import { theme } from '../utils/theme';
import { ShieldIcon } from './Icons';

const META: Record<TrustLevel, { color: string; label: string; bg: string }> = {
  secure:      { color: theme.success,  label: 'SECURE',   bg: 'rgba(40,208,137,0.12)' },
  warning:     { color: theme.warning,  label: 'WARN',     bg: 'rgba(255,186,76,0.14)' },
  compromised: { color: theme.alert,    label: 'COMP',     bg: 'rgba(255,75,110,0.15)' },
  unknown:     { color: theme.textDim,  label: '—',        bg: 'rgba(138,149,170,0.08)' },
};

export const TrustBadge: React.FC<{ level: TrustLevel; compact?: boolean; score?: number }> = ({ level, compact, score }) => {
  const m = META[level];
  if (compact) {
    return (
      <View style={[styles.dot, { backgroundColor: m.color }]} />
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }]}>
      <ShieldIcon size={10} color={m.color} strokeWidth={2.4} />
      <Text style={[styles.label, { color: m.color }]}>
        {m.label}{typeof score === 'number' ? ` · ${score}` : ''}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
  },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
