// The child's report card, as the school published it. Looks like a printed card:
// one term at a time, subject by subject, with the class teacher's remark.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C, SH, classLabel } from '@/lib/theme';
import { ErrorText, Loading, T } from '@/components/ui';
import { SchoolBand, SchoolLogo } from '@/components/School';

interface Cell { examId: string; marks: number | null; max: number; grade: string | null; absent: boolean; entered: boolean }
interface Report {
  student: { name: string; className: string; sectionName: string; rollNo: number | null; classTeacher: string | null };
  school: { name: string };
  yearName: string;
  style: 'grades_only' | 'marks_and_grades';
  terms: {
    id: string; name: string;
    exams: { id: string; name: string; max: number; weightagePct: number }[];
    rows: { subjectId: string; subject: string; cells: Cell[]; pct: number | null; grade: string | null }[];
    pct: number | null; grade: string | null; remark: string | null;
  }[];
  attendance: { present: number; days: number; pct: number | null };
}

const pct = (n: number | null) => (n === null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);
const gradeTone = (g: string | null) => (!g ? C.inkSoft : /^(A|A1|A2|A\+)$/.test(g) ? C.lagoonDeep : /^(D|E)$/.test(g) ? C.marigold : C.boardDeep);

export default function ReportScreen() {
  const { child, accent } = useParent();
  const [r, setR] = useState<Report | null>(null);
  const [termId, setTermId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!child) return;
    setR(null);
    call<Report>('GET', `/parent/children/${child.id}/report`, undefined, { schoolId: child.schoolId })
      .then((x) => { setR(x); setTermId(x.terms.at(-1)?.id ?? null); setError(null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
  }, [child]);

  if (!child) return <Loading />;
  const term = r?.terms.find((t) => t.id === termId);
  const marks = r?.style === 'marks_and_grades';

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <SchoolBand />
      <View style={{ padding: 16, gap: 14 }}>
        <ErrorText error={error} />
        {!r ? (error ? null : <View style={{ height: 200 }}><Loading /></View>) : r.terms.length === 0 ? (
          <View style={st.empty}>
            <T bold size={17}>No report card yet</T>
            <T soft>The school will publish results here after each term. You&apos;ll get a message when it&apos;s ready.</T>
          </View>
        ) : (
          <>
            {r.terms.length > 1 ? (
              <View style={st.seg} accessibilityRole="tablist">
                {r.terms.map((t) => {
                  const on = t.id === termId;
                  return (
                    <Pressable key={t.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTermId(t.id)}
                      style={[st.segItem, on && { backgroundColor: '#fff', ...SH.lift }]}>
                      <T bold size={14} style={{ color: on ? C.ink : C.inkSoft }}>{t.name}</T>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {term ? (
              <View style={st.paper}>
                <View style={[st.paperTop, { backgroundColor: accent }]} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <SchoolLogo child={child} size={44} />
                  <View style={{ flex: 1 }}>
                    <T bold size={15} style={{ color: accent }} numberOfLines={2}>{r.school.name}</T>
                    <T soft size={12}>Report card · {term.name} · {r.yearName}</T>
                  </View>
                </View>
                <View style={st.dashed}>
                  <T bold size={16}>{r.student.name}</T>
                  <T soft size={13}>{classLabel(r.student.className)} {r.student.sectionName}{r.student.rollNo ? ` · Roll ${String(r.student.rollNo).padStart(2, '0')}` : ''}</T>
                </View>

                {marks && term.pct !== null ? (
                  <View style={st.overall}>
                    <View>
                      <T soft size={12}>Overall</T>
                      <T display size={34}>{pct(term.pct)}</T>
                    </View>
                    <View style={[st.bigGrade, { borderColor: gradeTone(term.grade) }]}><T display size={22} style={{ color: gradeTone(term.grade) }}>{term.grade}</T></View>
                  </View>
                ) : null}

                {term.rows.map((row) => (
                  <View key={row.subjectId} style={st.subject}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T bold size={15}>{row.subject}</T>
                      <T soft size={12}>
                        {row.cells.map((c, i) => {
                          const x = term.exams[i]!;
                          const v = !c.entered ? 'pending' : c.absent ? 'absent' : marks ? `${c.marks}/${c.max}` : c.grade;
                          return `${x.name}: ${v}`;
                        }).join('   ')}
                      </T>
                    </View>
                    {marks ? <T bold size={15} style={{ width: 62, textAlign: 'right' }}>{pct(row.pct)}</T> : null}
                    <View style={[st.grade, { borderColor: gradeTone(row.grade) }]}><T bold size={14} style={{ color: gradeTone(row.grade) }}>{row.grade ?? '–'}</T></View>
                  </View>
                ))}

                {term.remark ? (
                  <View style={st.remark}>
                    <T soft size={12}>{r.student.classTeacher ? `${r.student.classTeacher}, class teacher` : 'Class teacher'}</T>
                    <T size={15} style={{ fontStyle: 'italic' }}>&ldquo;{term.remark}&rdquo;</T>
                  </View>
                ) : null}
                {r.attendance.days ? <T soft size={13}>Attendance this year: {r.attendance.present} of {r.attendance.days} days ({pct(r.attendance.pct)})</T> : null}
              </View>
            ) : null}
            <T soft size={12} style={{ textAlign: 'center' }}>The school keeps the signed printed copy.</T>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  empty: { borderRadius: 24, padding: 18, gap: 6, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge },
  seg: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, backgroundColor: C.paper, ...SH.inset },
  segItem: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  paper: {
    backgroundColor: '#FFFEFB', borderRadius: 8, padding: 18, paddingTop: 22, gap: 12, overflow: 'hidden',
    boxShadow: '0px 1px 2px rgba(11,59,76,0.12), 0px 18px 36px rgba(11,59,76,0.14)',
  },
  paperTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 5 },
  dashed: { borderWidth: 1, borderStyle: 'dashed', borderColor: C.ruleStrong, borderRadius: 8, padding: 12, gap: 2 },
  overall: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  bigGrade: { width: 64, height: 64, borderRadius: 32, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  subject: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.rule, borderStyle: 'dotted' },
  grade: { width: 42, height: 32, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  remark: { borderRadius: 12, padding: 12, gap: 4, backgroundColor: C.marigoldWash },
});
