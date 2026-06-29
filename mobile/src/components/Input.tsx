import React, { useState } from 'react';
import { TextInput, StyleSheet, View, Text, TextInputProps } from 'react-native';
import { theme } from '@utils/theme';

type Props = TextInputProps & { label?: string; error?: string };

export const Input: React.FC<Props> = ({ label, error, style, onFocus, onBlur, ...rest }) => {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? theme.alert : focused ? theme.accent : theme.border;
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={theme.textMute}
        style={[styles.input, { borderColor }, style]}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        selectionColor={theme.accent}
        {...rest}
      />
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { color: theme.textDim, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: '700' },
  input: {
    backgroundColor: theme.bgInput,
    borderWidth: 1.5,
    borderRadius: theme.radiusSm,
    color: theme.text,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15,
  },
  err: { color: theme.alert, fontSize: 12, marginTop: 6 },
});
