// Marks to enter: every exam x class x subject this teacher is responsible for.
// Late and unfinished first, then submitted (still correctable), then upcoming and final.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { C, SH, classLabel, sectionLabel } from '@/lib/theme';
import { ErrorText, Loading, Pill, T } from '@/components/ui';

export interface MarksTask {
  examId: string; examName: string; termName: string; locked: boolean;
  sectionId: string; className: string; sectionName: string; style: string;
  subjectId: string; subjectName: string; total: number; entered: number;
  startsOn: string | null; marksDueOn: string | null; editableUntil: string | null; overdue: boolean;
  status: 'upcoming' | 'to_do' | 'draft' | 'submitted' | 'final' | 'locked';
}

const day = (d: string | null) => d ? new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';
const ORDER = { to_do: 1, draft: 1, submitted: 2, upcoming: 3, final: 4, locked: 4 } as const;

export default function MarksList() {
  const [tasks, setTasks] = useState<MarksTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setTasks((await call<{ tasks: MarksTask[] }>('GET', '/marks/tasks')).tasks); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (!tasks) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;

  const sorted = [...tasks].sort((a, b) => Number(b.overdue) - Number(a.overdue) || ORDER[a.status] - ORDER[b.status]);
  const pill = (t: MarksTask) => {
    if (t.status === 'locked') return <Pill tone="plain" text="Locked" />;
    if (t.status === 'upcoming') return <Pill tone="plain" text={`Exam from ${day(t.startsOn)}`} />;
    if (t.status === 'final') return <Pill tone="done" text="Final" />;
    if (t.status === 'submitted') return <Pill tone="done" text={`Submitted · fix until ${day(t.editableUntil)}`} />;
    if (t.overdue) return <Pill tone="todo" text={`Late · was due ${day(t.marksDueOn)}`} />;
    return <Pill tone="todo" text={`${t.entered} of ${t.total}${t.marksDueOn ? ` · due ${day(t.marksDueOn)}` : ''}`} />;
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorText error={error} />
      <Pressable accessibilityRole="button" onPress={() => router.push('/class-tests')}
        style={({ pressed }) => [st.card, { flexDirection: 'row', alignItems: 'center' }, pressed && { transform: [{ scale: 0.98 }] }]}>
        <View style={{ flex: 1 }}>
          <T bold size={16}>My class tests</T>
          <T soft size={13}>Your own tests. Parents see the marks; they don&apos;t count in the result.</T>
        </View>
        <T bold size={20} style={{ color: C.board }}>›</T>
      </Pressable>
      {sorted.length === 0 ? (
        <View style={st.card}><T bold size={16}>No exams to mark yet</T><T soft>The principal adds exams on the school website. They will show here for the subjects you enter marks for.</T></View>
      ) : sorted.map((t) => {
        return (
          <Pressable key={`${t.examId}-${t.sectionId}-${t.subjectId}`} accessibilityRole="button"
            accessibilityLabel={`${t.subjectName}, ${sectionLabel(t.className, t.sectionName)}, ${t.examName}`}
            onPress={() => router.push({ pathname: '/marks/enter', params: { examId: t.examId, sectionId: t.sectionId, subjectId: t.subjectId } })}
            style={({ pressed }) => [st.card, pressed && { transform: [{ scale: 0.98 }] }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={st.badge}><T display size={16} style={{ color: C.boardDeep }}>{t.className}{t.sectionName}</T></View>
              <View style={{ flex: 1 }}>
                <T bold size={16}>{t.subjectName}</T>
                <T soft size={13}>{t.termName} · {t.examName}</T>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={st.track}><View style={[st.fill, { width: `${t.total ? Math.round((t.entered / t.total) * 100) : 0}%` }]} /></View>
              {pill(t)}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 20, padding: 16, gap: 12, backgroundColor: '#F6FAFC', ...SH.raised },
  badge: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.boardWash, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.paper, overflow: 'hidden', ...SH.inset },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.lagoon },
});
