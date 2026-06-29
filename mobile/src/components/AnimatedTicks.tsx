import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import { CheckIcon, CheckDoubleIcon, ClockIcon } from './Icons';
import { MessageStatus } from '../types';
import { theme } from '../utils/theme';

// WhatsApp-style tick progression:
//   pending   → clock icon, 70% opacity
//   sent      → single check, dim
//   delivered → double check, dim
//   read      → double check, accent color (blue)
//   failed    → single check with warning tint
export const AnimatedTicks: React.FC<{ status: MessageStatus; size?: number; light?: boolean }> = ({
  status, size = 14, light = false,
}) => {
  const scale = useRef(new Animated.Value(status === 'pending' ? 0.6 : 1)).current;
  const prevStatus = useRef<MessageStatus>(status);

  useEffect(() => {
    if (prevStatus.current !== status) {
      scale.setValue(0.6);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 110, useNativeDriver: true }).start();
      prevStatus.current = status;
    }
  }, [status, scale]);

  const base = light ? 'rgba(255,255,255,0.65)' : theme.textMute;
  const accent = theme.accentAlt; // cyan — "read" color

  let child: React.ReactNode;
  if (status === 'pending') child = <ClockIcon size={size} color={base} />;
  else if (status === 'failed') child = <CheckIcon size={size} color={theme.alert} strokeWidth={2.4} />;
  else if (status === 'sent') child = <CheckIcon size={size} color={base} />;
  else if (status === 'delivered') child = <CheckDoubleIcon size={size} color={base} />;
  else child = <CheckDoubleIcon size={size} color={accent} />;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <View>{child}</View>
    </Animated.View>
  );
};
