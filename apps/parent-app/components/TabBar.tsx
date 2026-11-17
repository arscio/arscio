// The floating glass menu at the bottom of the parent home screen.
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useParent } from '@/lib/auth';
import { C, SH } from '@/lib/theme';

type Tab = 'home' | 'attendance' | 'fees' | 'homework' | 'account';

const ICONS: Record<Tab, (c: string) => ReactElement> = {
  home: (c) => <Path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" stroke={c} />,
  attendance: (c) => <><Rect x={3} y={5} width={18} height={16} rx={3} stroke={c} /><Path d="M3 10h18M8 3v4M16 3v4" stroke={c} /></>,
  fees: (c) => <Path d="M7 4h10M7 9h10M7 4c5 0 5 5 0 5l7 11" stroke={c} />,
  homework: (c) => <><Path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" stroke={c} /><Path d="M4 19a2 2 0 0 0 2 2h13" stroke={c} /></>,
  account: (c) => <><Circle cx={12} cy={8} r={4} stroke={c} /><Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" stroke={c} /></>,
};
const LABELS: Record<Tab, string> = { home: 'Home', attendance: 'Attendance', fees: 'Fees', homework: 'Homework', account: 'Account' };

export function TabBar({ active }: { active: Tab }) {
  const { accent } = useParent();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { bottom: Math.max(insets.bottom, 12) + 8 }]} accessibilityRole="tablist">
      {(Object.keys(ICONS) as Tab[]).map((t) => {
        const on = t === active;
        return (
          <Pressable key={t} accessibilityRole="tab" accessibilityLabel={LABELS[t]} accessibilityState={{ selected: on }}
            onPress={() => { if (!on) router.push(t === 'home' ? '/' : `/${t}`); }}
            style={[s.item, on && { backgroundColor: accent, ...SH.glow(accent) }]}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              {ICONS[t](on ? '#fff' : C.ink)}
            </Svg>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute', left: 16, right: 16, height: 68, borderRadius: 34, paddingHorizontal: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    backgroundColor: Platform.OS === 'web' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.88)',
    borderWidth: 1, borderColor: C.glassEdge, ...SH.lift,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(24px) saturate(180%)' } as object) : {}),
  },
  item: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
