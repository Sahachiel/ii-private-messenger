import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing, Image, Dimensions } from 'react-native';
import { useAppDispatch, useAppSelector } from '@store/index';
import { markViewed } from '@store/storiesSlice';
import { theme } from '@utils/theme';

const STORY_DURATION_MS = 5000;
const { width: SCREEN_W } = Dimensions.get('window');

// Full-screen story viewer with auto-advance progress bar. Tap right to skip,
// tap left to go back, tap-and-hold to pause (basic — pause not wired in v0.2.5).
export const StoryViewerScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const { storyId } = route.params;
  const dispatch = useAppDispatch();
  const myId = useAppSelector((s) => s.auth.user?.id);
  const stories = useAppSelector((s) => s.stories);

  // Group stories by author. Sequence = all stories of the same author, ordered.
  const authorStories = React.useMemo(() => {
    const initial = stories.byId[storyId];
    if (!initial) return [];
    return stories.order
      .map((id) => stories.byId[id])
      .filter((s) => s && s.authorId === initial.authorId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [stories, storyId]);

  const [idx, setIdx] = useState(() => Math.max(0, authorStories.findIndex((s) => s.id === storyId)));
  const progress = useRef(new Animated.Value(0)).current;
  const current = authorStories[idx];

  useEffect(() => {
    if (!current) { navigation.goBack(); return; }
    if (myId) dispatch(markViewed({ storyId: current.id, viewerId: myId }));
    progress.setValue(0);
    const anim = Animated.timing(progress, { toValue: 1, duration: STORY_DURATION_MS, easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished }) => { if (finished) next(); });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, current?.id]);

  const next = (): void => {
    if (idx < authorStories.length - 1) setIdx(idx + 1);
    else navigation.goBack();
  };
  const prev = (): void => {
    if (idx > 0) setIdx(idx - 1);
  };

  if (!current) return null;

  return (
    <View style={styles.c}>
      {/* Progress bars */}
      <View style={styles.progressRow}>
        {authorStories.map((_, i) => (
          <View key={i} style={styles.progressTrack}>
            <Animated.View
              style={[styles.progressFill, {
                width: i < idx ? '100%' : i === idx
                  ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) as any
                  : '0%',
              }]}
            />
          </View>
        ))}
      </View>

      {/* Author */}
      <View style={styles.header}>
        <Text style={styles.author}>{current.authorName}</Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      {/* Body */}
      {current.kind === 'image' && current.body ? (
        <Image source={{ uri: `data:image/jpeg;base64,${current.body}` }} style={styles.image} resizeMode="contain" />
      ) : (
        <View style={[styles.textStory, { backgroundColor: current.bgColor ?? '#1A0E3A' }]}>
          <Text style={styles.textBody}>{current.body}</Text>
        </View>
      )}

      {/* Tap zones */}
      <Pressable style={[styles.zone, { left: 0, width: SCREEN_W * 0.35 }]} onPress={prev} />
      <Pressable style={[styles.zone, { right: 0, width: SCREEN_W * 0.65 }]} onPress={next} />
    </View>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#000' },
  progressRow: { flexDirection: 'row', gap: 3, paddingHorizontal: 10, paddingTop: 14 },
  progressTrack: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 12 },
  author: { color: '#fff', fontSize: 14, fontWeight: '700' },
  close: { color: '#fff', fontSize: 22 },
  image: { flex: 1, width: '100%', marginTop: 20 },
  textStory: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 20, paddingHorizontal: 30 },
  textBody: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center', lineHeight: 38 },
  zone: { position: 'absolute', top: 80, bottom: 0 },
});
