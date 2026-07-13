import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Pressable, Switch, Alert, Image, Modal, TextInput } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { useAppDispatch, useAppSelector } from '@store/index';
import { logoutUser } from '@store/authSlice';
import { signal } from '@services/signal';
import { transport, TransportState } from '@services/transport';
import { isLockEnabled, enableLock, disableLock, setGraceSec, getGraceSec, getSupportedBiometry, hasDuressPin, setDuressPin, panicWipe, getDeadmanDays, setDeadmanDays } from '@services/appLock';
import { isScreenProtectEnabled, applyScreenProtect } from '@services/screenSecurity';
import { isNotifyContentHidden, setNotifyContentHidden } from '@services/notifications';
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
  const [screenProtect, setScreenProtect] = useState(isScreenProtectEnabled());
  const graceToKey = (g: number): '1'|'5'|'30'|'never' => (g >= 3.15e9 ? 'never' : g >= 1800 ? '30' : g >= 300 ? '5' : '1');
  const [autoLock, setAutoLock] = useState<'1'|'5'|'30'|'never'>(graceToKey(getGraceSec()));
  const [lockEnabled, setLockEnabled] = useState(isLockEnabled());
  const [biometry, setBiometry] = useState<string | null>(null);
  const [notifPreview, setNotifPreview] = useState(!isNotifyContentHidden());
  const [duressSet, setDuressSet] = useState(hasDuressPin());
  const [deadman, setDeadman] = useState(getDeadmanDays());
  const [duressModal, setDuressModal] = useState(false);
  const [duressInput, setDuressInput] = useState('');
  const [jailbroken, setJailbroken] = useState(false);
  const [antiCensorship, setAntiCensorship] = useState(transport.getManualEnabled());
  const [tunnelState, setTunnelState] = useState<TransportState>(transport.getState());

  useEffect(() => {
    DeviceInfo.getVersion && setAppVer(DeviceInfo.getVersion());
    DeviceInfo.isEmulator?.();
    (DeviceInfo as any).isJailBroken?.().then((v: boolean) => setJailbroken(!!v)).catch(() => {});
    getSupportedBiometry().then(setBiometry).catch(() => {});
    (async () => {
      await signal.initialize();
      const idk = signal.getIdentityPublicKeyB64();
      setFingerprint(sha256Hex(idk).slice(0, 40));
    })();
  }, []);

  // Attiva/disattiva il blocco app con biometria. In attivazione fa una verifica reale: se
  // l'utente non riesce a sbloccare (o non ha biometria/passcode) non si attiva (niente lock-out).
  const toggleAppLock = async (v: boolean) => {
    if (v) {
      const ok = await enableLock();
      if (!ok) {
        Alert.alert('Blocco app', 'Impossibile attivare. Configura impronta/Face ID o un codice di sblocco sul dispositivo, poi riprova.');
        setLockEnabled(false);
        return;
      }
      setLockEnabled(true);
    } else {
      await disableLock();
      setLockEnabled(false);
    }
  };

  const chooseAutoLock = (key: '1'|'5'|'30'|'never', sec: number) => { setAutoLock(key); setGraceSec(sec); };

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
    void applyScreenProtect(v); // FLAG_SECURE nativo (anti-screenshot)
  };

  const confirmLogout = () => Alert.alert('Esci', 'La sessione e le chiavi restano sul dispositivo.', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Esci', style: 'destructive', onPress: () => dispatch(logoutUser()) },
  ]);

  const saveDuress = () => {
    const pin = duressInput.trim();
    setDuressPin(pin || null);
    setDuressSet(!!pin);
    setDuressInput('');
    setDuressModal(false);
  };

  const confirmEmergencyWipe = () => Alert.alert(
    'Cancellazione d’emergenza',
    'Cancella IRREVERSIBILMENTE identità, chiavi, chat e gruppi da questo dispositivo. Non si può annullare. Procedere?',
    [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Cancella tutto', style: 'destructive', onPress: async () => { await panicWipe(); dispatch(logoutUser()); } },
    ],
  );

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.title}>IMPOSTAZIONI</Text>

        {jailbroken && (
          <View style={styles.warn}>
            <Text style={styles.warnTitle}>⚠ DISPOSITIVO COMPROMESSO</Text>
            <Text style={styles.warnText}>Rilevato root/jailbreak. Le garanzie di cifratura end-to-end potrebbero essere indebolite.</Text>
          </View>
        )}

        <Section title="Profilo">
          <Pressable style={styles.row} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.rowLabel}>Nome visualizzato</Text>
            <Text style={styles.rowValue}>{user?.displayName}</Text>
          </Pressable>
          <Row label="Nome utente" value={`@${user?.username ?? '—'}`} />
        </Section>

        <Section title="Sicurezza">
          <Row label="Cifratura" value="Double Ratchet · X25519 (X3DH)" />
          <Row label="Impronta identità" value={fingerprint} mono />
          <SwitchRow label="Sicurezza schermo" value={screenProtect} onChange={toggleScreenProtect} />
          <SwitchRow label={biometry ? `Blocco con ${biometry}` : 'Blocco app'} value={lockEnabled} onChange={toggleAppLock} />
          <Pressable style={styles.row} onPress={() => Alert.alert('Blocco automatico', 'Richiedi lo sblocco dopo:', [
            { text: 'Subito', onPress: () => chooseAutoLock('1', 0) },
            { text: '1 min', onPress: () => chooseAutoLock('1', 60) },
            { text: '5 min', onPress: () => chooseAutoLock('5', 300) },
            { text: '30 min', onPress: () => chooseAutoLock('30', 1800) },
            { text: 'Solo all’avvio', onPress: () => chooseAutoLock('never', 3.15e9) },
          ])}>
            <Text style={styles.rowLabel}>Blocco automatico</Text>
            <Text style={styles.rowValue}>{autoLock === 'never' ? 'Solo all’avvio' : autoLock === '1' && getGraceSec() === 0 ? 'Subito' : `${autoLock} min`}</Text>
          </Pressable>
          <SwitchRow label="Anteprima notifiche" value={notifPreview} onChange={(v) => { setNotifPreview(v); setNotifyContentHidden(!v); }} />
          <Pressable style={styles.row} onPress={() => setDuressModal(true)}>
            <Text style={styles.rowLabel}>PIN di coercizione</Text>
            <Text style={styles.rowValue}>{duressSet ? 'Impostato' : 'Non impostato'}</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={() => Alert.alert('Cancellazione automatica', 'Cancella tutto se l’app non viene aperta per:', [
            { text: 'Mai', onPress: () => { setDeadman(0); setDeadmanDays(0); } },
            { text: '7 giorni', onPress: () => { setDeadman(7); setDeadmanDays(7); } },
            { text: '30 giorni', onPress: () => { setDeadman(30); setDeadmanDays(30); } },
            { text: '90 giorni', onPress: () => { setDeadman(90); setDeadmanDays(90); } },
          ])}>
            <Text style={styles.rowLabel}>Cancellazione automatica (inattività)</Text>
            <Text style={styles.rowValue}>{deadman ? `${deadman} giorni` : 'Mai'}</Text>
          </Pressable>
        </Section>

        <Section title="Rete">
          <Row label="Regione" value={`${regionEntry?.flag ?? ''} ${region?.toUpperCase() ?? '—'}`} />
          <SwitchRow label="Anti-censura" value={antiCensorship} onChange={toggleAntiCensorship} />
          <Row label="Tunnel" value={tunnelLabel(tunnelState)} />
        </Section>

        <Section title="Info">
          <Image source={require('../assets/icons/ICONA 2.png')} style={styles.brandLogo} resizeMode="contain" />
          <Row label="Versione" value={appVer} />
          <Row label="Azienda" value="OLEVEN Technologies XSEC" />
        </Section>

        <Pressable style={styles.logout} onPress={confirmLogout}>
          <Text style={styles.logoutText}>ESCI</Text>
        </Pressable>

        <Pressable style={[styles.logout, { marginTop: 12 }]} onPress={confirmEmergencyWipe}>
          <Text style={styles.logoutText}>CANCELLAZIONE D’EMERGENZA</Text>
        </Pressable>
      </ScrollView>

      {/* Modal PIN di coercizione: se impostato, digitarlo sul blocco cancella tutto invece di aprire. */}
      <Modal visible={duressModal} transparent animationType="fade" onRequestClose={() => setDuressModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>PIN di coercizione</Text>
            <Text style={styles.modalHint}>
              Se qualcuno ti costringe a sbloccare l’app, digita questo PIN nella schermata di blocco:
              invece di aprire, cancellerà IRREVERSIBILMENTE tutti i dati. Lascia vuoto per disattivarlo.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={duressInput}
              onChangeText={setDuressInput}
              placeholder="PIN (4-8 cifre)"
              placeholderTextColor={theme.textDim}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={8}
            />
            <View style={styles.modalBtns}>
              <Pressable style={styles.modalBtnGhost} onPress={() => { setDuressInput(''); setDuressModal(false); }}><Text style={styles.modalBtnGhostLabel}>ANNULLA</Text></Pressable>
              <Pressable style={styles.modalBtnPrimary} onPress={saveDuress}><Text style={styles.modalBtnPrimaryLabel}>SALVA</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

function tunnelLabel(s: TransportState): string {
  switch (s) {
    case 'connected': return 'Connesso';
    case 'connecting': return 'Connessione…';
    case 'error': return 'Errore';
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
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  modalCard: { width: '100%', backgroundColor: theme.bgElev, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 20 },
  modalTitle: { color: theme.text, fontSize: 16, fontWeight: '900', marginBottom: 8 },
  modalHint: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginBottom: 14 },
  modalInput: { height: 46, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, color: theme.text, paddingHorizontal: 12, fontSize: 16, letterSpacing: 3 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalBtnGhost: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' },
  modalBtnGhostLabel: { color: theme.textDim, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  modalBtnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.accent, alignItems: 'center' },
  modalBtnPrimaryLabel: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
});
