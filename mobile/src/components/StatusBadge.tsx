import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '@utils/theme';

export type Status = 'online' | 'away' | 'offline' | 'connecting';

export const StatusBadge: React.FC<{ status: Status; size?: number }> = ({ status, size = 10 }) => {
  const color = status === 'online' ? theme.success
    : status === 'away' ? theme.warning
    : status === 'connecting' ? theme.accent
    : theme.textMute;
  return <View style={[styles.dot, { width: size, height: size, backgroundColor: color }]} />;
};

const styles = StyleSheet.create({ dot: { borderWidth: 1, borderColor: theme.bg } });
