// Home: today's date and the teacher's classes, showing whether attendance is done.
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { C, classLabel, longDate } from '@/lib/theme';
import { Button, Card, ErrorText, Loading, Pill, T } from '@/components/ui';

export interface Today {
  date: string; today: string; mode: 'daily' | 'period'; periodsPerDay: number;
  sections: {
    sectionId: string; className: string; sectionName: string; isClassTeacher: boolean;
    subjects: { id: string; name: string }[]; studentCount: number;
    taken: { periodNo: number; present: number; absent: number; leave: number; takenBy: string }[];
  }[];
}

export default function Home() {
  const { state, logout } = useAuth();
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const ready = state.status === 'in' && state.schoolId && state.canTeach;

  const load = useCallback(async () => {
    if (!ready) return;
    try { setData(await call<Today>('GET', '/teacher/today')); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, [ready]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const header = <Stack.Screen options={{
    headerRight: () => (
      <Pressable accessibilityRole="button" onPress={() => router.push('/account')} hitSlop={10} style={{ paddingHorizontal: 12 }}>
        <T bold style={{ color: '#fff' }}>Account</T>
      </Pressable>
    ),
  }} />;

  if (state.status !== 'in') return <Loading />;
  if (!state.canTeach) {
    return (
      <View style={{ padding: 16 }}>{header}
        <Card style={{ gap: 10 }}>
          <T bold size={18}>Hello, {state.me.account.name}</T>
          <T soft>This app is for teachers: attendance, homework and marks. Your number doesn&apos;t have the Teacher role at any school, so please use the school website instead. If you do teach, ask the principal to give you the Teacher role.</T>
          <Button kind="plain" label="Log out" onPress={logout} />
        </Card>
      </View>
    );
  }
  if (!data) return error ? <View style={{ padding: 16 }}>{header}<ErrorText error={error} /><Button kind="plain" label="Try again" onPress={load} style={{ marginTop: 12 }} /></View> : <Loading />;

  const school = state.me.schools.find((s) => s.id === state.schoolId);
  const todo = data.sections.filter((s) => data.mode === 'daily' && s.taken.length === 0).length;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {header}
      <View style={{ marginBottom: 4 }}>
        <T soft size={14}>{school?.name}</T>
        <T bold size={24}>{longDate(data.date)}</T>
        <T soft>{data.mode === 'daily'
          ? (data.sections.length === 0 ? '' : todo === 0 ? 'Attendance is done for your classes.' : `Attendance to take: ${todo} ${todo === 1 ? 'class' : 'classes'}.`)
          : `Attendance is taken every period (${data.periodsPerDay} periods).`}</T>
      </View>
      <ErrorText error={error} />

      {data.sections.length === 0 ? (
        <Card style={{ gap: 6 }}>
          <T bold size={17}>No classes are assigned to you yet</T>
          <T soft>The office chooses class teachers and subject teachers on the school website. You can still take attendance for any class below.</T>
        </Card>
      ) : data.sections.map((s) => {
        const day = s.taken.find((t) => t.periodNo === 0);
        const periodsDone = s.taken.filter((t) => t.periodNo > 0).map((t) => t.periodNo);
        return (
          <Card key={s.sectionId} label={`Attendance for ${classLabel(s.className)} ${s.sectionName}`}
            onPress={() => router.push({ pathname: '/attendance/[sectionId]', params: { sectionId: s.sectionId } })}
            style={{ gap: 8, borderLeftWidth: 4, borderLeftColor: (data.mode === 'daily' ? day : periodsDone.length) ? C.board : C.marigold }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <T bold size={20}>{classLabel(s.className)} {s.sectionName}</T>
                <T soft size={14}>
                  {[s.isClassTeacher ? 'Class teacher' : null, s.subjects.map((x) => x.name).join(', ') || null, `${s.studentCount} students`].filter(Boolean).join('  |  ')}
                </T>
              </View>
              <T bold style={{ color: C.board }}>Open</T>
            </View>
            {data.mode === 'daily'
              ? (day ? <Pill tone="done" text={`Done: ${day.present} present, ${day.absent} absent${day.leave ? `, ${day.leave} on leave` : ''}`} /> : <Pill tone="todo" text="Not taken yet" />)
              : (periodsDone.length ? <Pill tone="done" text={`Periods done: ${periodsDone.join(', ')}`} /> : <Pill tone="todo" text="No periods taken today" />)}
          </Card>
        );
      })}

      <Button kind="plain" label="Take attendance for another class" onPress={() => router.push('/other-class')} style={{ marginTop: 6 }} />

      <View style={{ marginTop: 18, gap: 10 }}>
        <T bold size={20}>Homework</T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="Give homework" onPress={() => router.push('/homework/new')} style={{ flex: 1 }} />
          <Button kind="plain" label="Homework I gave" onPress={() => router.push('/homework')} style={{ flex: 1 }} />
        </View>
      </View>
    </ScrollView>
  );
}
