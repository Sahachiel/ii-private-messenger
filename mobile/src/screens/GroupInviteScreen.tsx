import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView, Alert, Linking, Share, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { useAppDispatch } from '@store/index';
import { groupsApi } from '@services/api';
import { upsertGroup } from '@store/groupsSlice';
import { upsertConversation } from '@store/chatSlice';
import { appKv } from '@services/keychain';
import { theme } from '@utils/theme';
import { QRIcon, ScanIcon } from '@components/Icons';
import HapticFeedback from 'react-native-haptic-feedback';

/**
 * Invito di gruppo via QR/link.
 *
 * SICUREZZA (dai requisiti + review avversariale):
 *  - Il QR NON contiene il nome del gruppo né l'inviter: solo { k:'gi', t:<token firmato> }.
 *    Il token è una capability Ed25519 firmata dal backend che racchiude SOLO il gid opaco,
 *    un nonce, la scadenza e l'eventuale bind al destinatario. Niente leak di metadati.
 *  - Validazione PER-TIPO rigorosa allo scan: si accetta solo k==='gi' con token ben formato;
 *    nessuna confusione col QR di device-pairing (k diverso, struttura diversa).
 *  - Default blindato: invito con requires_approval (un admin deve approvare) + scadenza 7gg.
 *    Un link rubato non fa entrare nessuno senza approvazione.
 */
interface GroupInviteQR { k: 'gi'; t: string }

function isValidToken(t: unknown): t is string {
  return typeof t === 'string' && t.length > 16 && t.length < 4096 && t.split('.').length === 2;
}

export const GroupInviteScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const dispatch = useAppDispatch();
  const groupId: string | undefined = route?.params?.groupId;
  const groupName: string = route?.params?.groupName ?? 'Gruppo';
  const [mode, setMode] = useState<'show' | 'scan'>(groupId ? 'show' : 'scan');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasPerm, setHasPerm] = useState(false);
  const [joining, setJoining] = useState(false);
  const device = useCameraDevice('back');

  const genInvite = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const res = await groupsApi.invite(groupId, { requires_approval: true, max_uses: 1, ttl_seconds: 7 * 24 * 3600 });
      setToken(res.token);
    } catch (e: any) {
      Alert.alert('Errore', 'Impossibile generare l’invito (serve essere admin del gruppo).');
    } finally { setLoading(false); }
  }, [groupId]);

  useEffect(() => { if (mode === 'show') void genInvite(); }, [mode, genInvite]);

  const qrData = useMemo(() => (token ? JSON.stringify({ k: 'gi', t: token } as GroupInviteQR) : ''), [token]);
  const deepLink = useMemo(() => (token ? `iimsg://join?t=${encodeURIComponent(token)}` : ''), [token]);

  const shareLink = async (): Promise<void> => {
    if (!deepLink) return;
    try { await Share.share({ message: `Unisciti al gruppo su II Private Messenger:\n${deepLink}` }); } catch { /* annullato */ }
  };

  const onScanRequest = async (): Promise<void> => {
    try {
      const p = await Camera.requestCameraPermission();
      setHasPerm(p === 'granted');
      if (p !== 'granted') {
        Alert.alert('Camera negata', 'Abilita la fotocamera nelle impostazioni.', [
          { text: 'Annulla', style: 'cancel' },
          { text: 'Impostazioni', onPress: () => Linking.openSettings() },
        ]);
      } else { setMode('scan'); }
    } catch (e: any) { Alert.alert('Errore camera', String(e)); }
  };

  const doJoin = useCallback(async (t: string): Promise<void> => {
    if (joining) return;
    setJoining(true);
    try {
      const res = await groupsApi.join(t);
      if (res.status === 'pending') {
        Alert.alert('Richiesta inviata', 'Un amministratore del gruppo deve approvarti. Riceverai accesso appena approvato.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }
      const gid = res.gid;
      const myId = appKv.getString('auth.userId') ?? '';
      let members: string[] = [myId];
      try { members = (await groupsApi.members(gid)).map((m) => m.user_id); } catch { /* placeholder */ }
      // Nome reale del gruppo: arriva cifrato (systemText) dopo il primo messaggio. Placeholder ora.
      dispatch(upsertGroup({ id: gid, name: 'Gruppo', memberIds: members, adminIds: [], createdAt: Date.now(), createdBy: '' }));
      dispatch(upsertConversation({ id: gid, peerId: gid, peerName: 'Gruppo', isGroup: true, unreadCount: 0, muted: false, archived: false, updatedAt: Date.now() }));
      navigation.replace('Chat', { conversationId: gid, peerId: gid, peerName: 'Gruppo', isGroup: true });
    } catch (e: any) {
      Alert.alert('Invito non valido', 'Il token è scaduto, revocato o non valido.', [{ text: 'OK' }]);
    } finally { setJoining(false); }
  }, [joining, dispatch, navigation]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (!codes.length || joining) return;
      const raw = codes[0]?.value;
      if (!raw) return;
      let parsed: GroupInviteQR;
      try { parsed = JSON.parse(raw); } catch { Alert.alert('QR non valido', 'Formato non riconosciuto.'); return; }
      // Validazione per-tipo RIGOROSA: solo inviti di gruppo, token ben formato.
      if (!parsed || parsed.k !== 'gi' || !isValidToken(parsed.t)) {
        Alert.alert('QR non valido', 'Questo non è un invito di gruppo.');
        return;
      }
      HapticFeedback.trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
      void doJoin(parsed.t);
    },
  });

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title}>INVITO GRUPPO</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.tabRow}>
        <Pressable onPress={() => groupId && setMode('show')} style={[styles.tab, mode === 'show' && styles.tabActive, !groupId && { opacity: 0.4 }]}>
          <QRIcon size={16} color={mode === 'show' ? theme.bg : theme.text} />
          <Text style={[styles.tabLabel, mode === 'show' && { color: theme.bg }]}>INVITA</Text>
        </Pressable>
        <Pressable onPress={onScanRequest} style={[styles.tab, mode === 'scan' && styles.tabActive]}>
          <ScanIcon size={16} color={mode === 'scan' ? theme.bg : theme.text} />
          <Text style={[styles.tabLabel, mode === 'scan' && { color: theme.bg }]}>SCANSIONA</Text>
        </Pressable>
      </View>

      {mode === 'show' ? (
        <View style={styles.showWrap}>
          {loading || !qrData ? (
            <ActivityIndicator size="large" color={theme.accent} />
          ) : (
            <>
              <View style={styles.qrCard}>
                <QRCode value={qrData} size={240} color={theme.bg} backgroundColor="#fff" ecl="M" />
              </View>
              <Text style={styles.userLabel}>{groupName}</Text>
              <Text style={styles.helper}>
                Fai scansionare questo QR per entrare nel gruppo. Invito monouso, con approvazione admin, valido 7 giorni.
              </Text>
              <View style={styles.btnRow}>
                <Pressable onPress={shareLink} style={styles.refreshBtn}><Text style={styles.refreshLabel}>CONDIVIDI LINK</Text></Pressable>
                <Pressable onPress={genInvite} style={styles.refreshBtn}><Text style={styles.refreshLabel}>NUOVO INVITO</Text></Pressable>
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={styles.scanWrap}>
          {device && hasPerm ? (
            <Camera style={StyleSheet.absoluteFill} device={device} isActive codeScanner={codeScanner} />
          ) : (
            <View style={styles.scanPlaceholder}>
              <Text style={styles.helper}>Serve il permesso fotocamera</Text>
              <Pressable onPress={onScanRequest} style={styles.refreshBtn}><Text style={styles.refreshLabel}>ABILITA CAMERA</Text></Pressable>
            </View>
          )}
          <View pointerEvents="none" style={styles.viewfinder} />
          {joining && (
            <View style={styles.scanResult}><ActivityIndicator color={theme.accent} /><Text style={styles.helper}>Ingresso in corso…</Text></View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  back: { color: theme.accent, fontSize: 32, fontWeight: '300', width: 28 },
  title: { color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  tabRow: { flexDirection: 'row', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 14, backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border },
  tabActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  tabLabel: { color: theme.text, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  showWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  qrCard: { padding: 16, backgroundColor: '#fff', borderRadius: 14, ...theme.shadow.md },
  userLabel: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 10 },
  helper: { color: theme.textDim, fontSize: 12, textAlign: 'center', paddingHorizontal: 20 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  refreshBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border, borderRadius: 18 },
  refreshLabel: { color: theme.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  scanWrap: { flex: 1, backgroundColor: '#000' },
  scanPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  viewfinder: { position: 'absolute', top: '25%', left: '15%', right: '15%', bottom: '35%', borderWidth: 2, borderColor: theme.accent, borderRadius: 16 },
  scanResult: { position: 'absolute', left: 20, right: 20, bottom: 40, backgroundColor: theme.bgElev, borderRadius: 14, padding: 18, alignItems: 'center', gap: 8, ...theme.shadow.md, borderWidth: 1, borderColor: theme.accent },
});
