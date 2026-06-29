import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Switch } from 'react-native';
import { loadPolicy, updatePolicy } from '@/xsec-mtd/policy';
import { mtd } from '@/xsec-mtd/engine/MTDEngine';
import { ThreatCategory } from '@/xsec-mtd/types';
import { theme } from '@utils/theme';

const LABELS: Record<ThreatCategory, string> = {
  root_jailbreak: 'Root / Jailbreak',
  debugger: 'Debugger / Frida',
  ssl_pinning: 'SSL pinning',
  mitm: 'MITM / proxy',
  wifi: 'Wi-Fi threats',
  app_blocklist: 'Malicious apps',
  mdm_profile: 'Unauthorized MDM',
  phishing: 'Phishing links',
  memory_tamper: 'Memory tampering',
};

export const ShieldSettingsScreen: React.FC = () => {
  const [policy, setP] = useState(loadPolicy());

  const toggleCat = (cat: ThreatCategory) => {
    const next = updatePolicy({ enabled: { ...policy.enabled, [cat]: !policy.enabled[cat] } });
    setP(next); mtd.reloadPolicy();
  };
  const toggleFlag = (k: 'autoWipeOnCompromise' | 'blockSendOnCompromise' | 'orgReporting' | 'phishingLinkScan') => {
    const next = updatePolicy({ [k]: !policy[k] } as any);
    setP(next); mtd.reloadPolicy();
  };

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.title}>SHIELD SETTINGS</Text>

        <Text style={styles.section}>DETECTORS</Text>
        {(Object.keys(LABELS) as ThreatCategory[]).map((cat) => (
          <Row key={cat} label={LABELS[cat]} value={policy.enabled[cat]} onChange={() => toggleCat(cat)} />
        ))}

        <Text style={styles.section}>RESPONSE</Text>
        <Row label="Block sending when compromised" value={policy.blockSendOnCompromise} onChange={() => toggleFlag('blockSendOnCompromise')} />
        <Row label="Scan chat links for phishing" value={policy.phishingLinkScan} onChange={() => toggleFlag('phishingLinkScan')} />
        <Row label="Auto-wipe keys on compromise" value={policy.autoWipeOnCompromise} onChange={() => toggleFlag('autoWipeOnCompromise')} warning />

        <Text style={styles.section}>REPORTING</Text>
        <Row label="Send encrypted reports to Oleven admin" value={policy.orgReporting} onChange={() => toggleFlag('orgReporting')} />
      </ScrollView>
    </SafeAreaView>
  );
};

const Row: React.FC<{ label: string; value: boolean; onChange: () => void; warning?: boolean }> = ({ label, value, onChange, warning }) => (
  <View style={styles.row}>
    <Text style={[styles.rowLabel, warning && { color: theme.alert }]}>{label}</Text>
    <Switch value={value} onValueChange={onChange} trackColor={{ false: theme.border, true: theme.accent }} thumbColor={theme.bg} />
  </View>
);

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 16, fontWeight: '900', letterSpacing: 3, marginBottom: 20 },
  section: { color: theme.accent, fontSize: 11, fontWeight: '900', letterSpacing: 3, marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  rowLabel: { color: theme.text, fontSize: 13, flex: 1, marginRight: 12 },
});
