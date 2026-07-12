import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Pressable, Alert, Share, Clipboard, ActivityIndicator, ScrollView } from 'react-native';
import { Input } from '@components/Input';
import { useAppDispatch, useAppSelector } from '@store/index';
import { upsertConversation } from '@store/chatSlice';
import { upsertGroup } from '@store/groupsSlice';
import { usersApi, groupsApi } from '@services/api';
import { socket } from '@services/socket';
import { appKv } from '@services/keychain';
import { theme } from '@utils/theme';

/**
 * Discovery SOLO-CODICE (privacy by design).
 *
 * Non esiste ricerca per username: ci si trova unicamente col CODICE UTENTE opaco, che
 * ognuno condivide a mano con chi vuole. Aggiungere un contatto = risolvere il suo codice,
 * creare un gruppo 1:1 con invito VINCOLATO al suo UUID (monouso, senza approvazione) e
 * recapitarglielo "seamless" via relay (contact_invite). Lui vede "X vuole contattarti" →
 * Accetta → entra nel gruppo. Nessun metadato pubblico, nessuna enumerazione.
 */
export const ContactsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.auth.user);
  const [myCode, setMyCode] = useState<string>('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    usersApi.myCode().then((c) => { if (alive) setMyCode(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const copyMine = (): void => {
    if (!myCode) return;
    Clipboard.setString(myCode);
    Alert.alert('Copiato', 'Il tuo codice è negli appunti.');
  };
  const shareMine = async (): Promise<void> => {
    if (!myCode) return;
    try { await Share.share({ message: `Aggiungimi su II Private Messenger col mio codice: ${myCode}` }); } catch { /* annullato */ }
  };

  const addByCode = async (): Promise<void> => {
    const q = code.trim().toUpperCase();
    if (q.length < 6) { Alert.alert('Codice non valido', 'Inserisci il codice completo (es. IIM-XXXX-XXXX).'); return; }
    if (myCode && q === myCode.toUpperCase()) { Alert.alert('Sei tu', 'Questo è il tuo codice.'); return; }
    setBusy(true);
    try {
      const found = await usersApi.byCode(q);
      if (!found) { Alert.alert('Nessun risultato', 'Nessun utente con questo codice. Controlla e riprova.'); return; }
      const myId = me?.id ?? appKv.getString('auth.userId') ?? '';
      if (found.id === myId) { Alert.alert('Sei tu', 'Questo è il tuo codice.'); return; }

      // Gruppo 1:1 + invito blindato al destinatario, senza approvazione (seamless).
      const g = await groupsApi.create(2);
      const inv = await groupsApi.invite(g.id, {
        bound_user_id: found.id,
        requires_approval: false,
        max_uses: 1,
        ttl_seconds: 7 * 24 * 3600,
      });

      // Recapito "seamless" dell'invito al destinatario (instradato per `to`, senza gid).
      const myName = me?.displayName ?? appKv.getString('auth.displayName') ?? 'Qualcuno';
      socket.send({ type: 'contact_invite', to: found.id, token: inv.token, fromName: myName, fromCode: myCode });

      // Stato locale + apertura chat.
      const nm = found.displayName || 'Contatto';
      dispatch(upsertGroup({ id: g.id, name: nm, memberIds: [myId], adminIds: [myId], createdAt: Date.now(), createdBy: myId }));
      dispatch(upsertConversation({ id: g.id, peerId: g.id, peerName: nm, isGroup: true, unreadCount: 0, muted: false, archived: false, updatedAt: Date.now() }));
      setCode('');
      navigation.navigate('Chat', { conversationId: g.id, peerId: g.id, peerName: nm, isGroup: true });
    } catch {
      Alert.alert('Errore', 'Impossibile aggiungere il contatto. Riprova.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>AGGIUNGI CONTATTO</Text>

        {/* Il mio codice */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>IL MIO CODICE</Text>
          {myCode ? <Text style={styles.codeBig} selectable>{myCode}</Text> : <ActivityIndicator color={theme.accent} style={{ marginVertical: 10 }} />}
          <Text style={styles.hint}>Condividilo con chi vuoi farti trovare. Nessuno può cercarti per nome: solo col codice.</Text>
          <View style={styles.btnRow}>
            <Pressable onPress={copyMine} style={styles.btnGhost}><Text style={styles.btnGhostLabel}>COPIA</Text></Pressable>
            <Pressable onPress={shareMine} style={styles.btnGhost}><Text style={styles.btnGhostLabel}>CONDIVIDI</Text></Pressable>
          </View>
        </View>

        {/* Aggiungi con codice */}
        <View style={[styles.card, { marginTop: 16 }]}>
          <Text style={styles.cardLabel}>AGGIUNGI CON CODICE</Text>
          <Input
            placeholder="IIM-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={setCode}
            editable={!busy}
          />
          <Pressable onPress={addByCode} style={[styles.btnPrimary, busy && { opacity: 0.6 }]} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryLabel}>AGGIUNGI E APRI CHAT</Text>}
          </Pressable>
          <Text style={styles.hint}>Riceverà una richiesta di contatto: appena accetta, la chat è attiva ed E2EE.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 18, fontWeight: '900', letterSpacing: 3, marginBottom: 16 },
  card: { backgroundColor: theme.bgElev, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 18 },
  cardLabel: { color: theme.textDim, fontSize: 11, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  codeBig: { color: theme.accent, fontSize: 26, fontWeight: '900', letterSpacing: 3, marginBottom: 6 },
  hint: { color: theme.textDim, fontSize: 12, marginTop: 10, lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btnGhost: { flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center' },
  btnGhostLabel: { color: theme.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  btnPrimary: { marginTop: 12, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.accent, alignItems: 'center' },
  btnPrimaryLabel: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
});
