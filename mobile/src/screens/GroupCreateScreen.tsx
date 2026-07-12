import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, SafeAreaView, FlatList, Alert } from 'react-native';
import { useAppDispatch, useAppSelector } from '@store/index';
import { loadContacts } from '@store/contactsSlice';
import { createGroup } from '@store/groupsSlice';
import { upsertConversation } from '@store/chatSlice';
import { theme } from '@utils/theme';
import { Avatar } from '@components/Avatar';
import { CheckIcon, GroupIcon } from '@components/Icons';
import { Contact } from '../types';

export const GroupCreateScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const contacts = useAppSelector((s) => s.contacts.contacts);
  const loading = useAppSelector((s) => s.contacts.loading);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => { if (contacts.length === 0) dispatch(loadContacts()); }, [dispatch]);

  const toggle = (id: string): void => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Si può creare un gruppo VUOTO (senza contatti pre-selezionati) e invitare dopo col QR/link.
  // Prima serviva >=1 membro dai contatti: senza contatti era impossibile creare qualsiasi gruppo.
  const canCreate = name.trim().length >= 2;

  const create = async (): Promise<void> => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const group = await dispatch(createGroup({ name: name.trim(), memberIds: Array.from(selected) })).unwrap();
      // Seed an empty conversation entry so the group shows up immediately on Home
      dispatch(upsertConversation({
        id: group.id, peerId: group.id, peerName: group.name, isGroup: true,
        unreadCount: 0, muted: false, archived: false, updatedAt: Date.now(),
      }));
      // Gruppi invite-only: dopo la creazione si mostra subito il QR d'invito da condividere.
      navigation.replace('GroupInvite', { groupId: group.id, groupName: group.name });
    } catch (e: any) {
      Alert.alert('Create failed', String(e));
    } finally { setCreating(false); }
  };

  const renderContact = ({ item }: { item: Contact }) => {
    const picked = selected.has(item.id);
    return (
      <Pressable onPress={() => toggle(item.id)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.bgElev }]}>
        <Avatar name={item.displayName || item.username} url={item.avatarUrl} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.displayName || item.username}</Text>
          <Text style={styles.handle} numberOfLines={1}>@{item.username}</Text>
        </View>
        <View style={[styles.check, picked && styles.checkOn]}>
          {picked && <CheckIcon size={14} color={theme.bg} strokeWidth={3} />}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title}>NEW GROUP</Text>
        <Pressable onPress={create} disabled={!canCreate || creating} style={[styles.cta, (!canCreate || creating) && { opacity: 0.4 }]}>
          <Text style={styles.ctaLabel}>CREATE</Text>
        </Pressable>
      </View>

      <View style={styles.nameRow}>
        <View style={styles.nameIcon}><GroupIcon size={22} color={theme.bg} /></View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Group name"
          placeholderTextColor={theme.textDim}
          style={styles.nameInput}
          maxLength={48}
        />
      </View>

      <View style={styles.picked}>
        <Text style={styles.pickedLabel}>MEMBERS · {selected.size}</Text>
      </View>

      <FlatList
        data={contacts}
        keyExtractor={(c) => c.id}
        renderItem={renderContact}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{loading ? 'Loading contacts…' : 'Nessun contatto: crea il gruppo e invita con QR/link.'}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  back: { color: theme.accent, fontSize: 32, fontWeight: '300' },
  title: { color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  cta: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: theme.accent },
  ctaLabel: { color: theme.bg, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },

  nameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  nameIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center',
  },
  nameInput: { flex: 1, color: theme.text, fontSize: 16, padding: 0 },

  picked: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  pickedLabel: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '900' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  name: { color: theme.text, fontSize: 15, fontWeight: '600' },
  handle: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  check: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  sep: { height: 1, backgroundColor: theme.border, marginLeft: 70 },

  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: theme.textDim, fontSize: 13 },
});
