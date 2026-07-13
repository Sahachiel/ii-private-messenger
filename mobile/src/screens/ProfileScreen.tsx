import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Pressable, Alert } from 'react-native';
import { Avatar } from '@components/Avatar';
import { Input } from '@components/Input';
import { Button } from '@components/Button';
import { useAppDispatch, useAppSelector } from '@store/index';
import { updateProfile } from '@store/authSlice';
import { usersApi } from '@services/api';
import { theme } from '@utils/theme';
import { launchImageLibrary } from 'react-native-image-picker';
import { QRIcon } from '@components/Icons';

export const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [loading, setLoading] = useState(false);

  const pickAvatar = async () => {
    const res = await launchImageLibrary({ mediaType: 'photo', maxWidth: 512, maxHeight: 512, quality: 0.8 });
    if (res.assets?.[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };

  const save = async () => {
    setLoading(true);
    try {
      const updated = await usersApi.updateMe({ displayName, avatarUrl });
      dispatch(updateProfile(updated));
      Alert.alert('Saved', 'Profile updated');
      navigation.goBack();
    } catch (e: any) { Alert.alert('Save failed', e?.message ?? 'unknown'); }
    finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.c}>
      <View style={{ padding: 20 }}>
        <Text style={styles.title}>PROFILE</Text>
        <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
          <Avatar name={displayName} url={avatarUrl} size={100} />
          <Text style={styles.changeAvatar}>TAP TO CHANGE</Text>
        </Pressable>

        <Input label="Display Name" value={displayName} onChangeText={setDisplayName} />
        <Input label="Username" value={user?.username ?? ''} editable={false} />
        <Input label="Region" value={user?.region?.toUpperCase() ?? ''} editable={false} />

        <Button title="Save" onPress={save} loading={loading} style={{ marginTop: 16 }} />

        <Pressable onPress={() => navigation.navigate('QRPairing')} style={styles.pairRow}>
          <View style={styles.pairIcon}><QRIcon size={20} color={theme.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pairTitle}>VERIFICA IDENTITÀ</Text>
            <Text style={styles.pairSub}>Confronta l’impronta con un altro dispositivo</Text>
          </View>
          <Text style={styles.pairArrow}>›</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 18, fontWeight: '900', letterSpacing: 3, marginBottom: 24 },
  avatarWrap: { alignItems: 'center', marginBottom: 24 },
  changeAvatar: { color: theme.accent, fontSize: 10, letterSpacing: 2, marginTop: 8, fontWeight: '900' },

  pairRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginTop: 24, paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: theme.bgElev, borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.border,
  },
  pairIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  pairTitle: { color: theme.text, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  pairSub: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  pairArrow: { color: theme.textDim, fontSize: 24, fontWeight: '300' },
});
