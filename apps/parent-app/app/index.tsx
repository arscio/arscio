// Parent home: the school at the top, the child's glass card with today's
// attendance, then fees, attendance, homework and messages, and a floating tab bar.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ApiError, call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C, SH, classLabel, sectionLabel } from '@/lib/theme';
import { Avatar, Button, Card, ErrorText, Loading, Pill, T } from '@/components/ui';
import { TabBar } from '@/components/TabBar';
import { SchoolBand } from '@/components/School';

export interface Summary {
  child: { firstName: string; className: string | null; sectionName: string | null; classTeacher: string | null; rollNo: number | null };
  school: { name: string; phone: string | null; onlinePayments: boolean };
  reportTerms: string[];
  attendance: { today: string | null; month: { present: number; absent: number; leave: number; days: number } };
  fees: { due: string; overdue: string; nextDueOn: string | null; hasFees: boolean };
  homework: { id: string; title: string; dueOn: string | null; subjectName: string | null }[];
}

export const rupees = (v: string | number) => {
  const [r = '0', p = '00'] = Number(v).toFixed(2).split('.');
  const last3 = r.slice(-3), rest = r.slice(0, -3);
  return `₹${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : ''}${last3}${p === '00' ? '' : `.${p}`}`;
};
export const shortDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const TODAY: Record<string, [string, 'done' | 'todo' | 'plain']> = {
  present: ['Present today', 'done'], late: ['Present today (came late)', 'done'], half_day: ['Half day today', 'todo'],
  absent: ['Absent today', 'todo'], leave: ['On leave today', 'plain'],
};

export default function Home() {
  const { state, child, accent, logout } = useParent();
  const [s, setS] = useState<Summary | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!child) return;
    try {
      const [sum, inbox] = await Promise.all([
        call<Summary>('GET', `/parent/children/${child.id}/summary`, undefined, { schoolId: child.schoolId }),
        call<{ unread: number }>('GET', '/me/messages'),
      ]);
      setS(sum); setUnread(inbox.unread); setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, [child]);
  useFocusEffect(useCallback(() => { setS(null); void load(); }, [load]));

  const insets = useSafeAreaInsets();
  const bell = (
    <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Messages, ${unread} unread` : 'Messages'} onPress={() => router.push('/messages')}
      style={[st.round, SH.lift]}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </Svg>
      {unread > 0 ? <View style={st.dot} /> : null}
    </Pressable>
  );

  if (state.status !== 'in') return <Loading />;
  if (!child) {
    return (
      <View style={{ padding: 16, paddingTop: 80 }}>
        <Card style={{ gap: 10 }}>
          <T display size={20}>No children linked yet</T>
          <T soft>This app shows children whose school has your mobile number ({state.me.account.phone.replace('+91', '+91 ')}) as the family number. Please ask the school office to check it.</T>
          <Button kind="plain" label="Log out" onPress={logout} />
        </Card>
      </View>
    );
  }

  const today = s?.attendance.today ? TODAY[s.attendance.today] : null;
  const m = s?.attendance.month;
  const counted = m ? m.present + m.absent : 0;
  const pct = m && counted ? Math.round((m.present / counted) * 100) : null;

  const fullName = `${child.first_name} ${child.last_name ?? ''}`.trim();
  const classLine = [child.class_name ? `${sectionLabel(child.class_name, child.section_name ?? '')}`.trim() : null, s?.child.rollNo ? `Roll ${String(s.child.rollNo).padStart(2, '0')}` : null].filter(Boolean).join(' · ');
  const todayTone = today?.[1] ?? 'plain';
  const todayBg = todayTone === 'done' ? C.lagoonWash : todayTone === 'todo' ? C.marigoldWash : '#E4ECF0';
  const todayFg = todayTone === 'done' ? C.lagoonDeep : todayTone === 'todo' ? C.marigold : C.inkSoft;
  const dotColor = todayTone === 'done' ? C.lagoon : todayTone === 'todo' ? C.gold : C.ruleStrong;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <SchoolBand right={bell} />
        <View style={{ padding: 20, gap: 14 }}>
          <ErrorText error={error} />

          <View style={st.hero}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={fullName} uri={child.photo_url} size={62} tint={accent} />
              <View style={{ flex: 1 }}>
                <T display size={24} numberOfLines={2}>{fullName}</T>
                {classLine ? <T soft size={14}>{classLine}</T> : null}
              </View>
            </View>
            <View style={[st.today, { backgroundColor: todayBg }]}>
              <View style={[st.todayDot, { backgroundColor: dotColor }]} />
              <T bold size={15} style={{ color: todayFg }}>{today ? today[0] : s ? 'Attendance not taken yet today' : 'Loading…'}</T>
            </View>
          </View>

          {!s ? <View style={{ height: 160 }}><Loading /></View> : (
            <>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Fees" onPress={() => router.push('/fees')} style={({ pressed }) => [st.tile, pressed && st.pressed]}>
                  <T soft size={13}>Fees to pay</T>
                  {!s.fees.hasFees ? <T soft size={14}>Not set yet</T>
                    : Number(s.fees.due) === 0 ? <T display size={22} style={{ color: C.lagoonDeep }}>All paid</T>
                    : <T display size={24}>{rupees(s.fees.due)}</T>}
                  {s.fees.hasFees && Number(s.fees.overdue) > 0 ? <Pill tone="todo" text={`${rupees(s.fees.overdue)} overdue`} />
                    : s.fees.hasFees && Number(s.fees.due) > 0 && s.fees.nextDueOn ? <Pill tone="todo" text={`Due ${shortDate(s.fees.nextDueOn)}`} /> : null}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Attendance" onPress={() => router.push('/attendance')} style={({ pressed }) => [st.tile, pressed && st.pressed]}>
                  <T soft size={13}>This month</T>
                  <T display size={24}>{pct !== null ? `${pct}%` : '—'}</T>
                  <View style={st.track}><View style={[st.fill, { width: `${pct ?? 0}%` }]} /></View>
                  {m && m.days ? <T soft size={12}>{m.present} present, {m.absent} absent</T> : null}
                </Pressable>
              </View>

              <Pressable accessibilityRole="button" accessibilityLabel="Marks" onPress={() => router.push('/marks')} style={({ pressed }) => [st.report, pressed && st.pressed]}>
                <View style={[st.reportIcon, { backgroundColor: C.boardWash }]}>
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.boardDeep} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>
                </View>
                <View style={{ flex: 1 }}>
                  <T bold size={16}>Marks</T>
                  <T soft size={13}>Exam and class test marks as teachers send them</T>
                </View>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth={2} strokeLinecap="round"><Path d="M9 6l6 6-6 6" /></Svg>
              </Pressable>

              {s.reportTerms?.length ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Report card" onPress={() => router.push('/report')} style={({ pressed }) => [st.report, pressed && st.pressed]}>
                  <View style={st.reportIcon}>
                    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.goldInk} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M6 3h9l4 4v14H6z" /><Path d="M9 12h7M9 16h5" /></Svg>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T bold size={16}>Report card</T>
                    <T soft size={13}>{s.reportTerms.at(-1)} results are ready</T>
                  </View>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth={2} strokeLinecap="round"><Path d="M9 6l6 6-6 6" /></Svg>
                </Pressable>
              ) : null}

              <Pressable accessibilityRole="button" accessibilityLabel="Homework" onPress={() => router.push('/homework')} style={({ pressed }) => [st.glass, pressed && st.pressed]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <T bold size={16} style={{ flex: 1 }}>Homework</T>
                  <T soft size={13}>{s.homework.length ? `${s.homework.length} this week` : 'None this week'}</T>
                </View>
                {s.homework.slice(0, 3).map((h, i) => (
                  <View key={h.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <View style={[st.subj, { backgroundColor: i % 2 ? C.marigoldWash : C.boardWash }]}>
                      <T bold size={13} style={{ color: i % 2 ? C.marigold : C.boardDeep }}>{(h.subjectName ?? 'Hw').slice(0, 2)}</T>
                    </View>
                    <View style={{ flex: 1 }}>
                      <T size={15} numberOfLines={2}>{h.title}</T>
                      <T soft size={13}>{[h.subjectName, h.dueOn ? `due ${shortDate(h.dueOn)}` : null].filter(Boolean).join(' · ')}</T>
                    </View>
                  </View>
                ))}
              </Pressable>

              <Pressable accessibilityRole="button" accessibilityLabel="Messages" onPress={() => router.push('/messages')} style={({ pressed }) => [st.notice, { backgroundColor: accent, ...SH.glow(accent) }, pressed && st.pressed]}>
                <View style={{ flex: 1 }}>
                  <T size={12} style={{ color: 'rgba(255,255,255,0.85)' }}>Notices and alerts</T>
                  <T bold size={16} style={{ color: '#fff' }}>{unread > 0 ? `${unread} new message${unread > 1 ? 's' : ''} from school` : 'Messages from school'}</T>
                </View>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round"><Path d="M9 6l6 6-6 6" /></Svg>
              </Pressable>

              {s.child.classTeacher ? <T soft size={13} style={{ textAlign: 'center' }}>Class teacher: {s.child.classTeacher}</T> : null}
            </>
          )}
        </View>
      </ScrollView>
      <TabBar active="home" />
    </View>
  );
}

const st = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: C.gold, borderWidth: 2, borderColor: '#fff' },
  hero: { borderRadius: 28, padding: 20, gap: 16, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, ...SH.lift },
  today: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16 },
  todayDot: { width: 10, height: 10, borderRadius: 5 },
  tile: { flex: 1, borderRadius: 24, padding: 16, gap: 6, backgroundColor: '#fff', ...SH.lift },
  track: { height: 8, borderRadius: 4, backgroundColor: '#E1EEF3', overflow: 'hidden', marginTop: 2 },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.lagoon },
  glass: { borderRadius: 24, padding: 18, gap: 12, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge },
  subj: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  report: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 24, padding: 16, backgroundColor: '#fff', ...SH.lift },
  reportIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.marigoldWash, alignItems: 'center', justifyContent: 'center' },
  notice: { borderRadius: 24, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pressed: { transform: [{ scale: 0.98 }] },
});
