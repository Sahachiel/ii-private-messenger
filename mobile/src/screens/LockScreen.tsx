import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image, TextInput } from 'react-native';
import { theme } from '@utils/theme';
import { hasDuressPin, isDuressPin } from '@services/appLock';

/**
 * Schermata di blocco a copertura totale. Sblocco normale = biometria. Se è impostato un PIN di
 * COERCIZIONE, un piccolo campo permette di digitarlo: se corrisponde, l'app NON si apre ma
 * cancella tutto (onDuress) e appare vuota — utile se qualcuno costringe ad aprire.
 */
export const LockScreen: React.FC<{ onUnlock: () => void; onDuress: () => void; biometry?: string | null }> = ({ onUnlock, onDuress, biometry }) => {
  const label = biometry ? `SBLOCCA CON ${String(biometry).toUpperCase()}` : 'SBLOCCA';
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);

  const submitPin = (): void => {
    if (isDuressPin(pin)) { setPin(''); onDuress(); return; }
    setPin(''); // PIN non valido: nessun effetto (lo sblocco vero è biometrico)
  };

  return (
    <View style={styles.c}>
      <Image source={require('../assets/icons/ICONA 2.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>II Private Messenger</Text>
      <Text style={styles.sub}>App bloccata</Text>
      <Pressable style={styles.btn} onPress={onUnlock}>
        <Text style={styles.btnLabel}>{label}</Text>
      </Pressable>

      {hasDuressPin() && (
        showPin ? (
          <View style={styles.pinRow}>
            <TextInput
              style={styles.pinInput}
              value={pin}
              onChangeText={setPin}
              placeholder="PIN"
              placeholderTextColor={theme.textDim}
              secureTextEntry
              keyboardType="number-pad"
              onSubmitEditing={submitPin}
              returnKeyType="go"
            />
            <Pressable style={styles.pinGo} onPress={submitPin}><Text style={styles.pinGoLabel}>OK</Text></Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setShowPin(true)}><Text style={styles.pinToggle}>Sblocca con PIN</Text></Pressable>
        )
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  c: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  logo: { width: 96, height: 96, marginBottom: 8 },
  title: { color: theme.text, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  sub: { color: theme.textDim, fontSize: 13, marginBottom: 24 },
  btn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.accent },
  btnLabel: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  pinToggle: { color: theme.textDim, fontSize: 12, marginTop: 22, textDecorationLine: 'underline' },
  pinRow: { flexDirection: 'row', gap: 8, marginTop: 22, alignItems: 'center' },
  pinInput: { width: 140, height: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgElev, color: theme.text, textAlign: 'center', fontSize: 18, letterSpacing: 4 },
  pinGo: { height: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  pinGoLabel: { color: theme.accent, fontWeight: '900' },
});
