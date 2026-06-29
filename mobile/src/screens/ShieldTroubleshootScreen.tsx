import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Alert, ScrollView } from 'react-native';
import { Button } from '@components/Button';
import { sendOrgReport } from '@/xsec-mtd/orgReport';
import { fetchAdminPubkey } from '@/xsec-mtd/sync/mirrorClient';
import { theme } from '@utils/theme';

export const ShieldTroubleshootScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [admin, setAdmin] = useState<{ public_key_b64: string; fingerprint: string } | null>(null);

  useEffect(() => { fetchAdminPubkey().then(setAdmin); }, []);

  const submit = async () => {
    setLoading(true);
    const r = await sendOrgReport();
    setLoading(false);
    if (r.id) Alert.alert('Report sent', `ID: ${r.id.slice(0, 8)}…`);
    else Alert.alert('Send failed', r.error ?? 'unknown');
  };

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.title}>TROUBLESHOOT</Text>
        <Text style={styles.p}>
          Exports the full MTD event log and device health status as an encrypted report,
          readable only by the Oleven security admin. No data leaves the device in plaintext.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>ADMIN RECIPIENT</Text>
          {admin ? (
            <>
              <Text style={styles.mono} numberOfLines={1}>{admin.public_key_b64.slice(0, 40)}…</Text>
              <Text style={styles.fp}>fingerprint: {admin.fingerprint.slice(0, 32)}…</Text>
            </>
          ) : (
            <Text style={styles.loading}>fetching admin key…</Text>
          )}
        </View>

        <Button title="SEND ENCRYPTED REPORT" onPress={submit} loading={loading} style={{ marginTop: 16 }} disabled={!admin} />

        <Text style={styles.note}>
          Report includes: event log (last 500 events), policy settings, device state, health score, user ID.
          Encrypted with admin's Ed25519 key, signed with your identity key.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 16, fontWeight: '900', letterSpacing: 3, marginBottom: 16 },
  p: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginBottom: 20 },
  card: { backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border, padding: 14 },
  cardLabel: { color: theme.accent, fontSize: 10, letterSpacing: 2, fontWeight: '900', marginBottom: 6 },
  mono: { color: theme.text, fontSize: 11, fontFamily: theme.font.mono },
  fp: { color: theme.textDim, fontSize: 10, fontFamily: theme.font.mono, marginTop: 4 },
  loading: { color: theme.textDim, fontSize: 12 },
  note: { color: theme.textMute, fontSize: 11, lineHeight: 17, marginTop: 24 },
});
