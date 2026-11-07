// The school's identity at the top of the parent app: logo, name, and the
// school's colour. With more than one child, tap a name to switch.
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { schoolLogoUrl } from '@/lib/api';
import { useParent, type Child } from '@/lib/auth';
import { C, classLabel } from '@/lib/theme';
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

export function SchoolBand() {
  const { state, child, accent, selectChild } = useParent();
  if (state.status !== 'in' || !child) return null;
  return (
    <View style={[s.band, { backgroundColor: accent }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SchoolLogo child={child} />
        <View style={{ flex: 1 }}>
          <T display size={18} style={{ color: '#fff' }} numberOfLines={2}>{child.schoolName}</T>
        </View>
      </View>
      {state.children.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 14 }}>
          {state.children.map((c) => {
            const on = c.id === child.id;
            return (
              <Pressable key={c.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => selectChild(c.id)}
                style={[s.kid, on ? { backgroundColor: '#fff' } : { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
                <T bold size={15} style={{ color: on ? accent : '#fff' }}>{c.first_name}</T>
                <T size={12} style={{ color: on ? C.inkSoft : 'rgba(255,255,255,0.85)' }}>
                  {c.class_name ? `${classLabel(c.class_name)} ${c.section_name}` : c.schoolShortName ?? ''}
                </T>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <T size={14} style={{ color: 'rgba(255,255,255,0.9)', marginTop: 10 }}>
          {child.first_name} {child.last_name ?? ''}{child.class_name ? `, ${classLabel(child.class_name)} ${child.section_name}` : ''}
        </T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  band: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  logo: { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  kid: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, minWidth: 92 },
});
