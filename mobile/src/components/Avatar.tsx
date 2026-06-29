import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { theme } from '@utils/theme';

export const Avatar: React.FC<{ name: string; url?: string; size?: number }> = ({ name, url, size = 44 }) => {
  const letter = (name || '?')[0]?.toUpperCase() ?? '?';
  const style = { width: size, height: size };
  if (url) return <Image source={{ uri: url }} style={[styles.img, style]} />;
  return (
    <View style={[styles.circle, style]}>
      <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{letter}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  circle: { backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  img: { backgroundColor: theme.bgCard },
  letter: { color: theme.accent, fontWeight: '900' },
});
