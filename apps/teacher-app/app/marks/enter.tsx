// Enter one subject's marks for one class. Big number boxes, the grade shows as you
// type, AB for absent. Nursery/KG: tap a grade instead.
// "Save" keeps a draft parents can't see; "Submit" shows them to parents and starts the
// 7 days in which the teacher can still correct them (each family is told of a change).
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, call } from '@/lib/api';
import { C, F, SH, classLabel, sectionLabel } from '@/lib/theme';
import { Avatar, Button, ErrorText, Loading, T } from '@/components/ui';

interface Band { min?: number; max?: number; grade: string }
interface Sheet {
  exam: { id: string; name: string; termName: string; maxMarks: string; locked: boolean; internalMax: string | null; marksDueOn: string | null };
  section: { id: string; className: string; sectionName: string; style: 'grades_only' | 'marks_and_grades' };
  subject: { id: string; name: string };
  gradeOptions: { grade: string; label: string | null }[];
  scale: Band[];
  canEdit: boolean; whyNot: string | null;
  submission: { submittedAt: string; editableUntil: string; open: boolean } | null;
  students: { id: string; firstName: string; lastName: string | null; rollNo: number | null; photoUrl: string | null; marks: string | null;
    grade: string | null; absent: boolean; internal: string | null }[];
}
type Row = { marks: string; grade: string; absent: boolean; internal: string };
const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export default function EnterMarks() {
  const p = useLocalSearchParams<{ examId: string; sectionId: string; subjectId: string }>();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<Sheet | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    call<Sheet>('GET', `/marks/sheet?examId=${p.examId}&sectionId=${p.sectionId}&subjectId=${p.subjectId}`).then((r) => {
      setS(r);
      setRows(Object.fromEntries(r.students.map((x) => [x.id, { marks: x.marks != null ? String(Number(x.marks)) : '', grade: x.grade ?? '', absent: x.absent,
        internal: x.internal != null ? String(Number(x.internal)) : '' }])));
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
  }, [p.examId, p.sectionId, p.subjectId, version]);

  const max = s ? Number(s.exam.maxMarks) : 0;
  const intMax = s?.exam.internalMax ? Number(s.exam.internalMax) : 0;
  const gradesOnly = s?.section.style === 'grades_only';
  const counts = useMemo(() => {
    const v = Object.values(rows);
    return { filled: v.filter((r) => r.absent || (gradesOnly ? r.grade : r.marks !== '')).length,
      high: v.some((r) => !gradesOnly && ((r.marks !== '' && Number(r.marks) > max) || (intMax > 0 && r.internal !== '' && Number(r.internal) > intMax))) };
  }, [rows, gradesOnly, max, intMax]);
  if (!s) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;

  const submitted = !!s.submission;
  const gradeOf = (m: string, internal = '') => {
    if (m === '' || !max) return '';
    const pc = ((Number(m) + (Number(internal) || 0)) / (max + intMax)) * 100;
    return s.scale.find((b) => pc >= (b.min ?? 0) && pc <= (b.max ?? 100))?.grade ?? '';
  };
  const set = (id: string, patch: Partial<Row>) => { setSaved(false); setRows({ ...rows, [id]: { ...rows[id]!, ...patch } }); };
  const send = async (submit: boolean) => {
    setBusy(true); setError(null);
    try {
      await call('PUT', '/marks/sheet', {
        examId: s.exam.id, sectionId: s.section.id, subjectId: s.subject.id, submit,
        rows: s.students.map((x) => {
          const r = rows[x.id]!;
          return { studentId: x.id, absent: r.absent, marks: gradesOnly || r.marks === '' ? null : Number(r.marks), grade: gradesOnly ? r.grade || null : null,
            internal: intMax && r.internal !== '' ? Number(r.internal) : null };
        }),
      });
      setSaved(true);
      if (submit) router.back(); else setVersion((v) => v + 1);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const submit = () => Alert.alert('Submit marks?',
    'Parents will see these marks in their app now. You can still correct them for 7 days; each family is told about a change.',
    [{ text: 'Not yet', style: 'cancel' }, { text: 'Submit', onPress: () => void send(true) }]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `${s.subject.name}, ${sectionLabel(s.section.className, s.section.sectionName)}` }} />
      <FlatList
        data={s.students}
        keyExtractor={(x) => x.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 150 + insets.bottom }}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 4 }}>
            <T soft size={14}>{s.exam.termName}</T>
            <T display size={22}>{s.exam.name}</T>
            <T soft size={14}>{gradesOnly ? 'Tap a grade for each child.' : intMax ? `Written out of ${max}, internal out of ${intMax}.` : `Out of ${max}.`}</T>
            {s.submission ? (
              <T size={14} style={{ color: s.submission.open ? C.lagoonDeep : C.inkSoft }}>
                {s.submission.open ? `Submitted. Parents can see these. You can correct them until ${day(s.submission.editableUntil)}.` : 'Final: the 7 days for corrections are over.'}
              </T>
            ) : <T soft size={14}>Save keeps a draft parents can&apos;t see. Submit when everyone has marks or AB.</T>}
            {s.whyNot ? <T size={14} style={{ color: C.marigold }}>{s.whyNot}</T> : null}
          </View>
        }
        renderItem={({ item }) => {
          const r = rows[item.id]!;
          const high = !gradesOnly && r.marks !== '' && Number(r.marks) > max;
          return (
            <View style={[st.row, r.absent && { backgroundColor: C.marigoldWash }]}>
              <Avatar name={`${item.firstName} ${item.lastName ?? ''}`} uri={item.photoUrl} size={40} />
              <View style={{ flex: 1 }}>
                <T bold size={15} numberOfLines={2}>{item.firstName} {item.lastName ?? ''}</T>
                <T size={12} style={{ color: high ? C.red : C.inkSoft }}>
                  {high ? `More than ${max}` : intMax && r.internal !== '' && Number(r.internal) > intMax ? `Internal more than ${intMax}`
                    : `Roll ${item.rollNo ?? '-'}${!gradesOnly && r.marks !== '' && !r.absent ? ` · Grade ${gradeOf(r.marks, r.internal)}` : ''}`}
                </T>
              </View>
              {gradesOnly ? (
                <View style={st.seg} accessibilityRole="radiogroup">
                  {s.gradeOptions.map((g) => {
                    const on = r.grade === g.grade && !r.absent;
                    return (
                      <Pressable key={g.grade} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={g.label ?? g.grade}
                        disabled={!s.canEdit} onPress={() => set(item.id, { grade: on ? '' : g.grade, absent: false })}
                        style={[st.opt, on && { backgroundColor: C.board, ...SH.glow(C.board) }]}>
                        <T bold size={13} style={{ color: on ? '#fff' : C.inkSoft }}>{g.grade}</T>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <TextInput value={r.absent ? '' : r.marks} editable={s.canEdit && !r.absent} keyboardType="decimal-pad" maxLength={6}
                  accessibilityLabel={`Marks for ${item.firstName}`} placeholder={r.absent ? 'AB' : '–'} placeholderTextColor={C.inkSoft}
                  onChangeText={(v) => set(item.id, { marks: v.replace(/[^\d.]/g, '') })}
                  style={[st.box, high && { borderColor: C.red, borderWidth: 1.5 }]} />
              )}
              {intMax ? (
                <TextInput value={r.absent ? '' : r.internal} editable={s.canEdit && !r.absent} keyboardType="decimal-pad" maxLength={5}
                  accessibilityLabel={`Internal marks for ${item.firstName}`} placeholder="Int" placeholderTextColor={C.inkSoft}
                  onChangeText={(v) => set(item.id, { internal: v.replace(/[^\d.]/g, '') })}
                  style={[st.box, { width: 56 }, (intMax > 0 && r.internal !== '' && Number(r.internal) > intMax) ? { borderColor: C.red, borderWidth: 1.5 } : null]} />
              ) : null}
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: r.absent }} accessibilityLabel={`${item.firstName} was absent`}
                disabled={!s.canEdit} onPress={() => set(item.id, { absent: !r.absent })}
                style={[st.ab, r.absent && { backgroundColor: C.gold, ...SH.glow(C.gold) }]}>
                <T bold size={13} style={{ color: r.absent ? C.goldInk : C.inkSoft }}>AB</T>
              </Pressable>
            </View>
          );
        }}
      />
      <View style={[st.bar, { paddingBottom: 12 + insets.bottom }]}>
        <ErrorText error={error} />
        <T size={15} style={{ textAlign: 'center' }}><T bold size={15}>{counts.filled}</T> of {s.students.length} filled{saved ? ' · saved' : ''}</T>
        {submitted ? (
          <Button label="Save corrections" busy={busy} disabled={!s.canEdit || counts.high} onPress={() => void send(false)} />
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button kind="plain" label="Save draft" busy={busy} disabled={!s.canEdit || counts.high} onPress={() => void send(false)} /></View>
            <View style={{ flex: 1 }}><Button label="Submit" busy={busy} disabled={!s.canEdit || counts.high || counts.filled < s.students.length} onPress={submit} /></View>
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.sheet, marginHorizontal: 16, marginBottom: 8, padding: 8, borderRadius: 18, ...SH.lift },
  box: {
    width: 70, height: 46, borderRadius: 12, textAlign: 'center', fontFamily: F.bold, fontSize: 18, color: C.ink,
    backgroundColor: C.paper, ...SH.inset, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  ab: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper, ...SH.inset },
  seg: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: 12, backgroundColor: C.paper, ...SH.inset },
  opt: { minWidth: 30, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, gap: 8, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: Platform.OS === 'web' ? 'rgba(238,244,247,0.72)' : 'rgba(238,244,247,0.94)', borderTopWidth: 1, borderTopColor: C.glassEdge,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px) saturate(170%)' } as object) : {}),
  },
});
