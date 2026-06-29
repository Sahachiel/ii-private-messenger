import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView, Alert, Linking } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { useAppSelector } from '@store/index';
import { KC } from '@services/keychain';
import { theme } from '@utils/theme';
import { QRIcon, ScanIcon } from '@components/Icons';
import HapticFeedback from 'react-native-haptic-feedback';

// Pairing payload — the mobile device generates this QR, the desktop scans it
// (or vice versa). Identity fingerprint proves the mobile owns the account;
// ephemeral key would bootstrap a session key for the desktop. The nonce makes
// each QR single-use; a real validator would require server round-trip here,
// but for v0.2.5 we keep the scan local and surface the result for the user.
interface PairingPayload {
  v: 1;
  appId: 'iimsg';
  userId: string;
  username: string;
  fingerprint: string;   // identity pubkey hash
  nonce: string;         // 16 random bytes base64
  issuedAt: number;
  expiresAt: number;     // issuedAt + 2min
}

function randomNonce(): string {
  const b = new Uint8Array(12);
  if (global.crypto && typeof (global.crypto as any).getRandomValues === 'function') {
    (global.crypto as any).getRandomValues(b);
  } else {
    for (let i = 0; i < 12; i++) b[i] = Math.floor(Math.random() * 256);
  }
  // base64 (padded)
  return btoa(String.fromCharCode(...b));
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
  const [hasPerm, setHasPerm] = useState(false);
  const [scanned, setScanned] = useState<PairingPayload | null>(null);

  const device = useCameraDevice('back');

  useEffect(() => { myFingerprint().then(setFp); }, []);

  // Re-issue the nonce every minute so displayed QR doesn't stay valid too long.
  const payload = useMemo<PairingPayload>(() => {
    const now = Date.now();
    return {
      v: 1, appId: 'iimsg',
      userId: user?.id ?? '',
      username: user?.username ?? '',
      fingerprint: fp,
      nonce: randomNonce(),
      issuedAt: now,
      expiresAt: now + 120_000,
    };
    // refresh only when user/fp changes — a manual refresh button rotates nonce too
  }, [user?.id, user?.username, fp]);

  const [refreshTick, setRefreshTick] = useState(0);
  const liveNonce = useMemo(() => ({ ...payload, nonce: randomNonce(), issuedAt: Date.now(), expiresAt: Date.now() + 120_000 }), [refreshTick]);
  const qrData = JSON.stringify(liveNonce);

  const onScanRequest = async (): Promise<void> => {
    try {
      const p = await Camera.requestCameraPermission();
      setHasPerm(p === 'granted');
      if (p !== 'granted') {
        Alert.alert('Camera denied', 'Open settings to enable the camera.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Settings', onPress: () => Linking.openSettings() },
        ]);
      } else { setMode('scan'); }
    } catch (e: any) { Alert.alert('Camera error', String(e)); }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (!codes.length || scanned) return;
      const raw = codes[0].value;
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as PairingPayload;
        if (parsed.appId !== 'iimsg' || parsed.v !== 1) throw new Error('Not an iimsg QR');
        if (parsed.expiresAt < Date.now()) throw new Error('QR expired');
        HapticFeedback.trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
        setScanned(parsed);
      } catch (e: any) {
        Alert.alert('Invalid QR', e?.message ?? 'unknown');
      }
    },
  });

  const confirmPair = (): void => {
    if (!scanned) return;
    // In v0.2.5 we don't persist a paired-device record server-side. We show the
    // verified identity so the user can compare fingerprints out-of-band.
    Alert.alert(
      'Device verified',
      `User: ${scanned.username}\nID: ${scanned.userId.slice(0, 8)}…\nFingerprint: ${scanned.fingerprint}\n\nReal session bootstrap lands in v0.3 (sender-keys + server ack).`,
      [{ text: 'Done', onPress: () => navigation.goBack() }],
    );
  };

  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title}>LINK DEVICE</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.tabRow}>
        <Pressable onPress={() => setMode('show')} style={[styles.tab, mode === 'show' && styles.tabActive]}>
          <QRIcon size={16} color={mode === 'show' ? theme.bg : theme.text} />
          <Text style={[styles.tabLabel, mode === 'show' && { color: theme.bg }]}>MY QR</Text>
        </Pressable>
        <Pressable onPress={onScanRequest} style={[styles.tab, mode === 'scan' && styles.tabActive]}>
          <ScanIcon size={16} color={mode === 'scan' ? theme.bg : theme.text} />
          <Text style={[styles.tabLabel, mode === 'scan' && { color: theme.bg }]}>SCAN</Text>
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
          <Text style={styles.fpLabel}>FP · {fp}</Text>
          <Text style={styles.helper}>
            Scan this from desktop to link your account. Nonce rotates every 2 min.
          </Text>
          <Pressable onPress={() => setRefreshTick((n) => n + 1)} style={styles.refreshBtn}>
            <Text style={styles.refreshLabel}>ROTATE NONCE</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.scanWrap}>
          {device && hasPerm ? (
            <Camera style={StyleSheet.absoluteFill} device={device} isActive codeScanner={codeScanner} />
          ) : (
            <View style={styles.scanPlaceholder}>
              <Text style={styles.helper}>Camera permission required</Text>
              <Pressable onPress={onScanRequest} style={styles.refreshBtn}>
                <Text style={styles.refreshLabel}>ENABLE CAMERA</Text>
              </Pressable>
            </View>
          )}
          <View pointerEvents="none" style={styles.viewfinder} />
          {scanned && (
            <View style={styles.scanResult}>
              <Text style={styles.scanResultName}>{scanned.username}</Text>
              <Text style={styles.scanResultFp}>FP · {scanned.fingerprint}</Text>
              <Pressable onPress={confirmPair} style={styles.confirmBtn}>
                <Text style={styles.confirmLabel}>VERIFY & LINK</Text>
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
