import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useAppSelector } from '@store/index';
import { signal } from '@services/signal';
import { usersApi, groupsApi } from '@services/api';
import { computeSafetyNumber } from '@utils/crypto';
import { reconcile, setVerified } from '@services/safetyStore';
import { appKv } from '@services/keychain';
import { theme } from '@utils/theme';

/**
 * Verifica identità (numero di sicurezza). Confronta di persona (o su un canale già fidato) il
 * numero a 60 cifre: se coincide su entrambi i dispositivi, nessun uomo-in-mezzo si è inserito.
 * Il numero è ora simmetrico (stesso su A e B) — vedi computeSafetyNumber. Per chat 1:1 risolve
 * in automatico l'altro membro del gruppo.
 */
export const SafetyNumberScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const gid: string | undefined = route?.params?.gid ?? route?.params?.peerId;
  const peerName: string = route?.params?.peerName ?? 'Contatto';
  const myId = useAppSelector((s) => s.auth.user?.id) ?? appKv.getString('auth.userId') ?? '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sn, setSn] = useState<string>('');
  const [peerUserId, setPeerUserId] = useState<string>('');
  const [verified, setVerifiedState] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!gid) { setError('Conversazione non valida.'); return; }
        // Risolve il peer 1:1 dal gruppo.
        let peer = '';
        try {
          const members = await groupsApi.members(gid);
          const others = members.map((m) => m.user_id).filter((u) => u !== myId);
          if (others.length === 1) peer = others[0];
          else if (others.length > 1) { setError('La verifica è disponibile solo per le chat 1:1.'); return; }
          else { setError('Nessun altro membro da verificare.'); return; }
        } catch { setError('Impossibile leggere i membri della conversazione.'); return; }

        await signal.initialize();
        const myIk = signal.getIdentityPublicKeyB64();
        const theirIk = (await usersApi.keys(peer)).identityPublicKey;
        const num = computeSafetyNumber(myIk, theirIk);
        const rec = reconcile(peer, num);
        if (!alive) return;
        setPeerUserId(peer);
        setSn(num);
        setVerifiedState(rec.verified);
      } catch {
        if (alive) setError('Impossibile calcolare il numero di sicurezza.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [gid, myId]);

  const toggleVerified = (): void => {
    const next = !verified;
    setVerifiedState(next);
    if (peerUserId && sn) setVerified(peerUserId, sn, next);
  };

  const groups = sn ? sn.split(' ') : [];

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title}>VERIFICA IDENTITÀ</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 22 }}>
        <Text style={styles.peer}>{peerName}</Text>

        {loading ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <>
            <View style={[styles.badge, verified ? styles.badgeOk : styles.badgeWarn]}>
              <Text style={[styles.badgeText, verified ? { color: theme.accent } : { color: theme.alert }]}>
                {verified ? '✓ VERIFICATO' : 'NON VERIFICATO'}
              </Text>
            </View>

            <View style={styles.grid}>
              {groups.map((g, i) => <Text key={i} style={styles.cell}>{g}</Text>)}
            </View>

            <Text style={styles.hint}>
              Confronta questo numero con {peerName} di persona o su un canale già fidato. Se è
              identico su entrambi i dispositivi, la conversazione è protetta da intercettazioni.
              Se cambia in futuro, la verifica decade: potrebbe essere un cambio dispositivo o un tentativo di attacco.
            </Text>

            <Pressable onPress={toggleVerified} style={[styles.btn, verified ? styles.btnGhost : styles.btnPrimary]}>
              <Text style={[styles.btnLabel, verified ? { color: theme.text } : { color: '#fff' }]}>
                {verified ? 'RIMUOVI VERIFICA' : 'SEGNA COME VERIFICATO'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  back: { color: theme.accent, fontSize: 32, fontWeight: '300', width: 28 },
  title: { color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  peer: { color: theme.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  badge: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, marginBottom: 20 },
  badgeOk: { borderColor: theme.accent, backgroundColor: 'rgba(0,168,132,0.08)' },
  badgeWarn: { borderColor: theme.alert, backgroundColor: 'rgba(234,67,53,0.06)' },
  badgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, backgroundColor: theme.bgElev, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 18 },
  cell: { color: theme.text, fontSize: 18, fontFamily: theme.font.mono, letterSpacing: 1, width: '28%', textAlign: 'center' },
  hint: { color: theme.textDim, fontSize: 12, lineHeight: 18, marginTop: 20 },
  btn: { marginTop: 24, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: theme.accent },
  btnGhost: { backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border },
  btnLabel: { fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  error: { color: theme.alert, fontSize: 13, textAlign: 'center', marginTop: 30 },
});
