import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { theme } from '@utils/theme';

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  style?: ViewStyle;
  disabled?: boolean;
};

export const Button: React.FC<Props> = ({ title, onPress, loading, variant = 'primary', style, disabled }) => {
  const isPrimary = variant === 'primary';
  const isDanger  = variant === 'danger';
  const isGhost   = variant === 'ghost';

  const bg      = isPrimary ? theme.accent : isDanger ? theme.alert : 'transparent';
  const fg      = isGhost ? theme.accent : theme.bg;
  const border  = isGhost ? theme.accent : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      android_ripple={isGhost ? undefined : { color: 'rgba(255,255,255,0.14)' }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, borderWidth: isGhost ? 1 : 0 },
        isPrimary && theme.shadow.glow,
        disabled && { opacity: 0.4 },
        pressed && !isGhost && { opacity: 0.92 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.label, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 14, paddingHorizontal: 22,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: theme.radius,
  },
  label: { fontSize: 14, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
});
