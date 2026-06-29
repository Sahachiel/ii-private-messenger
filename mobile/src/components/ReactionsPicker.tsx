import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '@utils/theme';

const EMOJIS = ['❤️', '😀', '😂', '😮', '😢', '🔥', '👍', '👎'];

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export const ReactionsPicker: React.FC<Props> = ({ onPick, onClose }) => {
  return (
    <View style={styles.c}>
      <Text style={styles.title}>REACT</Text>
      <View style={styles.row}>
        {EMOJIS.map((e) => (
          <Pressable key={e} style={styles.tile} onPress={() => { onPick(e); onClose(); }}>
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  c: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  title: { color: theme.textDim, fontSize: 10, letterSpacing: 2, fontWeight: '900', marginBottom: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  tile: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.bgCard,
    borderWidth: 1, borderColor: theme.border,
  },
  emoji: { fontSize: 22 },
});
