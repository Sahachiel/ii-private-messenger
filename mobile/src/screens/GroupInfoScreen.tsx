import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useAppDispatch } from '@store/index';
import { groupsApi, GroupMember } from '@services/api';
import { removeGroup } from '@store/groupsSlice';
import { clearConversation } from '@store/chatSlice';
import { appKv } from '@services/keychain';
import { theme } from '@utils/theme';
import { Avatar } from '@components/Avatar';

interface PendingReq { user_id: string; created_at: string }

export const GroupInfoScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const dispatch = useAppDispatch();
  const gid: string = route?.params?.groupId;
  const groupName: string = route?.params?.groupName ?? 'Gruppo';
  const myId = appKv.getString('auth.userId') ?? '';

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [pending, setPending] = useState<PendingReq[]>([]);
  const [loading, setLoading] = useState(true);

  const amAdmin = members.some((m) => m.user_id === myId && (m.role === 'owner' || m.role === 'admin'));

  const load = useCallback(async () => {
    try {
      const m = await groupsApi.members(gid);
      setMembers(m);
      const iAmAdmin = m.some((x) => x.user_id === myId && (x.role === 'owner' || x.role === 'admin'));
      if (iAmAdmin) {
        try { setPending(await groupsApi.joinRequests(gid)); } catch { setPending([]); }
      }
    } catch {
      Alert.alert('Errore', 'Impossibile caricare il gruppo.');
    } finally { setLoading(false); }
  }, [gid, myId]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (userId: string, approve: boolean): Promise<void> => {
    try { await groupsApi.decide(gid, userId, approve); await load(); }
    catch { Alert.alert('Errore', 'Operazione non riuscita.'); }
  };

  const kick = (userId: string): void => {
    Alert.alert('Espelli membro', 'Rimuovere questo membro? Le chiavi del gruppo verranno rigenerate.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Espelli', style: 'destructive', onPress: async () => { try { await groupsApi.remove(gid, userId); await load(); } catch { Alert.alert('Errore', 'Non riuscito.'); } } },
    ]);
  };

  const leave = (): void => {
    Alert.alert('Esci dal gruppo', 'Vuoi davvero uscire? Non riceverai più i messaggi.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Esci', style: 'destructive', onPress: async () => {
        try { await groupsApi.leave(gid); } catch {}
        dispatch(removeGroup({ id: gid }));
        dispatch(clearConversation({ conversationId: gid }));
        navigation.navigate('Main');
      } },
    ]);
  };

  const short = (id: string): string => id.slice(0, 8);

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title} numberOfLines={1}>{groupName.toUpperCase()}</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={theme.accent} /></View>
      ) : (
        <FlatList
          ListHeaderComponent={
            <View>
              <View style={styles.hero}>
                <View style={styles.heroIcon}><Text style={styles.heroLetter}>{groupName.slice(0, 1).toUpperCase()}</Text></View>
                <Text style={styles.heroName}>{groupName}</Text>
                <Text style={styles.heroSub}>{members.length} membri · crittografia end-to-end</Text>
              </View>

              {amAdmin && (
                <Pressable style={styles.inviteBtn} onPress={() => navigation.navigate('GroupInvite', { groupId: gid, groupName })}>
                  <Text style={styles.inviteLabel}>＋ INVITA (QR / LINK)</Text>
                </Pressable>
              )}

              {amAdmin && pending.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>RICHIESTE IN ATTESA · {pending.length}</Text>
                  {pending.map((p) => (
                    <View key={p.user_id} style={styles.row}>
                      <Avatar name={short(p.user_id)} size={40} />
                      <View style={{ flex: 1 }}><Text style={styles.name}>{short(p.user_id)}…</Text><Text style={styles.handle}>richiesta di ingresso</Text></View>
                      <Pressable onPress={() => decide(p.user_id, true)} style={[styles.smallBtn, styles.okBtn]}><Text style={styles.okLabel}>OK</Text></Pressable>
                      <Pressable onPress={() => decide(p.user_id, false)} style={[styles.smallBtn, styles.noBtn]}><Text style={styles.noLabel}>NO</Text></Pressable>
                    </View>
                  ))}
                </View>
              )}

              <Text style={[styles.sectionLabel, { marginTop: 18, marginLeft: 16 }]}>MEMBRI · {members.length}</Text>
            </View>
          }
          data={members}
          keyExtractor={(m) => m.user_id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar name={short(item.user_id)} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.user_id === myId ? 'Tu' : `${short(item.user_id)}…`}</Text>
                <Text style={styles.handle}>{item.role}</Text>
              </View>
              {amAdmin && item.user_id !== myId && (
                <Pressable onPress={() => kick(item.user_id)} style={[styles.smallBtn, styles.noBtn]}><Text style={styles.noLabel}>×</Text></Pressable>
              )}
            </View>
          )}
          ListFooterComponent={
            <Pressable style={styles.leaveBtn} onPress={leave}><Text style={styles.leaveLabel}>ESCI DAL GRUPPO</Text></Pressable>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  back: { color: theme.accent, fontSize: 32, fontWeight: '300', width: 28 },
  title: { color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 3, flex: 1, textAlign: 'center' },
  hero: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  heroIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  heroLetter: { color: theme.bg, fontSize: 32, fontWeight: '900' },
  heroName: { color: theme.text, fontSize: 20, fontWeight: '800' },
  heroSub: { color: theme.textDim, fontSize: 12 },
  inviteBtn: { marginHorizontal: 16, marginTop: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.accent, alignItems: 'center' },
  inviteLabel: { color: theme.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  section: { marginTop: 16 },
  sectionLabel: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '900', marginLeft: 16, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  name: { color: theme.text, fontSize: 15, fontWeight: '600' },
  handle: { color: theme.textDim, fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, marginLeft: 6 },
  okBtn: { backgroundColor: theme.accent },
  okLabel: { color: theme.bg, fontWeight: '900', fontSize: 11 },
  noBtn: { borderWidth: 1, borderColor: theme.alert },
  noLabel: { color: theme.alert, fontWeight: '900', fontSize: 12 },
  leaveBtn: { margin: 24, padding: 14, borderWidth: 1, borderColor: theme.alert, borderRadius: 12, alignItems: 'center' },
  leaveLabel: { color: theme.alert, fontWeight: '900', letterSpacing: 2 },
});
