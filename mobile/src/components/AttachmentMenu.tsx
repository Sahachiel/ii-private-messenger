import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '@utils/theme';
import { CameraIcon, ImageIcon, FileIcon, LocationIcon, MicIcon } from './Icons';

interface Props {
  onPickCamera: () => void;
  onPickImage: () => void;
  onPickVideo: () => void;
  onPickFile: () => void;
  onPickLocation: () => void;
  onClose: () => void;
}

// Horizontal attachment grid — 5 actions in one row (scrollable if tight).
export const AttachmentMenu: React.FC<Props> = (p) => {
  const items: Array<[string, React.ReactNode, () => void, string]> = [
    ['Camera',   <CameraIcon color="#fff" />,   p.onPickCamera,   '#7C5CFF'],
    ['Photo',    <ImageIcon color="#fff" />,    p.onPickImage,    '#22D3EE'],
    ['Video',    <ImageIcon color="#fff" />,    p.onPickVideo,    '#3DDC97'],
    ['File',     <FileIcon color="#fff" />,     p.onPickFile,     '#FFB547'],
    ['Location', <LocationIcon color="#fff" />, p.onPickLocation, '#FF4B6E'],
  ];
  return (
    <View style={styles.c}>
      <Text style={styles.title}>ATTACH</Text>
      <View style={styles.grid}>
        {items.map(([label, icon, onPress, bg]) => (
          <Pressable key={label} onPress={() => { onPress(); p.onClose(); }} style={styles.tile}>
            <View style={[styles.iconWrap, { backgroundColor: bg }]}>{icon}</View>
            <Text style={styles.label}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  c: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  title: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '900', marginBottom: 14 },
  grid: { flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  tile: { alignItems: 'center', gap: 6, flex: 1 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.sm,
  },
  label: { color: theme.text, fontSize: 11, fontWeight: '600' },
});
