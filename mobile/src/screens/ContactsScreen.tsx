import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, SafeAreaView } from 'react-native';
import { Input } from '@components/Input';
import { Avatar } from '@components/Avatar';
import { useAppDispatch, useAppSelector } from '@store/index';
import { loadContacts, addContact, searchUsers, removeContact, blockUser } from '@store/contactsSlice';
import { theme } from '@utils/theme';
import { User, Contact } from '../types';
import { TrustBadge } from '@components/TrustBadge';
import { getPeerTrustLevel } from '@services/attestationStore';

export const ContactsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const contacts = useAppSelector((s) => s.contacts.contacts);
  const results = useAppSelector((s) => s.contacts.searchResults);
  const [q, setQ] = useState('');

  useEffect(() => { dispatch(loadContacts()); }, [dispatch]);
  useEffect(() => {
    if (q.length < 2) return;
    const t = setTimeout(() => dispatch(searchUsers(q)), 300);
    return () => clearTimeout(t);
  }, [q, dispatch]);

  const list: (User | Contact)[] = q.length >= 2 ? results : contacts;

  const openChat = async (u: User) => {
    if (q.length >= 2) { try { await dispatch(addContact(u.id)).unwrap(); } catch {} }
    navigation.navigate('Chat', { conversationId: u.id, peerId: u.id, peerName: u.displayName ?? u.username });
  };

  return (
    <SafeAreaView style={styles.c}>
      <View style={{ padding: 20 }}>
        <Text style={styles.title}>CONTACTS</Text>
        <Input placeholder="Search by username…" autoCapitalize="none" autoCorrect={false} value={q} onChangeText={setQ} />
      </View>
      <FlatList
        data={list}
        keyExtractor={(u) => u.id}
        ListEmptyComponent={<Text style={styles.empty}>{q.length >= 2 ? 'No users found.' : 'No contacts yet.'}</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => openChat(item)} onLongPress={() => {
            const isContact = (item as Contact).isBlocked === false || contacts.find((c) => c.id === item.id);
            if (!isContact) return;
          }} style={styles.row}>
            <Avatar name={item.displayName ?? item.username} url={item.avatarUrl} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.name} numberOfLines={1}>{item.displayName ?? item.username}</Text>
                {(() => {
                  const lvl = getPeerTrustLevel(item.id);
                  return lvl !== 'unknown' ? <TrustBadge level={lvl} compact /> : null;
                })()}
              </View>
              <Text style={styles.uname}>@{item.username} · {item.region?.toUpperCase()}</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 18, fontWeight: '900', letterSpacing: 3, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 12 },
  name: { color: theme.text, fontSize: 15, fontWeight: '700' },
  uname: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  empty: { color: theme.textDim, textAlign: 'center', marginTop: 40 },
});
