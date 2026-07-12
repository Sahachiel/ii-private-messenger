import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, FlatList, Modal, Pressable, StyleSheet } from 'react-native';
import { theme } from '@utils/theme';
import { COUNTRY_LIST, CountryEntry } from '@utils/countries';

interface Props { value: string; onChange: (code: string) => void; label?: string }

export const CountryPicker: React.FC<Props> = ({ value, onChange, label = 'Country' }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = COUNTRY_LIST.find((c) => c.code === value);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return COUNTRY_LIST;
    return COUNTRY_LIST.filter((c) => c.name.toLowerCase().includes(t) || c.code.toLowerCase().includes(t));
  }, [q]);

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} style={styles.trigger}>
        <Text style={styles.flag}>{current?.flag ?? '🏳️'}</Text>
        <Text style={styles.name}>{current?.name ?? 'Select country'}</Text>
        <Text style={styles.region}>{current?.region.toUpperCase()}</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setOpen(false)}><Text style={styles.close}>CLOSE</Text></Pressable>
            <Text style={styles.title}>SELECT COUNTRY</Text>
            <View style={{ width: 40 }} />
          </View>
          <TextInput
            placeholder="Cerca…"
            placeholderTextColor={theme.textDim}
            value={q}
            onChangeText={setQ}
            style={styles.search}
            autoFocus
          />
          <FlatList
            data={filtered}
            keyExtractor={(c: CountryEntry) => c.code}
            renderItem={({ item }) => (
              <Pressable onPress={() => { onChange(item.code); setOpen(false); setQ(''); }} style={styles.item}>
                <Text style={styles.itemFlag}>{item.flag}</Text>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemRegion}>{item.region.toUpperCase()}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  label: { color: theme.textDim, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  trigger: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bgElev, borderWidth: 1, borderColor: theme.border, paddingVertical: 12, paddingHorizontal: 14, gap: 10 },
  flag: { fontSize: 20 },
  name: { color: theme.text, flex: 1, fontSize: 14 },
  region: { color: theme.accent, fontSize: 11, letterSpacing: 1.5, fontWeight: '900' },
  modal: { flex: 1, backgroundColor: theme.bg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  close: { color: theme.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: theme.text, fontSize: 14, fontWeight: '900', letterSpacing: 3 },
  search: { backgroundColor: theme.bgElev, color: theme.text, padding: 14, margin: 12, borderWidth: 1, borderColor: theme.border },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 },
  itemFlag: { fontSize: 20 },
  itemName: { color: theme.text, flex: 1, fontSize: 14 },
  itemRegion: { color: theme.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
});
