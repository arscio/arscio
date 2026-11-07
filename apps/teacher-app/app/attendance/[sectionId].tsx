// The attendance register for one class.
// Fastest way for a teacher: tap "Everyone present", then tap A for the few who are absent, then Save.
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, call } from '@/lib/api';
import { C, classLabel, longDate } from '@/lib/theme';
import { Button, Card, ErrorText, Loading, T } from '@/components/ui';
import type { Today } from '../index';

type Status = 'present' | 'absent' | 'late' | 'leave';
interface Sheet {
  section: { className: string; sectionName: string };
  date: string; period: number;
  session: { takenAt: string; takenBy: string } | null;
  students: { id: string; firstName: string; lastName: string | null; rollNo: number | null; status: Status | 'half_day' | null }[];
}

const OPTIONS: { value: Status; short: string; label: string; bg: string; fg: string }[] = [
  { value: 'present', short: 'P', label: 'Present', bg: C.board, fg: '#fff' },
  { value: 'absent', short: 'A', label: 'Absent', bg: C.red, fg: '#fff' },
  { value: 'late', short: 'Late', label: 'Late', bg: C.ink, fg: '#fff' },
  { value: 'leave', short: 'Leave', label: 'On leave', bg: C.marigold, fg: '#fff' },
];

export default function AttendanceScreen() {
  const { sectionId } = useLocalSearchParams<{ sectionId: string }>();
  const insets = useSafeAreaInsets();
  const [today, setToday] = useState<Today | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ present: number; absent: number; leave: number; parentAlerts: number } | null>(null);

  // Which mode is the school in, and (for period mode) which period to start on.
  useEffect(() => {
    call<Today>('GET', '/teacher/today').then((t) => {
      setToday(t);
      if (t.mode === 'daily') setPeriod(0);
      else {
        const taken = new Set(t.sections.find((s) => s.sectionId === sectionId)?.taken.map((x) => x.periodNo) ?? []);
        setPeriod(Array.from({ length: t.periodsPerDay }, (_, i) => i + 1).find((p) => !taken.has(p)) ?? 1);
      }
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
  }, [sectionId]);

  const loadSheet = useCallback(async (p: number) => {
    setSheet(null); setDone(null); setError(null);
    try {
      const s = await call<Sheet>('GET', `/attendance/sheet?sectionId=${sectionId}&period=${p}`);
      setSheet(s);
      const m: Record<string, Status> = {};
      for (const st of s.students) if (st.status) m[st.id] = st.status === 'half_day' ? 'late' : st.status;
      setMarks(m);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, [sectionId]);
  useEffect(() => { if (period !== null) void loadSheet(period); }, [period, loadSheet]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 };
    for (const st of sheet?.students ?? []) {
      const v = marks[st.id];
      if (v) c[v] += 1; else c.unmarked += 1;
    }
    return c;
  }, [marks, sheet]);

  if (!sheet || !today) {
    return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;
  }
  const title = `${classLabel(sheet.section.className)} ${sheet.section.sectionName}`;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ present: number; absent: number; leave: number; parentAlerts: number }>('PUT', '/attendance/sheet', {
        sectionId, date: sheet.date, period: sheet.period,
        marks: sheet.students.map((s) => ({ studentId: s.id, status: marks[s.id] })),
      });
      setDone(r);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <View style={{ padding: 16, gap: 14 }}>
        <Stack.Screen options={{ title }} />
        <Card style={{ gap: 8, borderLeftWidth: 4, borderLeftColor: C.board }}>
          <T display size={22}>Attendance saved</T>
          <T size={17}>{title}{sheet.period ? `, period ${sheet.period}` : ''}: {done.present} present, {done.absent} absent{done.leave ? `, ${done.leave} on leave` : ''}.</T>
          {done.parentAlerts > 0
            ? <T soft>The parents of {done.parentAlerts} absent {done.parentAlerts === 1 ? 'child' : 'children'} will get a message in the parent app.</T>
            : null}
        </Card>
        <Button label="Back to today" onPress={() => router.back()} />
        <Button kind="plain" label="Make a change" onPress={() => setDone(null)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title }} />
      <FlatList
        data={sheet.students}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            <View>
              <T soft size={14}>{longDate(sheet.date)}</T>
              <T display size={22}>{title}</T>
              {sheet.session
                ? <T soft size={14}>Taken by {sheet.session.takenBy} at {new Date(sheet.session.takenAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. You can still change it today.</T>
                : null}
            </View>
            {today.mode === 'period' ? (
              <View style={{ gap: 6 }}>
                <T bold size={15}>Period</T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
                  {Array.from({ length: today.periodsPerDay }, (_, i) => i + 1).map((p) => {
                    const takenHere = today.sections.find((s) => s.sectionId === sectionId)?.taken.some((t) => t.periodNo === p);
                    const on = p === period;
                    return (
                      <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: on }}
                        accessibilityLabel={`Period ${p}${takenHere ? ', taken' : ''}`} onPress={() => setPeriod(p)}
                        style={[s.periodChip, on && { backgroundColor: C.ink, borderColor: C.ink }]}>
                        <T bold style={{ color: on ? '#fff' : C.ink }}>{p}</T>
                        {takenHere ? <View style={[s.dot, { backgroundColor: on ? '#fff' : C.board }]} /> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
            {sheet.students.length === 0 ? (
              <Card><T soft>No students are in this section yet. The office adds them on the school website.</T></Card>
            ) : (
              <Button kind="plain" label={counts.unmarked === sheet.students.length ? 'Everyone present' : 'Mark the rest present'}
                disabled={counts.unmarked === 0}
                onPress={() => {
                  const m = { ...marks };
                  for (const st of sheet.students) if (!m[st.id]) m[st.id] = 'present';
                  setMarks(m);
                }} />
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const v = marks[item.id];
          return (
            <View style={[s.row, index === 0 && { borderTopWidth: 1 }, v === 'absent' && { backgroundColor: C.redWash }]}>
              <View style={s.roll}><T soft size={15}>{item.rollNo ?? '-'}</T></View>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <T bold size={16} numberOfLines={2}>{item.firstName} {item.lastName ?? ''}</T>
                {!v ? <T size={13} style={{ color: '#7a520a' }}>Not marked</T> : null}
              </View>
              <View style={s.options} accessibilityRole="radiogroup" accessibilityLabel={`${item.firstName}'s attendance`}>
                {OPTIONS.map((o) => {
                  const on = v === o.value;
                  return (
                    <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }}
                      accessibilityLabel={o.label} hitSlop={4}
                      onPress={() => setMarks({ ...marks, [item.id]: o.value })}
                      style={[s.opt, o.short.length > 1 && { minWidth: 50 }, on && { backgroundColor: o.bg, borderColor: o.bg }]}>
                      <T bold size={o.short.length > 1 ? 13 : 16} style={{ color: on ? o.fg : C.inkSoft }}>{o.short}</T>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        }}
      />

      {sheet.students.length ? (
        <View style={[s.bar, { paddingBottom: 12 + insets.bottom }]}>
          <ErrorText error={error} />
          <T size={15} style={{ textAlign: 'center' }}>
            <T bold size={15}>{counts.present + counts.late}</T> present{'   '}
            <T bold size={15} style={{ color: C.red }}>{counts.absent}</T> absent
            {counts.leave ? <>{'   '}<T bold size={15}>{counts.leave}</T> on leave</> : null}
            {counts.unmarked ? <>{'   '}<T bold size={15} style={{ color: '#7a520a' }}>{counts.unmarked}</T> not marked</> : null}
          </T>
          <Button label={counts.unmarked ? `Mark all ${counts.unmarked} to save` : 'Save attendance'} busy={busy}
            disabled={counts.unmarked > 0} onPress={save} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.sheet, minHeight: 64,
    borderBottomWidth: 1, borderColor: C.rule, paddingRight: 10,
  },
  roll: {
    width: 46, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 2, borderRightColor: C.margin, marginRight: 10,
  },
  options: { flexDirection: 'row', gap: 6 },
  opt: {
    minWidth: 40, height: 44, borderRadius: 8, borderWidth: 1, borderColor: C.ruleStrong,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: '#fff',
  },
  periodChip: {
    width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: C.ruleStrong, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3, position: 'absolute', bottom: 6 },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.sheet, gap: 8,
    borderTopWidth: 1, borderTopColor: C.rule, paddingHorizontal: 16, paddingTop: 10,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, elevation: 8,
  },
});

