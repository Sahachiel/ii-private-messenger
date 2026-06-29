import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Alert } from 'react-native';
import { Input } from '@components/Input';
import { Button } from '@components/Button';
import { CountryPicker } from '@components/CountryPicker';
import { useAppDispatch, useAppSelector } from '@store/index';
import { registerUser } from '@store/authSlice';
import { getRegionForCountry, COUNTRY_LIST } from '@utils/countries';
import { theme } from '@utils/theme';

export const RegisterScreen: React.FC<{ navigation: any; route: any }> = ({ route }) => {
  const dispatch = useAppDispatch();
  const loading = useAppSelector((s) => s.auth.isLoading);
  const error = useAppSelector((s) => s.auth.error);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [country, setCountry] = useState<string>(route.params?.country ?? 'QA');

  const region = getRegionForCountry(country);
  const countryEntry = COUNTRY_LIST.find((c) => c.code === country);

  const pwScore = useMemo(() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  }, [password]);
  const pwColor = pwScore <= 1 ? theme.alert : pwScore <= 3 ? theme.warning : theme.success;
  const pwLabel = pwScore <= 1 ? 'WEAK' : pwScore <= 3 ? 'OK' : 'STRONG';

  const submit = async () => {
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return Alert.alert('Error', 'Username: 3–32 chars, alphanumeric/underscore');
    if (!displayName.trim()) return Alert.alert('Error', 'Display name required');
    if (password.length < 8) return Alert.alert('Error', 'Password minimum 8 chars');
    if (password !== confirm) return Alert.alert('Error', 'Passwords do not match');
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) return Alert.alert('Error', 'Phone must be E.164 (+country...)');

    try {
      await dispatch(registerUser({ username, displayName, password, phone: phone || undefined, countryCode: country })).unwrap();
    } catch (e: any) {
      Alert.alert('Registration failed', typeof e === 'string' ? e : (e?.message ?? 'unknown'));
    }
  };

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={styles.title}>CREATE IDENTITY</Text>
        <Text style={styles.sub}>Keys are generated on-device. Nothing private leaves this phone.</Text>

        <Input label="Username" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
        <Input label="Display Name" value={displayName} onChangeText={setDisplayName} />
        <Input label="Phone (optional, E.164)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        <Input label="Password" secureTextEntry value={password} onChangeText={setPassword} />
        {password.length > 0 && (
          <View style={styles.pwBar}>
            <View style={[styles.pwFill, { backgroundColor: pwColor, width: `${(pwScore / 5) * 100}%` }]} />
            <Text style={[styles.pwLabel, { color: pwColor }]}>{pwLabel}</Text>
          </View>
        )}
        <Input label="Confirm Password" secureTextEntry value={confirm} onChangeText={setConfirm} />
        <CountryPicker value={country} onChange={setCountry} />

        <Text style={styles.region}>
          Your communications will be routed through: {countryEntry?.flag} <Text style={styles.regionAccent}>{region.toUpperCase()}</Text>
        </Text>

        {error && <Text style={styles.err}>{error}</Text>}

        <Button title="Generate & Register" onPress={submit} loading={loading} style={{ marginTop: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 22, fontWeight: '900', letterSpacing: 3 },
  sub: { color: theme.textDim, fontSize: 13, marginBottom: 24, marginTop: 6 },
  pwBar: { height: 6, backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border, marginBottom: 6, marginTop: -10, position: 'relative' },
  pwFill: { height: '100%' },
  pwLabel: { position: 'absolute', right: 0, top: -18, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  region: { color: theme.textDim, fontSize: 13, marginTop: 8 },
  regionAccent: { color: theme.accent, fontWeight: '900', letterSpacing: 2 },
  err: { color: theme.alert, marginTop: 12, fontSize: 12 },
});
