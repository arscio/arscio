// Parent home: the school's band at the top, then today's attendance, fees,
// homework and messages for the selected child.
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C, longDate } from '@/lib/theme';
import { Button, Card, ErrorText, Loading, Pill, T } from '@/components/ui';
import { SchoolBand } from '@/components/School';

export interface Summary {
  child: { firstName: string; className: string | null; sectionName: string | null; classTeacher: string | null; rollNo: number | null };
  school: { name: string; phone: string | null; onlinePayments: boolean };
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

  const header = (
    <Stack.Screen options={{
      title: 'Home',
      headerRight: () => (
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} hitSlop={10} style={{ paddingHorizontal: 12 }}>
          <T bold style={{ color: '#fff' }}>Account</T>
        </Pressable>
      ),
    }} />
  );

  if (state.status !== 'in') return <Loading />;
  if (!child) {
    return (
      <View style={{ padding: 16 }}>{header}
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

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {header}
      <SchoolBand />
      <View style={{ padding: 16, gap: 12 }}>
        <T soft size={14}>{longDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))}</T>
        <ErrorText error={error} />
        {!s ? <View style={{ height: 200 }}><Loading /></View> : (
          <>
            <Card label="Attendance" onPress={() => router.push('/attendance')} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T display size={18}>Attendance</T><T bold style={{ color: accent }}>Open</T>
              </View>
              {today ? <Pill tone={today[1]} text={today[0]} /> : <Pill tone="plain" text="Not taken yet today" />}
              <T soft size={14}>{m && m.days
                ? `This month: ${m.present} present, ${m.absent} absent${m.leave ? `, ${m.leave} on leave` : ''}${pct !== null ? ` (${pct}% attendance)` : ''}.`
                : 'No attendance recorded this month yet.'}</T>
            </Card>

            <Card label="Fees" onPress={() => router.push('/fees')} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T display size={18}>Fees</T><T bold style={{ color: accent }}>Open</T>
              </View>
              {!s.fees.hasFees ? <T soft size={14}>The school hasn&apos;t set this year&apos;s fees yet.</T>
                : Number(s.fees.due) === 0 ? <Pill tone="done" text="All fees paid" /> : (
                <>
                  <T display size={26}>{rupees(s.fees.due)}</T>
                  <T soft size={14}>still to pay this year</T>
                  {Number(s.fees.overdue) > 0
                    ? <T bold size={14} style={{ color: C.red }}>{rupees(s.fees.overdue)} is overdue</T>
                    : s.fees.nextDueOn ? <T size={14}>Next due {shortDate(s.fees.nextDueOn)}</T> : null}
                </>
              )}
            </Card>

            <Card label="Homework" onPress={() => router.push('/homework')} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T display size={18}>Homework</T><T bold style={{ color: accent }}>Open</T>
              </View>
              {s.homework.length === 0 ? <T soft size={14}>No homework in the last week.</T> : s.homework.map((h) => (
                <View key={h.id} style={{ borderLeftWidth: 3, borderLeftColor: accent, paddingLeft: 10 }}>
                  <T bold size={15}>{h.title}</T>
                  <T soft size={13}>{[h.subjectName, h.dueOn ? `due ${shortDate(h.dueOn)}` : null].filter(Boolean).join(', ')}</T>
                </View>
              ))}
            </Card>

            <Card label="Messages" onPress={() => router.push('/messages')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <T display size={18}>Messages</T>
                <T soft size={14}>Notices and alerts from school</T>
              </View>
              {unread > 0 ? (
                <View style={{ backgroundColor: C.gold, borderRadius: 999, minWidth: 30, height: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
                  <T bold style={{ color: C.ink }}>{unread}</T>
                </View>
              ) : <T bold style={{ color: accent }}>Open</T>}
            </Card>

            {s.child.classTeacher ? <T soft size={13} style={{ textAlign: 'center', marginTop: 6 }}>Class teacher: {s.child.classTeacher}</T> : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}
