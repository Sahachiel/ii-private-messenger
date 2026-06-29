import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Pressable, Switch, Alert, Image } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { useAppDispatch, useAppSelector } from '@store/index';
import { logoutUser } from '@store/authSlice';
import { signal } from '@services/signal';
import { transport, TransportState } from '@services/transport';
import { theme } from '@utils/theme';
import { COUNTRY_LIST } from '@utils/countries';
import { sha256Hex } from '@utils/crypto';

export const SettingsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const region = useAppSelector((s) => s.auth.region);
  const proxyConfig = useAppSelector((s) => s.auth.proxyConfig);
  const regionEntry = COUNTRY_LIST.find((c) => c.region === region);

  const [appVer, setAppVer] = useState('—');
  const [fingerprint, setFingerprint] = useState('—');
  const [screenProtect, setScreenProtect] = useState(true);
  const [autoLock, setAutoLock] = useState<'1'|'5'|'30'|'never'>('5');
  const [jailbroken, setJailbroken] = useState(false);
  const [antiCensorship, setAntiCensorship] = useState(transport.getManualEnabled());
  const [tunnelState, setTunnelState] = useState<TransportState>(transport.getState());

  useEffect(() => {
    DeviceInfo.getVersion && setAppVer(DeviceInfo.getVersion());
    DeviceInfo.isEmulator?.();
    (DeviceInfo as any).isJailBroken?.().then((v: boolean) => setJailbroken(!!v)).catch(() => {});
    (async () => {
      await signal.initialize();
      const idk = signal.getIdentityPublicKeyB64();
      setFingerprint(sha256Hex(idk).slice(0, 40));
    })();
  }, []);

  useEffect(() => transport.onState(setTunnelState), []);

  // Toggle del tunnel anti-censura per-app. Persiste la preferenza manuale; all'attivazione
  // chiede il consenso VPN di sistema (una tantum) e avvia il tunnel con la proxy_config
  // ricevuta dal backend per la region (o l'ultima salvata).
  const toggleAntiCensorship = async (v: boolean) => {
    setAntiCensorship(v);
    transport.setManualEnabled(v);
    if (!v) { await transport.stop(); return; }
    if (!transport.isAvailable()) {
      Alert.alert('Anti-Censorship', 'Il modulo di trasporto sicuro non è incluso in questa build. Sarà disponibile nella prossima release Android.');
      return;
    }
    const cfg = proxyConfig ?? transport.getLastConfig();
    if (!cfg) {
      Alert.alert('Anti-Censorship', 'Nessuna configurazione disponibile per la tua region.');
      return;
    }
    const granted = await transport.prepare();
    if (!granted) { setAntiCensorship(false); transport.setManualEnabled(false); return; }
    await transport.start(cfg);
  };

  const toggleScreenProtect = (v: boolean) => {
    setScreenProtect(v);
  };

  const confirmLogout = () => Alert.alert('Sign out', 'Your session and keys remain on device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => dispatch(logoutUser()) },
  ]);

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.title}>SETTINGS</Text>

        {jailbroken && (
          <View style={styles.warn}>
            <Text style={styles.warnTitle}>⚠ COMPROMISED DEVICE</Text>
            <Text style={styles.warnText}>Root/jailbreak detected. End-to-end encryption guarantees may be weakened.</Text>
          </View>
        )}

        <Section title="Profile">
          <Pressable style={styles.row} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.rowLabel}>Display Name</Text>
            <Text style={styles.rowValue}>{user?.displayName}</Text>
          </Pressable>
          <Row label="Username" value={`@${user?.username ?? '—'}`} />
        </Section>

        <Section title="Security">
          <Row label="Encryption" value="Signal Protocol (X3DH)" />
          <Row label="Identity Fingerprint" value={fingerprint} mono />
          <SwitchRow label="Screen Security" value={screenProtect} onChange={toggleScreenProtect} />
          <Pressable style={styles.row} onPress={() => Alert.alert('Auto-lock', '', [
            { text: '1 min', onPress: () => setAutoLock('1') },
            { text: '5 min', onPress: () => setAutoLock('5') },
            { text: '30 min', onPress: () => setAutoLock('30') },
            { text: 'Never', onPress: () => setAutoLock('never') },
          ])}>
            <Text style={styles.rowLabel}>Auto-lock</Text>
            <Text style={styles.rowValue}>{autoLock === 'never' ? 'Never' : `${autoLock} min`}</Text>
          </Pressable>
        </Section>

        <Section title="Routing">
          <Row label="Region" value={`${regionEntry?.flag ?? ''} ${region?.toUpperCase() ?? '—'}`} />
          <SwitchRow label="Anti-Censorship" value={antiCensorship} onChange={toggleAntiCensorship} />
          <Row label="Tunnel" value={tunnelLabel(tunnelState)} />
        </Section>

        <Section title="About">
          <Image source={require('../assets/icons/ICONA 2.png')} style={styles.brandLogo} resizeMode="contain" />
          <Row label="Version" value={appVer} />
          <Row label="Company" value="OLEVEN Technologies XSEC" />
        </Section>

        <Pressable style={styles.logout} onPress={confirmLogout}>
          <Text style={styles.logoutText}>SIGN OUT</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

function tunnelLabel(s: TransportState): string {
  switch (s) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting…';
    case 'error': return 'Error';
    default: return 'Off';
  }
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, mono && { fontFamily: theme.font.mono, fontSize: 10 }]} numberOfLines={1}>{value}</Text>
  </View>
);

const SwitchRow: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Switch value={value} onValueChange={onChange} trackColor={{ false: theme.border, true: theme.accent }} thumbColor={theme.bg} />
  </View>
);

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 18, fontWeight: '900', letterSpacing: 3, marginBottom: 20 },
  section: { marginBottom: 20 },
  sectionTitle: { color: theme.accent, fontSize: 11, fontWeight: '900', letterSpacing: 3, marginBottom: 8, marginTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 12 },
  rowLabel: { color: theme.textDim, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' },
  rowValue: { color: theme.text, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  logout: { marginTop: 40, padding: 14, borderWidth: 1, borderColor: theme.alert, alignItems: 'center' },
  logoutText: { color: theme.alert, fontWeight: '900', letterSpacing: 3 },
  brandLogo: { width: 72, height: 72, alignSelf: 'center', marginVertical: 12 },
  warn: { borderWidth: 1, borderColor: theme.alert, padding: 12, marginBottom: 20 },
  warnTitle: { color: theme.alert, fontWeight: '900', letterSpacing: 2, fontSize: 12 },
  warnText: { color: theme.textDim, fontSize: 12, marginTop: 6 },
});
