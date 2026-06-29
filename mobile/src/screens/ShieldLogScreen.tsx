import React from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, Pressable, Alert } from 'react-native';
import { useMtdEvents } from '@/xsec-mtd/hooks/useMtdEvents';
import { theme } from '@utils/theme';
import dayjs from 'dayjs';

const SEV_COLOR = { info: theme.textDim, warning: theme.warning, compromised: theme.alert };

export const ShieldLogScreen: React.FC = () => {
  const { events, acknowledge, clear } = useMtdEvents();
  return (
    <SafeAreaView style={styles.c}>
      <View style={styles.header}>
        <Text style={styles.title}>EVENT LOG</Text>
        <Pressable onPress={() => Alert.alert('Clear all events', '', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clear', style: 'destructive', onPress: clear },
        ])}>
          <Text style={styles.clear}>CLEAR</Text>
        </Pressable>
      </View>
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        ListEmptyComponent={<Text style={styles.empty}>No events.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => !item.ack && acknowledge(item.id)} style={[styles.row, item.ack && { opacity: 0.5 }]}>
            <View style={[styles.dot, { backgroundColor: SEV_COLOR[item.severity] }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.evTitle}>{item.title}</Text>
              <Text style={styles.meta}>
                {item.category.replace(/_/g, ' ')} · {item.severity} · {dayjs(item.ts).format('MMM DD HH:mm')}
              </Text>
              {item.detail ? (
                <Text style={styles.detail} numberOfLines={2}>
                  {JSON.stringify(item.detail)}
                </Text>
              ) : null}
            </View>
            {!item.ack && <Text style={styles.unack}>NEW</Text>}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { color: theme.text, fontSize: 16, fontWeight: '900', letterSpacing: 3 },
  clear: { color: theme.alert, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  empty: { color: theme.textDim, textAlign: 'center', marginTop: 60 },
  row: { flexDirection: 'row', padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 },
  dot: { width: 8, height: 8, marginTop: 6 },
  evTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  meta: { color: theme.textDim, fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  detail: { color: theme.textMute, fontSize: 11, marginTop: 4, fontFamily: theme.font.mono },
  unack: { color: theme.accent, fontSize: 10, fontWeight: '900', letterSpacing: 2, alignSelf: 'flex-start' },
});
