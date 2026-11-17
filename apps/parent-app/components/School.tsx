// The school's identity at the top of the parent app: logo, name and date.
// With more than one child, tap a name to switch.
import { useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { schoolLogoUrl } from '@/lib/api';
import { useParent, type Child } from '@/lib/auth';
import { C, SH, classLabel, sectionLabel, longDate } from '@/lib/theme';
import { T } from './ui';

export function SchoolLogo({ child, size = 44 }: { child: Child; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!child.schoolLogoUrl || failed) {
    const initials = (child.schoolShortName ?? child.schoolName.split(/\s+/).map((w) => w[0]).join('')).slice(0, 4).toUpperCase();
    return (
      <View style={[s.logo, { width: size, height: size, borderRadius: size / 2 }]}>
        <T display size={size * 0.34} style={{ color: child.schoolColor ?? C.board }}>{initials}</T>
      </View>
    );
  }
  return (
    <Image source={{ uri: schoolLogoUrl(child.schoolId, child.schoolLogoUrl) }} onError={() => setFailed(true)}
      style={[s.logo, { width: size, height: size, borderRadius: size / 2 }]} resizeMode="contain" accessibilityLabel={`${child.schoolName} logo`} />
  );
}

export function SchoolBand({ right }: { right?: ReactNode }) {
  const { state, child, accent, selectChild } = useParent();
  if (state.status !== 'in' || !child) return null;
  return (
    <View style={s.band}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[s.logoWrap, SH.lift]}><SchoolLogo child={child} size={44} /></View>
        <View style={{ flex: 1 }}>
          <T bold size={15} numberOfLines={2}>{child.schoolName}</T>
          <T soft size={13}>{longDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))}</T>
        </View>
        {right}
      </View>
      {state.children.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginTop: 4 }} contentContainerStyle={{ gap: 10, paddingVertical: 14, paddingHorizontal: 22 }}>
          {state.children.map((c) => {
            const on = c.id === child.id;
            return (
              <Pressable key={c.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => selectChild(c.id)}
                style={[s.kid, on ? { backgroundColor: accent, ...SH.glow(accent) } : { backgroundColor: '#F6FAFC', ...SH.raised }]}>
                <T bold size={15} style={{ color: on ? '#fff' : C.ink }}>{c.first_name}</T>
                <T size={12} style={{ color: on ? 'rgba(255,255,255,0.9)' : C.inkSoft }}>
                  {c.class_name ? `${sectionLabel(c.class_name, c.section_name)}` : c.schoolShortName ?? ''}
                </T>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  band: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  logoWrap: { borderRadius: 16, backgroundColor: '#fff', padding: 0 },
  logo: { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  kid: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16, minWidth: 96 },
});
