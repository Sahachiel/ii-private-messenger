import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Pressable, Alert, Animated, Easing, ActivityIndicator } from 'react-native';
import { useDispatch } from 'react-redux';
import { useDeviceHealth } from '@/xsec-mtd/hooks/useDeviceHealth';
import { useMtdEvents } from '@/xsec-mtd/hooks/useMtdEvents';
import { logoutUser } from '@store/authSlice';
import { KC, appKv, getSecureKv } from '@services/keychain';
import { theme } from '@utils/theme';
import { ShieldIcon, ScanIcon } from '@components/Icons';
import { ThreatCategory } from '@/xsec-mtd/types';
import dayjs from 'dayjs';

const STATE_META: Record<'secure'|'warning'|'compromised', { color: string; label: string; caption: string }> = {
  secure:      { color: theme.success, label: 'SECURE',      caption: 'No threats detected' },
  warning:     { color: theme.warning, label: 'WARNING',     caption: 'Review recent events' },
  compromised: { color: theme.alert,   label: 'COMPROMISED', caption: 'Messaging disabled — take action' },
};

const CATEGORY_LABEL: Record<ThreatCategory, string> = {
  root_jailbreak: 'Root / Jailbreak',
  debugger:       'Debugger',
  ssl_pinning:    'SSL Pinning',
  mitm:           'MITM Proxy',
  wifi:           'Wi-Fi Network',
  app_blocklist:  'Installed Apps',
  mdm_profile:    'MDM Profile',
  phishing:       'Phishing',
  memory_tamper:  'Memory Tamper',
};

export const ShieldScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { state, score, lastScan, scanning, progress, rescan } = useDeviceHealth();
  const { events } = useMtdEvents();
  const dispatch = useDispatch<any>();
  const meta = STATE_META[state];
  const unackCount = events.filter((e) => !e.ack).length;
  const recent = events.slice(0, 3);

  // Pulsing ring animation around state card when scanning
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (scanning) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    return undefined;
  }, [scanning, pulse]);

  const wipe = async (): Promise<void> => {
    try {
      await KC.clearToken(); await KC.clearCreds(); await KC.clearIdentity();
      (await getSecureKv()).clearAll();
      appKv.clearAll();
      await dispatch(logoutUser());
    } catch (e: any) { Alert.alert('Wipe failed', e?.message ?? 'unknown'); }
  };

  const pulseStyle = {
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
    opacity:   pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }),
  };

  const planCategories: ThreatCategory[] = progress?.total
    ? ['root_jailbreak', 'debugger', 'ssl_pinning', 'mitm', 'wifi', 'app_blocklist', 'mdm_profile'].slice(0, progress.total) as ThreatCategory[]
    : ['root_jailbreak', 'debugger', 'ssl_pinning', 'mitm', 'wifi', 'app_blocklist', 'mdm_profile'];

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View style={styles.header}>
          <ShieldIcon size={22} color={theme.accent} />
          <Text style={styles.title}>SHIELD</Text>
        </View>

        {/* Device state card */}
        <View style={styles.stateWrap}>
          {scanning && <Animated.View style={[styles.pulseRing, { borderColor: meta.color }, pulseStyle]} />}
          <View style={[styles.stateCard, { borderColor: meta.color }]}>
            <Text style={[styles.stateLabel, { color: meta.color }]}>{meta.label}</Text>
            <Text style={styles.score}>{score}<Text style={styles.scoreMax}>/100</Text></Text>
            <Text style={styles.caption}>{meta.caption}</Text>
            <Text style={styles.lastScan}>
              {scanning
                ? `SCANNING · ${progress?.completed.length ?? 0}/${progress?.total ?? 7}`
                : `Last scan · ${lastScan ? dayjs(lastScan).format('HH:mm:ss') : 'never'}`}
            </Text>
          </View>
        </View>

        {/* Scan button with live state */}
        <Pressable
          style={[styles.scanBtn, scanning && styles.scanBtnBusy]}
          onPress={scanning ? undefined : rescan}
          android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
          disabled={scanning}
        >
          {scanning ? (
            <>
              <ActivityIndicator color={theme.bg} size="small" />
              <Text style={styles.scanBtnLabel}>
                {progress?.detector ? `Checking ${CATEGORY_LABEL[progress.detector]}…` : 'Scanning…'}
              </Text>
            </>
          ) : (
            <>
              <ScanIcon size={18} color={theme.bg} />
              <Text style={styles.scanBtnLabel}>RUN FULL SCAN</Text>
            </>
          )}
        </Pressable>

        {/* Detector checklist */}
        <View style={styles.detectorList}>
          <Text style={styles.sectionHead}>DETECTORS</Text>
          {planCategories.map((cat) => {
            const done = progress?.completed.includes(cat);
            const current = scanning && progress?.detector === cat;
            const hasEvent = events.some((e) => e.category === cat && !e.ack);
            return (
              <View key={cat} style={styles.detectorRow}>
                <View style={[styles.detectorDot,
                  current ? { backgroundColor: theme.accentAlt } :
                  done    ? { backgroundColor: hasEvent ? theme.warning : theme.success } :
                            { backgroundColor: theme.border }]} />
                <Text style={styles.detectorName}>{CATEGORY_LABEL[cat]}</Text>
                <Text style={[styles.detectorStatus,
                  current ? { color: theme.accentAlt } :
                  done    ? { color: hasEvent ? theme.warning : theme.success } :
                            { color: theme.textMute }]}>
                  {current ? '…' : done ? (hasEvent ? 'WARN' : 'OK') : '—'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Tiles row */}
        <View style={styles.row}>
          <Pressable style={styles.tile} onPress={() => navigation.navigate('ShieldLog')}>
            <Text style={styles.tileLabel}>EVENT LOG</Text>
            <Text style={styles.tileValue}>{unackCount}<Text style={styles.tileUnit}> unread</Text></Text>
          </Pressable>
          <Pressable style={styles.tile} onPress={() => navigation.navigate('ShieldSettings')}>
            <Text style={styles.tileLabel}>SETTINGS</Text>
            <Text style={styles.tileValue}>⚙</Text>
          </Pressable>
        </View>

        {/* Recent events preview */}
        {recent.length > 0 && (
          <View style={styles.recentWrap}>
            <Text style={styles.sectionHead}>RECENT EVENTS</Text>
            {recent.map((e) => (
              <View key={e.id} style={styles.recentRow}>
                <View style={[styles.recentDot, {
                  backgroundColor: e.severity === 'compromised' ? theme.alert : e.severity === 'warning' ? theme.warning : theme.success,
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentTitle} numberOfLines={1}>{e.title}</Text>
                  <Text style={styles.recentTime}>{dayjs(e.ts).format('HH:mm · MMM D')}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Troubleshoot */}
        <Pressable style={styles.troubleshoot} onPress={() => navigation.navigate('ShieldTroubleshoot')}>
          <Text style={styles.troubleshootLabel}>TROUBLESHOOT / EXPORT REPORT</Text>
          <Text style={styles.troubleshootHint}>Send encrypted report to Oleven admin</Text>
        </Pressable>

        {state === 'compromised' && (
          <Pressable
            style={styles.emergency}
            onPress={() => Alert.alert('Wipe keys', 'Delete all chat keys and sessions? You will need to re-register.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Wipe', style: 'destructive', onPress: wipe },
            ])}
          >
            <Text style={styles.emergencyText}>EMERGENCY WIPE</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  title: { color: theme.text, fontSize: 16, fontWeight: '900', letterSpacing: 3 },

  stateWrap: { position: 'relative', marginBottom: 16 },
  pulseRing: { position: 'absolute', top: -6, left: -6, right: -6, bottom: -6, borderRadius: theme.radiusLg, borderWidth: 2 },
  stateCard: {
    borderWidth: 2, padding: 22, alignItems: 'center', borderRadius: theme.radiusLg,
    backgroundColor: theme.bgElev, ...theme.shadow.md,
  },
  stateLabel: { fontSize: 14, fontWeight: '900', letterSpacing: 4, marginBottom: 10 },
  score: { color: theme.text, fontSize: 52, fontWeight: '900', letterSpacing: -1 },
  scoreMax: { color: theme.textDim, fontSize: 18, fontWeight: '400' },
  caption: { color: theme.textDim, fontSize: 13, marginTop: 6, textAlign: 'center' },
  lastScan: { color: theme.textMute, fontSize: 10, letterSpacing: 1.5, marginTop: 12, textTransform: 'uppercase' },

  scanBtn: {
    backgroundColor: theme.accent, borderRadius: theme.radius, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    marginBottom: 20, ...theme.shadow.glow,
  },
  scanBtnBusy: { opacity: 0.85 },
  scanBtnLabel: { color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 2 },

  sectionHead: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '700', marginBottom: 10 },
  detectorList: {
    backgroundColor: theme.bgElev, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border,
    padding: 14, marginBottom: 16,
  },
  detectorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  detectorDot: { width: 8, height: 8, borderRadius: 4 },
  detectorName: { flex: 1, color: theme.text, fontSize: 13 },
  detectorStatus: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  row: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  tile: {
    flex: 1, backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border,
    borderRadius: theme.radius, padding: 16, alignItems: 'center',
  },
  tileLabel: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '900', marginBottom: 8 },
  tileValue: { color: theme.accent, fontSize: 28, fontWeight: '900' },
  tileUnit: { color: theme.textDim, fontSize: 13, fontWeight: '400' },

  recentWrap: {
    backgroundColor: theme.bgElev, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border,
    padding: 14, marginBottom: 16,
  },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  recentDot: { width: 6, height: 6, borderRadius: 3 },
  recentTitle: { color: theme.text, fontSize: 13, fontWeight: '500' },
  recentTime: { color: theme.textMute, fontSize: 11, marginTop: 2 },

  troubleshoot: {
    backgroundColor: theme.bgElev, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border,
    padding: 14, marginBottom: 14,
  },
  troubleshootLabel: { color: theme.accent, fontSize: 12, letterSpacing: 2, fontWeight: '900' },
  troubleshootHint: { color: theme.textDim, fontSize: 11, marginTop: 4 },

  emergency: {
    borderWidth: 2, borderColor: theme.alert, borderRadius: theme.radius,
    padding: 16, marginTop: 10, alignItems: 'center', backgroundColor: 'rgba(255,75,110,0.08)',
  },
  emergencyText: { color: theme.alert, fontSize: 14, fontWeight: '900', letterSpacing: 3 },
});
