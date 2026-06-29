import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { Button } from '@components/Button';
import { CountryPicker } from '@components/CountryPicker';
import { theme } from '@utils/theme';
import { getRegionForCountry } from '@utils/countries';

export const OnboardingScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [country, setCountry] = useState('QA');
  const region = getRegionForCountry(country);

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Image source={require('../assets/icons/ICONA 1.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brand}>II PRIVATE MESSENGER</Text>
          <Text style={styles.tag}>Private. Encrypted. Sovereign.</Text>
        </View>

        <CountryPicker value={country} onChange={setCountry} />
        <Text style={styles.explain}>
          Your communications are routed through a server in your region for maximum availability and privacy.
        </Text>
        <Text style={styles.route}>
          Routing region: <Text style={styles.routeAccent}>{region.toUpperCase()}</Text>
        </Text>
      </ScrollView>
      <View style={styles.ctaWrap}>
        <Button title="Get Started" onPress={() => navigation.navigate('Register', { country })} />
        <Button title="I Have An Account" variant="ghost" style={{ marginTop: 12 }} onPress={() => navigation.navigate('Login')} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 24 },
  hero: { alignItems: 'center', paddingVertical: 32 },
  logo: { width: 120, height: 120, marginBottom: 24 },
  brand: { color: theme.text, fontSize: 20, fontWeight: '900', letterSpacing: 3, textAlign: 'center' },
  tag: { color: theme.accent, fontSize: 11, letterSpacing: 2, marginTop: 10, textTransform: 'uppercase' },
  explain: { color: theme.textDim, fontSize: 13, lineHeight: 20, marginTop: 16 },
  route: { color: theme.textDim, fontSize: 13, marginTop: 12 },
  routeAccent: { color: theme.accent, fontWeight: '900', letterSpacing: 2 },
  ctaWrap: { padding: 24, borderTopWidth: 1, borderTopColor: theme.border },
});
