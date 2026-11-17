// Small building blocks for the teacher app screens.
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { C, F, SH } from '@/lib/theme';
import { API_URL } from '@/lib/api';

export function T(props: { children: ReactNode; style?: TextStyle | TextStyle[]; bold?: boolean; soft?: boolean; size?: number; numberOfLines?: number; display?: boolean }) {
  return (
    <Text numberOfLines={props.numberOfLines} style={[
      { fontFamily: props.display ? F.display : props.bold ? F.bold : F.regular, letterSpacing: props.display ? -0.3 : 0, color: props.soft ? C.inkSoft : C.ink, fontSize: props.size ?? 16, lineHeight: (props.size ?? 16) * 1.4 },
      props.style as TextStyle,
    ]}>{props.children}</Text>
  );
}

export function Button(props: {
  label: string; onPress: () => void; kind?: 'primary' | 'plain' | 'quiet'; disabled?: boolean; busy?: boolean; style?: ViewStyle; color?: string;
}) {
  const kind = props.kind ?? 'primary';
  const off = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!off }} disabled={off} onPress={props.onPress}
      style={({ pressed }) => [s.btn, s[kind], kind === 'primary' && props.color ? { backgroundColor: props.color } : null, pressed && !off && { transform: [{ scale: 0.97 }] }, off && { opacity: 0.5 }, props.style]}>
      {props.busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : C.board} />
        : <Text style={[s.btnText, { color: kind === 'primary' ? '#fff' : kind === 'quiet' ? (props.color ?? C.board) : C.ink }]}>{props.label}</Text>}
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
        style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.985 }] }, props.style]}>{props.children}</Pressable>
    );
  }
  return <View style={[s.card, props.style]}>{props.children}</View>;
}

export function Pill({ text, tone }: { text: string; tone: 'done' | 'todo' | 'plain' }) {
  const bg = tone === 'done' ? C.lagoonWash : tone === 'todo' ? C.marigoldWash : '#eef1f4';
  const fg = tone === 'done' ? C.lagoonDeep : tone === 'todo' ? C.marigold : C.ink;
  return <View style={{ backgroundColor: bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
    <T bold size={13} style={{ color: fg }}>{text}</T></View>;
}

export function Loading() {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }}><ActivityIndicator color={C.board} size="large" /></View>;
}

const s = StyleSheet.create({
  btn: { minHeight: 52, borderRadius: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  primary: { backgroundColor: C.board, ...SH.glow(C.board) },
  plain: { backgroundColor: '#F6FAFC', ...SH.raised },
  quiet: { backgroundColor: 'transparent', minHeight: 40 },
  btnText: { fontFamily: F.bold, fontSize: 16 },
  input: {
    fontFamily: F.regular, fontSize: 18, color: C.ink, backgroundColor: C.paper, borderWidth: 0,
    borderRadius: 14, paddingHorizontal: 14, minHeight: 54, flexGrow: 1, ...SH.inset,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  prefix: { backgroundColor: '#E2EDF2', paddingHorizontal: 12, justifyContent: 'center', borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  error: { backgroundColor: C.redWash, padding: 12, borderRadius: 14 },
  card: { backgroundColor: C.glass, borderRadius: 24, borderWidth: 1, borderColor: C.glassEdge, padding: 18, ...SH.lift },
});

/** Soft coloured glows behind a screen; the glass cards sit on top. */
export function Backdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="g1" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={C.sky} stopOpacity="0.85" /><Stop offset="1" stopColor={C.sky} stopOpacity="0" /></RadialGradient>
          <RadialGradient id="g2" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={C.gold} stopOpacity="0.38" /><Stop offset="1" stopColor={C.gold} stopOpacity="0" /></RadialGradient>
          <RadialGradient id="g3" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={C.lagoon} stopOpacity="0.32" /><Stop offset="1" stopColor={C.lagoon} stopOpacity="0" /></RadialGradient>
        </Defs>
        <Circle cx="5%" cy="4%" r="230" fill="url(#g1)" />
        <Circle cx="100%" cy="38%" r="200" fill="url(#g2)" />
        <Circle cx="10%" cy="88%" r="220" fill="url(#g3)" />
      </Svg>
    </View>
  );
}

/** Round photo; shows initials until the school uploads a photo. */
export function Avatar({ name, uri, size = 56, tint = C.board }: { name: string; uri?: string | null; size?: number; tint?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.boardWash, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...SH.lift }}>
      {uri ? <Image source={{ uri: uri.startsWith('/') ? `${API_URL}${uri}` : uri }} style={{ width: size, height: size }} accessibilityLabel={`${name} photo`} />
        : <Text style={{ fontFamily: F.display, fontSize: size * 0.36, color: tint }}>{initials}</Text>}
    </View>
  );
}

/** The Arscio mark (the A with a new leaf) and wordmark. */
export function Logo({ size = 28, onDark = false, wordmark = true }: { size?: number; onDark?: boolean; wordmark?: boolean }) {
  const blue = onDark ? C.sky : C.board;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }} accessibilityLabel="Arscio">
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path d="M10 89L41 12H59L90 89H74L50 33L26 89Z" fill={blue} stroke={blue} strokeWidth={7} strokeLinejoin="round" />
        <Path d="M41 80C41 66 49 58 61 57C61 71 53 79 41 80Z" fill={C.gold} />
      </Svg>
      {wordmark ? <Text style={{ fontFamily: F.displayHeavy, fontSize: size * 0.82, letterSpacing: -0.8, lineHeight: size }}>
        <Text style={{ color: blue }}>Ar</Text><Text style={{ color: onDark ? '#fff' : C.ink }}>scio</Text>
      </Text> : null}
    </View>
  );
}
