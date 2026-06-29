import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, SafeAreaView, Alert, Image } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppDispatch } from '@store/index';
import { publishStory } from '@store/storiesSlice';
import { pickMedia } from '@services/media';
import { MediaRef } from '../types';
import { theme } from '@utils/theme';
import { CameraIcon, ImageIcon, SendIcon } from '@components/Icons';
import HapticFeedback from 'react-native-haptic-feedback';

const BG_COLORS: string[] = [
  '#1A0E3A', '#08091C', '#0E2A22', '#2A0E1E', '#141414',
  '#7C5CFF', '#22D3EE', '#3DDC97', '#FFB547', '#FF4B6E',
];

export const StoryCreateScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [media, setMedia] = useState<MediaRef | null>(null);
  const [publishing, setPublishing] = useState(false);

  const pickImage = async (source: 'library' | 'camera'): Promise<void> => {
    try {
      const m = await pickMedia({ source, kind: 'image' });
      if (!m) return;
      setMedia(m);
      setMode('image');
    } catch (e: any) { Alert.alert('Pick failed', e?.message ?? 'unknown'); }
  };

  const publish = async (): Promise<void> => {
    if (mode === 'text' && !text.trim()) { Alert.alert('Empty', 'Write something first.'); return; }
    if (mode === 'image' && !media) { Alert.alert('No image', 'Pick a photo first.'); return; }
    setPublishing(true);
    HapticFeedback.trigger('impactMedium');
    try {
      if (mode === 'text') {
        await dispatch(publishStory({ kind: 'text', body: text.trim(), bgColor })).unwrap();
      } else {
        await dispatch(publishStory({ kind: 'image', body: media!.data ?? '', media: media! })).unwrap();
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Publish failed', String(e));
    } finally { setPublishing(false); }
  };

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>✕</Text></Pressable>
        <Text style={styles.title}>NEW STORY</Text>
        <Pressable onPress={publish} disabled={publishing} style={[styles.publish, publishing && { opacity: 0.5 }]}>
          <SendIcon size={18} color={theme.bg} />
          <Text style={styles.publishLabel}>PUBLISH</Text>
        </Pressable>
      </View>

      {/* Preview */}
      {mode === 'text' ? (
        <LinearGradient colors={[bgColor, bgColor]} style={styles.preview}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Tap to type…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            multiline
            style={styles.textInput}
            maxLength={280}
            autoFocus
          />
          <Text style={styles.counter}>{text.length}/280</Text>
        </LinearGradient>
      ) : (
        <View style={styles.preview}>
          {media?.data && (
            <Image source={{ uri: `data:${media.mime};base64,${media.data}` }} style={styles.img} resizeMode="contain" />
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Caption (optional)…"
            placeholderTextColor={theme.textDim}
            style={styles.caption}
            maxLength={140}
          />
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.modeSwitch}>
          <Pressable onPress={() => setMode('text')} style={[styles.modeBtn, mode === 'text' && styles.modeBtnActive]}>
            <Text style={[styles.modeLabel, mode === 'text' && styles.modeLabelActive]}>Aa</Text>
          </Pressable>
          <Pressable onPress={() => pickImage('library')} style={[styles.modeBtn, mode === 'image' && styles.modeBtnActive]}>
            <ImageIcon size={20} color={mode === 'image' ? theme.bg : theme.text} />
          </Pressable>
          <Pressable onPress={() => pickImage('camera')} style={styles.modeBtn}>
            <CameraIcon size={20} color={theme.text} />
          </Pressable>
        </View>

        {mode === 'text' && (
          <View style={styles.colorRow}>
            {BG_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setBgColor(c)}
                style={[styles.colorDot, { backgroundColor: c }, bgColor === c && styles.colorDotActive]}
              />
            ))}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  back: { color: theme.text, fontSize: 22, width: 28 },
  title: { color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  publish: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18,
    ...theme.shadow.glow,
  },
  publishLabel: { color: theme.bg, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },

  preview: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  textInput: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center', lineHeight: 40, width: '100%' },
  counter: { color: 'rgba(255,255,255,0.6)', position: 'absolute', bottom: 16, right: 16, fontSize: 11 },
  img: { flex: 1, width: '100%' },
  caption: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    color: '#fff', fontSize: 15,
  },

  controls: {
    paddingHorizontal: 16, paddingVertical: 14, gap: 14,
    backgroundColor: theme.bgElev, borderTopWidth: 1, borderTopColor: theme.border,
  },
  modeSwitch: { flexDirection: 'row', gap: 10 },
  modeBtn: {
    width: 46, height: 38, borderRadius: 19,
    backgroundColor: theme.bgInput, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
  },
  modeBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  modeLabel: { color: theme.text, fontSize: 15, fontWeight: '900' },
  modeLabelActive: { color: theme.bg },

  colorRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  colorDot: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 2, borderColor: 'transparent',
  },
  colorDotActive: { borderColor: '#fff' },
});
