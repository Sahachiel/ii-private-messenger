import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { theme } from '@utils/theme';
import { Story } from '../types';
import { PlusIcon } from './Icons';

interface Props {
  story?: Story;
  isAddTile?: boolean;
  viewed?: boolean;
  onPress: () => void;
}

// Round bordered thumbnail — WhatsApp "Updates" style. Unseen = gradient border;
// seen = dim border; add-tile = plus glyph overlay on user's avatar.
export const StoryThumbnail: React.FC<Props> = ({ story, isAddTile, viewed, onPress }) => {
  const colors: [string, string] = viewed
    ? [theme.border, theme.border]
    : [theme.accent, theme.accentAlt];
  const initial = story?.authorName?.[0] ?? '+';
  const bg = story?.bgColor ?? '#1A0E3A';

  return (
    <Pressable onPress={onPress} style={styles.tile}>
      <LinearGradient colors={colors} style={styles.ring}>
        <View style={styles.inner}>
          {story?.kind === 'image' && story?.body ? (
            <Image source={{ uri: `data:image/jpeg;base64,${story.body}` }} style={styles.img} />
          ) : (
            <View style={[styles.textStory, { backgroundColor: bg }]}>
              <Text style={styles.initial}>{initial}</Text>
            </View>
          )}
        </View>
      </LinearGradient>
      {isAddTile && (
        <View style={styles.plusBadge}>
          <PlusIcon size={12} color="#fff" strokeWidth={3} />
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>{isAddTile ? 'You' : story?.authorName ?? '—'}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  tile: { alignItems: 'center', width: 68 },
  ring: {
    width: 62, height: 62, borderRadius: 31,
    alignItems: 'center', justifyContent: 'center',
  },
  inner: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden',
    backgroundColor: theme.bgCard, borderWidth: 2, borderColor: theme.bg,
  },
  img: { width: 56, height: 56 },
  textStory: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontSize: 22, fontWeight: '900' },
  plusBadge: {
    position: 'absolute', right: 2, bottom: 22,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: theme.bg,
  },
  name: { color: theme.text, fontSize: 11, marginTop: 6, maxWidth: 64 },
});
