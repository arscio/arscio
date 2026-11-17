// Today: greeting, the class still needing attendance as a big card, then each
// class with its attendance status and a Give homework button.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, call } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { C, SH, classLabel, longDate } from '@/lib/theme';
import { Avatar, Button, Card, ErrorText, Loading, Logo, Pill, T } from '@/components/ui';

export interface Today {
  date: string; today: string; mode: 'daily' | 'period'; periodsPerDay: number;
  sections: {
    sectionId: string; className: string; sectionName: string; isClassTeacher: boolean;
    subjects: { id: string; name: string }[]; studentCount: number;
    taken: { periodNo: number; present: number; absent: number; leave: number; takenBy: string }[];
  }[];
  day?: { label: string; noClasses: boolean; note: string | null };
  schedule?: { periodNo: number; time: { startsAt: string; endsAt: string } | null; sectionId: string; classLabel: string;
    subject: string | null; isCover: boolean; onLeave: boolean; coveredFor: string | null }[];
  covers?: { sectionId: string; classLabel: string }[];
  onLeave?: string | null;
}

export default function Home() {
  const { state, logout } = useAuth();
  const [data, setData] = useState<Today | null>(null);
  const [marks, setMarks] = useState<{ pending: number; total: number }>({ pending: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const ready = state.status === 'in' && state.schoolId && state.canTeach;

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const [today, m] = await Promise.all([
        call<Today>('GET', '/teacher/today'),
        call<{ tasks: { total: number; entered: number; locked: boolean }[] }>('GET', '/marks/tasks').catch(() => ({ tasks: [] })),
      ]);
      setData(today); setError(null);
      setMarks({ pending: m.tasks.filter((t) => !t.locked && t.entered < t.total).length, total: m.tasks.length });
    }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, [ready]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const insets = useSafeAreaInsets();
  const header = null;

  if (state.status !== 'in') return <Loading />;
  if (!state.canTeach) {
    return (
      <View style={{ padding: 16, paddingTop: insets.top + 24 }}>
        <Card style={{ gap: 10 }}>
          <T bold size={18}>Hello, {state.me.account.name}</T>
          <T soft>This app is for teachers: attendance, homework and marks. Your number doesn&apos;t have the Teacher role at any school, so please use the school website instead. If you do teach, ask the principal to give you the Teacher role.</T>
          <Button kind="plain" label="Log out" onPress={logout} />
        </Card>
      </View>
    );
  }
  if (!data) return error ? <View style={{ padding: 16, paddingTop: insets.top + 24 }}><ErrorText error={error} /><Button kind="plain" label="Try again" onPress={load} style={{ marginTop: 12 }} /></View> : <Loading />;

  const school = state.me.schools.find((s) => s.id === state.schoolId);
  const isDone = (x: Today['sections'][number]) => (data.mode === 'daily' ? x.taken.some((t) => t.periodNo === 0) : x.taken.length > 0);
  const todo = data.sections.filter((x) => data.mode === 'daily' && !isDone(x)).length;
  const hero = data.sections.find((x) => x.isClassTeacher && !isDone(x)) ?? data.sections.find((x) => !isDone(x));
  const hour = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', timeZone: 'Asia/Kolkata' }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const open = (sectionId: string) => router.push({ pathname: '/attendance/[sectionId]', params: { sectionId } });

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Logo size={30} wordmark={false} />
        <View style={{ flex: 1 }}>
          <T soft size={13}>{greeting}</T>
          <T bold size={16} numberOfLines={1}>{state.me.account.name}</T>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="My account" onPress={() => router.push('/account')}>
          <Avatar name={state.me.account.name} size={44} tint={C.marigold} />
        </Pressable>
      </View>

      <View>
        <T display size={28} style={{ lineHeight: 34 }}>{longDate(data.date)}</T>
        <T soft size={14}>{school?.name}{data.mode === 'period' ? ` · attendance every period (${data.periodsPerDay})` : ''}</T>
      </View>
      <ErrorText error={error} />

      {hero && data.day?.noClasses ? (
        <View style={st.doneCard}>
          <View style={st.doneDot} />
          <T bold size={16}>No school today</T>
          <T soft size={13}>{data.day.note ?? 'No attendance or classes today. Enjoy the day.'}</T>
        </View>
      ) : hero ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Take attendance for ${classLabel(hero.className)} ${hero.sectionName}`}
          onPress={() => open(hero.sectionId)} style={({ pressed }) => [st.hero, pressed && st.pressed]}>
          <View style={st.heroGlow} />
          <T size={13} style={{ color: '#CDEFF8' }}>{hero.isClassTeacher ? 'Your class · roll call' : 'Attendance to take'}</T>
          <T display size={28} style={{ color: '#fff' }}>{classLabel(hero.className)} {hero.sectionName}</T>
          <T size={14} style={{ color: '#fff' }}>{hero.studentCount} students · not marked yet</T>
          <View style={st.heroBtn}><T bold size={14} style={{ color: C.goldInk }}>Take attendance</T></View>
        </Pressable>
      ) : data.sections.length ? (
        <View style={[st.doneCard]}>
          <View style={st.doneDot} />
          <T bold size={15} style={{ color: C.lagoonDeep, flex: 1 }}>{todo === 0 ? 'Attendance is done for all your classes today.' : ''}</T>
        </View>
      ) : null}

      {data.onLeave ? (
        <View style={st.leaveBanner}>
          <T bold size={15} style={{ color: C.marigold }}>You are on leave today{data.onLeave === 'first_half' ? ' (first half)' : data.onLeave === 'second_half' ? ' (second half)' : data.onLeave === 'periods' ? ' (some periods)' : ''}.</T>
          <T soft size={13}>The principal arranges cover for your classes.</T>
        </View>
      ) : null}

      {data.schedule?.length ? (
        <View style={{ gap: 8 }}>
          <T bold size={17}>Today&apos;s periods{data.day ? <T soft size={14}>  {data.day.label}</T> : null}</T>
          {data.schedule.map((p) => (
            <Pressable key={`${p.periodNo}-${p.sectionId}`} accessibilityRole="button" disabled={p.onLeave}
              accessibilityLabel={`Period ${p.periodNo}, ${p.classLabel}${p.isCover ? ', covering' : ''}`}
              onPress={() => open(p.sectionId)}
              style={({ pressed }) => [st.period, p.isCover && st.periodCover, p.onLeave && { opacity: 0.5 }, pressed && st.pressed]}>
              <View style={[st.pNo, p.isCover && { backgroundColor: C.gold }]}><T display size={15} style={{ color: p.isCover ? C.goldInk : C.boardDeep }}>{p.periodNo}</T></View>
              <View style={{ flex: 1 }}>
                <T bold size={15}>{p.classLabel}<T soft size={14}> · {p.subject ?? 'Activity'}</T></T>
                <T soft size={12}>{[p.time ? `${p.time.startsAt}–${p.time.endsAt}` : null, p.isCover ? `Covering for ${p.coveredFor ?? 'a teacher on leave'}` : null, p.onLeave ? 'You are on leave' : null].filter(Boolean).join(' · ') || ' '}</T>
              </View>
              {p.isCover ? <Pill tone="todo" text="Cover" /> : null}
            </Pressable>
          ))}
        </View>
      ) : data.day?.noClasses ? (
        <View style={st.leaveBanner}><T bold size={15} style={{ color: C.inkSoft }}>No classes today{data.day.note ? `: ${data.day.note}` : ''}.</T></View>
      ) : null}

      {marks.total ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/marks')} style={({ pressed }) => [st.marks, pressed && st.pressed]}>
          <View style={{ flex: 1 }}>
            <T bold size={16}>Marks</T>
            <T soft size={13}>{marks.pending ? `${marks.pending} ${marks.pending === 1 ? 'subject' : 'subjects'} still to enter` : 'All marks entered'}</T>
          </View>
          <View style={[st.small, marks.pending ? { backgroundColor: C.gold } : null]}>
            <T bold size={13} style={{ color: marks.pending ? C.goldInk : C.board }}>{marks.pending ? 'Enter marks' : 'Review'}</T>
          </View>
        </Pressable>
      ) : null}

      <T bold size={17} style={{ marginTop: 4 }}>Your classes</T>
      {data.sections.length === 0 ? (
        <Card style={{ gap: 6 }}>
          <T bold size={17}>No classes are assigned to you yet</T>
          <T soft>The principal chooses class teachers and subject teachers on the school website.</T>
        </Card>
      ) : data.sections.map((x) => {
        const day = x.taken.find((t) => t.periodNo === 0);
        const periodsDone = x.taken.filter((t) => t.periodNo > 0).map((t) => t.periodNo);
        return (
          <View key={x.sectionId} style={st.cls}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Attendance for ${classLabel(x.className)} ${x.sectionName}`}
              onPress={() => open(x.sectionId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={st.badge}><T display size={17} style={{ color: C.boardDeep }}>{x.className}{x.sectionName}</T></View>
              <View style={{ flex: 1 }}>
                <T bold size={16}>{classLabel(x.className)} {x.sectionName}</T>
                <T soft size={13} numberOfLines={2}>{[x.isClassTeacher ? 'Class teacher' : null, x.subjects.map((y) => y.name).join(', ') || null, `${x.studentCount} students`].filter(Boolean).join(' · ')}</T>
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 150 }}>
                {data.mode === 'daily'
                  ? (day ? <Pill tone="done" text={`${day.present} present, ${day.absent} absent${day.leave ? `, ${day.leave} leave` : ''}`} /> : <Pill tone="todo" text="Attendance not taken" />)
                  : (periodsDone.length ? <Pill tone="done" text={`Periods done: ${periodsDone.join(', ')}`} /> : <Pill tone="todo" text="No periods taken" />)}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Give homework to ${classLabel(x.className)} ${x.sectionName}`}
                onPress={() => router.push({ pathname: '/homework/new', params: { sectionId: x.sectionId } })}
                style={({ pressed }) => [st.small, pressed && st.pressed]}>
                <T bold size={13} style={{ color: C.board }}>Give homework</T>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Pressable accessibilityRole="button" onPress={() => router.push('/leave')} style={st.cover}>
        <T bold size={14} style={{ color: C.ink }}>Need leave?</T>
        <T soft size={13}>Apply here. The principal approves it and arranges cover.</T>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 26, padding: 20, gap: 4, backgroundColor: C.board, overflow: 'hidden', ...SH.glow(C.board) },
  heroGlow: { position: 'absolute', width: 170, height: 170, right: -50, bottom: -80, borderRadius: 85, backgroundColor: C.lagoon, opacity: 0.45 },
  heroBtn: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.gold },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: 18, backgroundColor: C.lagoonWash },
  doneDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.lagoon },
  cls: { borderRadius: 20, padding: 16, gap: 12, backgroundColor: '#F6FAFC', ...SH.raised },
  badge: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.boardWash, alignItems: 'center', justifyContent: 'center' },
  small: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fff', ...SH.lift },
  marks: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, padding: 16, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, ...SH.lift },
  leaveBanner: { borderRadius: 18, padding: 14, gap: 2, backgroundColor: C.marigoldWash },
  period: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: '#fff', ...SH.lift },
  periodCover: { backgroundColor: '#FFF8EC', borderWidth: 1.5, borderColor: C.gold },
  pNo: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.boardWash },
  cover: { marginTop: 4, padding: 16, borderRadius: 18, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, alignItems: 'center', gap: 2 },
  pressed: { transform: [{ scale: 0.98 }] },
});
