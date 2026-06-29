import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, Pressable, TextInput, Alert, ScrollView } from 'react-native';
import { ConversationItem } from '@components/ConversationItem';
import { StatusBadge } from '@components/StatusBadge';
import { Avatar } from '@components/Avatar';
import { StoryThumbnail } from '@components/StoryThumbnail';
import { useAppSelector, useAppDispatch } from '@store/index';
import { clearConversation, toggleMute, toggleArchive } from '@store/chatSlice';
import { theme } from '@utils/theme';
import { SearchIcon, PlusIcon, QRIcon, StoryIcon, GroupIcon } from '@components/Icons';
import { getPeerTrustLevel } from '@services/attestationStore';
import HapticFeedback from 'react-native-haptic-feedback';

export const HomeScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const conversations = useAppSelector((s) => s.chat.conversations);
  const groups = useAppSelector((s) => s.groups.byId);
  const stories = useAppSelector((s) => s.stories);
  const user = useAppSelector((s) => s.auth.user);
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const items = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((c) => c.peerName.toLowerCase().includes(q));
  }, [conversations, query]);

  const storyList = useMemo(() => stories.order.map((id) => stories.byId[id]).filter(Boolean), [stories]);

  const longPress = (item: { id: string; isGroup?: boolean; peerName: string }): void => {
    HapticFeedback.trigger('impactLight');
    const actions: any[] = [];
    if (item.isGroup) {
      actions.push({ text: 'Info gruppo', onPress: () => navigation.navigate('GroupInfo', { groupId: item.id, groupName: item.peerName }) });
    }
    actions.push(
      { text: 'Silenzia', onPress: () => dispatch(toggleMute({ conversationId: item.id })) },
      { text: 'Archivia', onPress: () => dispatch(toggleArchive({ conversationId: item.id })) },
      { text: 'Elimina', style: 'destructive', onPress: () => dispatch(clearConversation({ conversationId: item.id })) },
      { text: 'Annulla', style: 'cancel' },
    );
    Alert.alert(item.isGroup ? 'Gruppo' : 'Conversazione', '', actions);
  };

  const newChatMenu = (): void => {
    HapticFeedback.trigger('impactMedium');
    Alert.alert('Nuovo', '', [
      { text: 'Nuovo gruppo', onPress: () => navigation.navigate('GroupCreate') },
      { text: 'Scansiona invito', onPress: () => navigation.navigate('GroupInvite') },
      { text: 'Annulla', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView style={styles.c}>
      {/* Large title header */}
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>II</Text>
          <Text style={styles.tagline}>Private Messenger</Text>
        </View>
        <View style={styles.topActions}>
          <Pressable onPress={() => navigation.navigate('QRPairing')}>
            <QRIcon size={22} color={theme.text} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Profile')}>
            <Avatar name={user?.displayName ?? '?'} url={user?.avatarUrl} size={36} />
          </Pressable>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <SearchIcon size={16} color={theme.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats, contacts…"
          placeholderTextColor={theme.textDim}
          style={styles.search}
        />
        <View style={styles.statusWrap}><StatusBadge status={isAuthenticated ? 'online' : 'offline'} /></View>
      </View>

      {/* Stories rail */}
      <View style={styles.storyRailWrap}>
        <Text style={styles.sectionLabel}>UPDATES</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRail}>
          <StoryThumbnail isAddTile onPress={() => navigation.navigate('StoryCreate')} />
          {storyList.map((s) => (
            <StoryThumbnail
              key={s.id}
              story={s}
              viewed={s.viewedBy.includes(user?.id ?? '')}
              onPress={() => navigation.navigate('StoryViewer', { storyId: s.id })}
            />
          ))}
        </ScrollView>
      </View>

      {/* Chats header */}
      <View style={styles.chatsHead}>
        <Text style={styles.sectionLabel}>CHATS</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => navigation.navigate('GroupCreate')} hitSlop={10}>
            <GroupIcon size={18} color={theme.accent} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          <ConversationItem
            conversation={item}
            trust={!item.isGroup ? getPeerTrustLevel(item.peerId) : 'unknown'}
            onPress={() => navigation.navigate('Chat', { conversationId: item.id, peerId: item.peerId, peerName: item.peerName, isGroup: item.isGroup })}
            onLongPress={() => longPress(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>NO CONVERSATIONS</Text>
            <Text style={styles.emptySub}>Tap + to start a secure chat</Text>
          </View>
        }
      />

      <Pressable style={styles.fab} onPress={newChatMenu}>
        <PlusIcon size={26} color={theme.bg} strokeWidth={2.6} />
      </Pressable>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    gap: 14,
  },
  brand: { color: theme.text, fontSize: 32, fontWeight: '900', letterSpacing: 4 },
  tagline: { color: theme.textDim, fontSize: 11, letterSpacing: 2, marginTop: -2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: theme.bgInput, borderRadius: 22,
  },
  search: { flex: 1, color: theme.text, fontSize: 14, padding: 0 },
  statusWrap: { marginLeft: 'auto' },

  sectionLabel: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '900' },

  storyRailWrap: { paddingLeft: 16, marginBottom: 6 },
  storyRail: { paddingRight: 16, paddingTop: 10, paddingBottom: 14, gap: 10 },

  chatsHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: theme.border,
  },

  sep: { height: 1, backgroundColor: theme.border, marginLeft: 72 },

  empty: { alignItems: 'center', paddingVertical: 100 },
  emptyTitle: { color: theme.textDim, letterSpacing: 3, fontSize: 12, fontWeight: '900' },
  emptySub: { color: theme.textMute, marginTop: 10, fontSize: 12 },

  fab: {
    position: 'absolute', right: 20, bottom: 28,
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.glow,
  },
});
