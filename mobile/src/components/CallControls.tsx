import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { theme } from '@utils/theme';

interface Props {
  isMuted: boolean;
  isVideo: boolean;
  isVideoEnabled: boolean;
  onToggleMute: () => void;
  onToggleVideo?: () => void;
  onSwitchCamera?: () => void;
  onSpeaker?: () => void;
  onEnd: () => void;
}

export const CallControls: React.FC<Props> = ({ isMuted, isVideo, isVideoEnabled, onToggleMute, onToggleVideo, onSwitchCamera, onSpeaker, onEnd }) => (
  <View style={styles.row}>
    <Btn label={isMuted ? 'UNMUTE' : 'MUTE'} onPress={onToggleMute} active={isMuted} />
    {isVideo ? (
      <>
        <Btn label={isVideoEnabled ? 'VID OFF' : 'VID ON'} onPress={onToggleVideo!} active={!isVideoEnabled} />
        <Btn label="FLIP" onPress={onSwitchCamera!} />
      </>
    ) : (
      <Btn label="SPEAKER" onPress={onSpeaker!} />
    )}
    <Btn label="END" onPress={onEnd} danger />
  </View>
);

const Btn: React.FC<{ label: string; onPress: () => void; active?: boolean; danger?: boolean }> = ({ label, onPress, active, danger }) => (
  <Pressable onPress={onPress} style={[
    styles.btn,
    active && { backgroundColor: theme.accent, borderColor: theme.accent },
    danger && { backgroundColor: theme.alert, borderColor: theme.alert, width: 72, height: 72 },
  ]}>
    <Text style={[styles.label, active && { color: '#000' }, danger && { color: '#fff' }]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 32, gap: 12 },
  btn: { width: 64, height: 64, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgElev, alignItems: 'center', justifyContent: 'center' },
  label: { color: theme.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
});
