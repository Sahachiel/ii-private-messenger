import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Alert, Pressable } from 'react-native';
import { Input } from '@components/Input';
import { Button } from '@components/Button';
import { useAppDispatch, useAppSelector } from '@store/index';
import { loginUser, biometricLogin } from '@store/authSlice';
import { KC } from '@services/keychain';
import { theme } from '@utils/theme';

export const LoginScreen: React.FC = () => {
  const dispatch = useAppDispatch();
  const loading = useAppSelector((s) => s.auth.isLoading);
  const error = useAppSelector((s) => s.auth.error);
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [biometric, setBiometric] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const t = await KC.getSupportedBiometry();
      const creds = await KC.getCreds();
      if (t && creds) setBiometric(String(t));
    })();
  }, []);

  const submit = async () => {
    try { await dispatch(loginUser({ username, password })).unwrap(); }
    catch (e: any) { Alert.alert('Accesso fallito', typeof e === 'string' ? e : e?.message ?? 'errore sconosciuto'); }
  };

  const bio = async () => {
    try { await dispatch(biometricLogin()).unwrap(); }
    catch (e: any) { Alert.alert('Biometria fallita', typeof e === 'string' ? e : e?.message ?? 'errore sconosciuto'); }
  };

  return (
    <SafeAreaView style={styles.c}>
      <View style={{ padding: 24 }}>
        <Text style={styles.title}>ACCEDI</Text>
        <Input label="Nome utente" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setU} />
        <Input label="Password" secureTextEntry value={password} onChangeText={setP} />
        {error && <Text style={styles.err}>{error}</Text>}
        <Button title="Accedi" onPress={submit} loading={loading} style={{ marginTop: 12 }} />
        {biometric && (
          <Pressable onPress={bio} style={styles.bio}>
            <Text style={styles.bioText}>USA {biometric.toUpperCase()}</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 22, fontWeight: '900', letterSpacing: 3, marginBottom: 24 },
  err: { color: theme.alert, marginBottom: 8, fontSize: 12 },
  bio: { marginTop: 24, padding: 14, borderWidth: 1, borderColor: theme.accent, alignItems: 'center' },
  bioText: { color: theme.accent, fontWeight: '900', letterSpacing: 2 },
});
