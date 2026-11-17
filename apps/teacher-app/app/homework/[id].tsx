// Who handed in the homework: tap each child (Handed in / Late / Not handed in),
// then send the result to parents. After that, a changed tick tells only that family.
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, call } from '@/lib/api';
import { C, SH } from '@/lib/theme';
import { Avatar, Button, ErrorText, Loading, T } from '@/components/ui';
import { shortDate } from './index';

type Status = 'submitted' | 'late' | 'not_submitted';
interface Data {
  homework: { id: string; title: string; dueOn: string | null; subjectName: string | null; reportSentAt: string | null; canMark: boolean };
  students: { id: string; firstName: string; lastName: string | null; rollNo: number | null; photoUrl: string | null; status: Status | null }[];
}
const OPTIONS: { v: Status; label: string; color: string }[] = [
  { v: 'submitted', label: 'Done', color: C.lagoon },
  { v: 'late', label: 'Late', color: C.gold },
  { v: 'not_submitted', label: 'Not', color: C.red },
];

export default function Submissions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Data | null>(null);
  const [ticks, setTicks] = useState<Record<string, Status | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    call<Data>('GET', `/homework/${id}/submissions`).then((r) => {
      setD(r); setTicks(Object.fromEntries(r.students.map((x) => [x.id, x.status])));
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
  }, [id]);
  if (!d) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;

  const sent = !!d.homework.reportSentAt;
  const filled = Object.values(ticks).filter(Boolean).length;
  const save = async (sendReport: boolean) => {
    setBusy(true); setError(null);
    try {
      const rows = Object.entries(ticks).filter(([, v]) => v).map(([studentId, status]) => ({ studentId, status }));
      const r = await call<{ parentsTold: number }>('PUT', `/homework/${id}/submissions`, { rows, sendReport });
      setDone(r.parentsTold ? `${r.parentsTold} ${r.parentsTold === 1 ? 'family was' : 'families were'} told.` : 'Saved.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  if (done) {
    return (
      <View style={{ padding: 16, gap: 14 }}>
        <T display size={22}>Saved</T>
        <T size={16}>{done}</T>
        <Button label="Done" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Who handed it in' }} />
      <FlatList
        data={d.students}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 150 + insets.bottom }}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 4 }}>
            <T soft size={14}>{d.homework.subjectName ?? 'Homework'}{d.homework.dueOn ? ` · due ${shortDate(d.homework.dueOn.slice(0, 10))}` : ''}</T>
            <T display size={22}>{d.homework.title}</T>
            <T soft size={14}>{sent ? 'The result has been sent. If you change a tick, only that family is told.' : 'Tick every child, then send the result to parents.'}</T>
            {!d.homework.canMark ? <T size={14} style={{ color: C.marigold }}>You can tick from the due day.</T> : null}
            <Button kind="quiet" label="Everyone handed it in" style={{ alignSelf: 'flex-start' }}
              onPress={() => setTicks(Object.fromEntries(d.students.map((x) => [x.id, ticks[x.id] ?? 'submitted'])))} />
          </View>
        }
        renderItem={({ item }) => (
          <View style={st.row}>
            <Avatar name={`${item.firstName} ${item.lastName ?? ''}`} uri={item.photoUrl} size={40} />
            <View style={{ flex: 1 }}>
              <T bold size={15} numberOfLines={2}>{item.firstName} {item.lastName ?? ''}</T>
              <T soft size={12}>Roll {item.rollNo ?? '-'}</T>
            </View>
            <View style={st.seg} accessibilityRole="radiogroup" accessibilityLabel={`${item.firstName}`}>
              {OPTIONS.map((o) => {
                const on = ticks[item.id] === o.v;
                return (
                  <Pressable key={o.v} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label}
                    disabled={!d.homework.canMark} onPress={() => setTicks({ ...ticks, [item.id]: o.v })}
                    style={[st.opt, on && { backgroundColor: o.color, ...SH.glow(o.color) }]}>
                    <T bold size={13} style={{ color: on ? '#fff' : C.inkSoft }}>{o.label}</T>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      />
      <View style={[st.bar, { paddingBottom: 12 + insets.bottom }]}>
        <ErrorText error={error} />
        <T size={15} style={{ textAlign: 'center' }}><T bold size={15}>{filled}</T> of {d.students.length} ticked</T>
        {sent ? (
          <Button label="Save changes" busy={busy} disabled={!d.homework.canMark} onPress={() => void save(false)} />
        ) : (
          <Button label="Send to parents" busy={busy} disabled={!d.homework.canMark || filled < d.students.length} onPress={() => void save(true)} />
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.sheet, marginHorizontal: 16, marginBottom: 8, padding: 8, borderRadius: 18, ...SH.lift },
  seg: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: 12, backgroundColor: C.paper, ...SH.inset },
  opt: { minWidth: 44, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 8, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: 'rgba(238,244,247,0.94)', borderTopWidth: 1, borderTopColor: C.glassEdge },
});
