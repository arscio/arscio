// Marks, as teachers send them: each exam subject by subject, then class tests.
// During the 7 days a teacher can still correct marks they show as "Provisional"
// (the student can check the paper and ask the teacher); after that they are final.
import { useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { API_URL, ApiError, call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C, SH } from '@/lib/theme';
import { Button, Card, ErrorText, Loading, T } from '@/components/ui';
import { SchoolBand } from '@/components/School';

interface Subject {
  subjectId: string; subject: string; marks: number | null; max: number | null; internal: number | null; internalMax: number | null;
  grade: string | null; absent: boolean; provisional: boolean; finalFrom: string;
}
interface Data {
  exams: { id: string; name: string; termName: string; subjects: Subject[] }[];
  classTests: { id: string; title: string; heldOn: string; max: number; subject: string; marks: number | null; absent: boolean }[];
}
interface Sheet {
  status: 'not_yet' | 'not_ready' | 'with_school' | 'ready'; resultDate: string | null;
  summary?: { pct: number | null; grade: string | null; result: string; note: string | null }; downloadUrl?: string;
}
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const day = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function score(s: Subject) {
  if (s.absent) return { big: 'Absent', small: '' };
  if (s.marks == null) return { big: s.grade ?? '—', small: '' };
  if (s.internalMax) {
    return { big: `${n(s.marks + (s.internal ?? 0))}/${n((s.max ?? 0) + s.internalMax)}`,
      small: `Written ${n(s.marks)}/${n(s.max ?? 0)} · Internal ${n(s.internal ?? 0)}/${n(s.internalMax)}` };
  }
  return { big: `${n(s.marks)}/${n(s.max ?? 0)}`, small: '' };
}

export default function Marks() {
  const { child } = useParent();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const load = async () => {
    if (!child) return;
    try {
      setD(await call<Data>('GET', `/parent/children/${child.id}/marks`, undefined, { schoolId: child.schoolId })); setError(null);
      setSheet(await call<Sheet>('GET', `/parent/children/${child.id}/marksheet`, undefined, { schoolId: child.schoolId }).catch(() => null));
    }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setD(null); void load(); }, [child?.id]);
  if (!d) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <SchoolBand />
      <View style={{ paddingHorizontal: 16, gap: 14 }}>
        {sheet && sheet.status !== 'not_yet' ? (
          <View style={[st.sheet, { gap: 8 }]}>
            <T display size={20}>Final marksheet</T>
            {sheet.status === 'ready' && sheet.summary ? (<>
              <T size={16}>{sheet.summary.pct != null ? `${n(sheet.summary.pct)}%${sheet.summary.grade ? ` · Grade ${sheet.summary.grade}` : ''} · ` : ''}{sheet.summary.result}</T>
              {sheet.summary.note ? <T soft size={14}>{sheet.summary.note}</T> : null}
              <Button label="Download marksheet" onPress={async () => {
                // Ask for a fresh link each time (links work for 10 minutes)
                const fresh = await call<Sheet>('GET', `/parent/children/${child!.id}/marksheet`, undefined, { schoolId: child!.schoolId });
                if (fresh.downloadUrl) await Linking.openURL(`${API_URL}${fresh.downloadUrl}`);
              }} />
              <T soft size={12}>Signed by the principal. The QR code on it lets anyone check it is genuine.</T>
            </>) : sheet.status === 'with_school' ? (
              <T soft>Please meet the class teacher or the principal about the result. The marksheet will be here after that.</T>
            ) : <T soft>The marksheet is being prepared. Please check again soon.</T>}
          </View>
        ) : sheet?.resultDate ? (
          <Card><T soft>Results will be out on {day(sheet.resultDate)}.</T></Card>
        ) : null}
        {d.exams.length === 0 && d.classTests.length === 0 ? (
          <Card><T soft>No marks yet. They appear here as soon as teachers send them.</T></Card>
        ) : null}
        {[...d.exams].reverse().map((x) => (
          <View key={x.id} style={st.sheet}>
            <T soft size={13}>{x.termName}</T>
            <T display size={20}>{x.name}</T>
            {x.subjects.map((s) => {
              const sc = score(s);
              return (
                <View key={s.subjectId} style={st.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T bold size={15}>{s.subject}</T>
                    {sc.small ? <T soft size={12}>{sc.small}</T> : null}
                    {s.provisional
                      ? <T size={12} style={{ color: C.marigold }}>Provisional · can change until {day(s.finalFrom)}</T>
                      : <T size={12} style={{ color: C.lagoonDeep }}>Final</T>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T bold size={18} style={{ color: s.absent ? C.marigold : C.ink }}>{sc.big}</T>
                    {s.grade && s.marks != null ? <T soft size={13}>Grade {s.grade}</T> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        {d.classTests.length ? (
          <View style={st.sheet}>
            <T display size={20}>Class tests</T>
            <T soft size={13}>Teachers&apos; own tests. They don&apos;t count in the final result.</T>
            {d.classTests.map((t) => (
              <View key={t.id} style={st.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T bold size={15}>{t.title}</T>
                  <T soft size={12}>{t.subject} · {day(t.heldOn)}</T>
                </View>
                <T bold size={18} style={{ color: t.absent ? C.marigold : C.ink }}>{t.absent ? 'Absent' : t.marks == null ? '—' : `${n(t.marks)}/${n(t.max)}`}</T>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  sheet: { borderRadius: 24, padding: 16, gap: 4, backgroundColor: '#fff', ...SH.lift },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#E6EEF2' },
});
