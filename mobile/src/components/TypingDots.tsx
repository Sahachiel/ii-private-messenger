import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Easing } from 'react-native';
import { theme } from '../utils/theme';

// Three-dot typing indicator. Each dot pulses with a staggered delay.
export const TypingDots: React.FC<{ color?: string; size?: number }> = ({ color = theme.accent, size = 5 }) => {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 360, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 360, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      );
    const l = Animated.parallel([make(a, 0), make(b, 150), make(c, 300)]);
    l.start();
    return () => l.stop();
  }, [a, b, c]);

  const dot = (v: Animated.Value): any => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
  });

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dotBase, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }, dot(a)]} />
      <Animated.View style={[styles.dotBase, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }, dot(b)]} />
      <Animated.View style={[styles.dotBase, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }, dot(c)]} />
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  dotBase: {},
});
