// Small building blocks for the teacher app screens.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { C, F } from '@/lib/theme';

export function T(props: { children: ReactNode; style?: TextStyle | TextStyle[]; bold?: boolean; soft?: boolean; size?: number; numberOfLines?: number }) {
  return (
    <Text numberOfLines={props.numberOfLines} style={[
      { fontFamily: props.bold ? F.bold : F.regular, color: props.soft ? C.inkSoft : C.ink, fontSize: props.size ?? 16, lineHeight: (props.size ?? 16) * 1.4 },
      props.style as TextStyle,
    ]}>{props.children}</Text>
  );
}

export function Button(props: {
  label: string; onPress: () => void; kind?: 'primary' | 'plain' | 'quiet'; disabled?: boolean; busy?: boolean; style?: ViewStyle;
}) {
  const kind = props.kind ?? 'primary';
  const off = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!off }} disabled={off} onPress={props.onPress}
      style={({ pressed }) => [s.btn, s[kind], pressed && !off && { opacity: 0.85 }, off && { opacity: 0.5 }, props.style]}>
      {props.busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : C.board} />
        : <Text style={[s.btnText, { color: kind === 'primary' ? '#fff' : kind === 'quiet' ? C.board : C.ink }]}>{props.label}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label: string; hint?: string; prefix?: string }) {
  const { label, hint, prefix, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <T bold size={15}>{label}</T>
      <View style={{ flexDirection: 'row' }}>
        {prefix ? <View style={s.prefix}><T soft>{prefix}</T></View> : null}
        <TextInput placeholderTextColor="#8a94aa" {...rest}
          style={[s.input, prefix ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0, flex: 1 } : null, style as TextStyle]} />
      </View>
      {hint ? <T soft size={13}>{hint}</T> : null}
    </View>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <View style={s.error} accessibilityRole="alert"><T style={{ color: C.red }}>{error}</T></View>;
}

export function Card(props: { children: ReactNode; style?: ViewStyle; onPress?: () => void; label?: string }) {
  if (props.onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={props.label} onPress={props.onPress}
        style={({ pressed }) => [s.card, pressed && { backgroundColor: '#f8faf9' }, props.style]}>{props.children}</Pressable>
    );
  }
  return <View style={[s.card, props.style]}>{props.children}</View>;
}

export function Pill({ text, tone }: { text: string; tone: 'done' | 'todo' | 'plain' }) {
  const bg = tone === 'done' ? C.boardWash : tone === 'todo' ? C.marigoldWash : '#eef1f4';
  const fg = tone === 'done' ? C.boardDeep : tone === 'todo' ? '#7a520a' : C.ink;
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
    <T size={13} style={{ color: fg }}>{text}</T></View>;
}

export function Loading() {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }}><ActivityIndicator color={C.board} size="large" /></View>;
}

const s = StyleSheet.create({
  btn: { minHeight: 50, borderRadius: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  primary: { backgroundColor: C.board },
  plain: { backgroundColor: C.sheet, borderColor: C.ruleStrong },
  quiet: { backgroundColor: 'transparent', minHeight: 40 },
  btnText: { fontFamily: F.bold, fontSize: 16 },
  input: {
    fontFamily: F.regular, fontSize: 18, color: C.ink, backgroundColor: '#fff', borderWidth: 1, borderColor: C.ruleStrong,
    borderRadius: 6, paddingHorizontal: 12, minHeight: 52, flexGrow: 1,
  },
  prefix: { borderWidth: 1, borderRightWidth: 0, borderColor: C.ruleStrong, backgroundColor: '#f6f8f8', paddingHorizontal: 12, justifyContent: 'center', borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  error: { borderLeftWidth: 4, borderLeftColor: C.red, backgroundColor: C.redWash, padding: 12, borderRadius: 4 },
  card: { backgroundColor: C.sheet, borderRadius: 10, borderWidth: 1, borderColor: C.rule, padding: 16 },
});
