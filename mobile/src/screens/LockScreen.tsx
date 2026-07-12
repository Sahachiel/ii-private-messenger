import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { theme } from '@utils/theme';

/** Schermata di blocco a copertura totale: nasconde i contenuti finché non si sblocca. */
export const LockScreen: React.FC<{ onUnlock: () => void; biometry?: string | null }> = ({ onUnlock, biometry }) => {
  const label = biometry ? `SBLOCCA CON ${String(biometry).toUpperCase()}` : 'SBLOCCA';
  return (
    <View style={styles.c}>
      <Image source={require('../assets/icons/ICONA 2.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>II Private Messenger</Text>
      <Text style={styles.sub}>App bloccata</Text>
      <Pressable style={styles.btn} onPress={onUnlock}>
        <Text style={styles.btnLabel}>{label}</Text>
      </Pressable>
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
});
