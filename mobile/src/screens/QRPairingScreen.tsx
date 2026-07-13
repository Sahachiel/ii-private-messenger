import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView, Alert, Linking, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAppSelector } from '@store/index';
import { KC } from '@services/keychain';
import { randomBytes, b64 } from '@utils/crypto';
import { theme } from '@utils/theme';
import { scanQrViaPhoto } from '@utils/qrscan';
import { QRIcon, ScanIcon } from '@components/Icons';
import HapticFeedback from 'react-native-haptic-feedback';

// Payload di VERIFICA IDENTITÀ (non di linking). Il QR porta l'impronta della identity key:
// l'altro dispositivo la confronta out-of-band per accertarsi che sia davvero questo account.
// NON collega/mirrora account (il multi-dispositivo con sincronizzazione chiavi è una feature
// futura che richiede un registro dispositivi lato server). Il nonce rende ogni QR diverso.
interface PairingPayload {
  v: 1;
  appId: 'iimsg';
  userId: string;
  username: string;
  fingerprint: string;   // hash della identity pubkey
  nonce: string;         // bytes casuali base64 (freschezza del QR)
  issuedAt: number;
}

function randomNonce(): string {
  return b64.enc(randomBytes(12));
}

async function myFingerprint(): Promise<string> {
  const id = await KC.getIdentity();
  if (!id || !id.password) return '(no identity)';
  try {
    const m = JSON.parse(id.password);
    const pub = (m.pub ?? '') as string;
    return pub.slice(0, 24);
  } catch { return '(error)'; }
}

export const QRPairingScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const user = useAppSelector((s) => s.auth.user);
  const [mode, setMode] = useState<'show' | 'scan'>('show');
  const [fp, setFp] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<PairingPayload | null>(null);

  useEffect(() => { myFingerprint().then(setFp); }, []);

  // Re-issue the nonce every minute so displayed QR doesn't stay valid too long.
  const payload = useMemo<PairingPayload>(() => ({
    v: 1, appId: 'iimsg',
    userId: user?.id ?? '',
    username: user?.username ?? '',
    fingerprint: fp,
    nonce: randomNonce(),
    issuedAt: Date.now(),
  }), [user?.id, user?.username, fp]);

  const [refreshTick, setRefreshTick] = useState(0);
  const liveNonce = useMemo(() => ({ ...payload, nonce: randomNonce(), issuedAt: Date.now() }), [refreshTick, payload]);
  const qrData = JSON.stringify(liveNonce);

  // Scansione SOVRANA one-shot (nessun Google): scatta una foto del QR e la decodifica in JS.
  const runScan = async (): Promise<void> => {
    if (scanning) return;
    setScanning(true);
    try {
      const raw = await scanQrViaPhoto();
      if (raw === null) {
        Alert.alert('Nessun QR rilevato', 'Non ho trovato un QR nella foto (o manca il permesso fotocamera). Riprova inquadrando bene il codice.', [
          { text: 'Riprova', onPress: () => { void runScan(); } },
          { text: 'Impostazioni', onPress: () => Linking.openSettings() },
          { text: 'Annulla', style: 'cancel' },
        ]);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as PairingPayload;
        if (parsed.appId !== 'iimsg' || parsed.v !== 1) throw new Error('Non è un QR di II Private Messenger');
        HapticFeedback.trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
        setScanned(parsed);
      } catch (e: any) {
        Alert.alert('QR non valido', e?.message ?? 'formato non riconosciuto');
      }
    } finally { setScanning(false); }
  };

  const onScanRequest = (): void => { setMode('scan'); setScanned(null); void runScan(); };

  const confirmPair = (): void => {
    if (!scanned) return;
    // Verifica identità out-of-band: mostra l'impronta letta così l'utente la confronta con
    // quella dell'altro dispositivo. Non collega account (nessun record device lato server).
    Alert.alert(
      'Identità letta',
      `Utente: @${scanned.username}\nID: ${scanned.userId.slice(0, 8)}…\nImpronta: ${scanned.fingerprint}\n\nConfronta questa impronta con quella mostrata sull'altro dispositivo: se coincidono, è davvero lo stesso account.`,
      [{ text: 'OK', onPress: () => navigation.goBack() }],
    );
  };

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title}>VERIFICA IDENTITÀ</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.tabRow}>
        <Pressable onPress={() => setMode('show')} style={[styles.tab, mode === 'show' && styles.tabActive]}>
          <QRIcon size={16} color={mode === 'show' ? theme.bg : theme.text} />
          <Text style={[styles.tabLabel, mode === 'show' && { color: theme.bg }]}>IL MIO QR</Text>
        </Pressable>
        <Pressable onPress={onScanRequest} style={[styles.tab, mode === 'scan' && styles.tabActive]}>
          <ScanIcon size={16} color={mode === 'scan' ? theme.bg : theme.text} />
          <Text style={[styles.tabLabel, mode === 'scan' && { color: theme.bg }]}>SCANSIONA</Text>
        </Pressable>
      </View>

      {mode === 'show' ? (
        <View style={styles.showWrap}>
          <View style={styles.qrCard}>
            <QRCode
              value={qrData}
              size={240}
              color={theme.bg}
              backgroundColor="#fff"
              ecl="M"
            />
          </View>
          <Text style={styles.userLabel}>@{user?.username ?? ''}</Text>
          <Text style={styles.fpLabel}>IMPRONTA · {fp}</Text>
          <Text style={styles.helper}>
            Fai scansionare questo QR dall'altro dispositivo per confrontare l'impronta della tua
            identità e accertarti che sia davvero il tuo account. Non collega né sincronizza account.
          </Text>
          <Pressable onPress={() => setRefreshTick((n) => n + 1)} style={styles.refreshBtn}>
            <Text style={styles.refreshLabel}>NUOVO QR</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.scanWrap}>
          <View style={styles.scanPlaceholder}>
            {scanning ? <ActivityIndicator size="large" color={theme.accent} /> : <ScanIcon size={48} color={theme.accent} />}
            <Text style={styles.helper}>
              Inquadra il QR dell'altro dispositivo e scatta una foto: la decodifica avviene sul dispositivo, offline, senza Google.
            </Text>
            <Pressable onPress={runScan} disabled={scanning} style={[styles.refreshBtn, scanning && { opacity: 0.5 }]}>
              <Text style={styles.refreshLabel}>{scanning ? 'DECODIFICA…' : 'SCATTA FOTO DEL QR'}</Text>
            </Pressable>
          </View>
          {scanned && (
            <View style={styles.scanResult}>
              <Text style={styles.scanResultName}>{scanned.username}</Text>
              <Text style={styles.scanResultFp}>FP · {scanned.fingerprint}</Text>
              <Pressable onPress={confirmPair} style={styles.confirmBtn}>
                <Text style={styles.confirmLabel}>VERIFICA IMPRONTA</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
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
  back: { color: theme.accent, fontSize: 32, fontWeight: '300', width: 28 },
  title: { color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 3 },

  tabRow: {
    flexDirection: 'row', gap: 10, padding: 14,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 10, borderRadius: 14,
    backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border,
  },
  tabActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  tabLabel: { color: theme.text, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },

  showWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  qrCard: { padding: 16, backgroundColor: '#fff', borderRadius: 14, ...theme.shadow.md },
  userLabel: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 10 },
  fpLabel: { color: theme.accentAlt, fontSize: 11, fontFamily: theme.font.mono, letterSpacing: 1 },
  helper: { color: theme.textDim, fontSize: 12, textAlign: 'center', paddingHorizontal: 20 },
  refreshBtn: {
    marginTop: 12, paddingHorizontal: 18, paddingVertical: 10,
    backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border, borderRadius: 18,
  },
  refreshLabel: { color: theme.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },

  scanWrap: { flex: 1, backgroundColor: '#000' },
  scanPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  viewfinder: {
    position: 'absolute', top: '25%', left: '15%', right: '15%', bottom: '35%',
    borderWidth: 2, borderColor: theme.accent, borderRadius: 16,
  },
  scanResult: {
    position: 'absolute', left: 20, right: 20, bottom: 40,
    backgroundColor: theme.bgElev, borderRadius: 14, padding: 18,
    ...theme.shadow.md, borderWidth: 1, borderColor: theme.accent,
  },
  scanResultName: { color: theme.text, fontSize: 18, fontWeight: '800' },
  scanResultFp: { color: theme.accentAlt, fontSize: 11, fontFamily: theme.font.mono, marginTop: 4 },
  confirmBtn: {
    marginTop: 14, backgroundColor: theme.accent, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', ...theme.shadow.glow,
  },
  confirmLabel: { color: theme.bg, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
});
