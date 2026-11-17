// Class test marks. "Publish" sends each family their child's marks; later corrections are told too.
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, call } from '@/lib/api';
import { C, F, SH, classLabel, sectionLabel } from '@/lib/theme';
import { Avatar, Button, ErrorText, Loading, T } from '@/components/ui';
import { shortDate } from '../homework/index';

interface Data {
  test: { id: string; title: string; maxMarks: string; publishedAt: string | null; subjectName: string; heldOn: string };
  section: { className: string; sectionName: string };
  students: { id: string; firstName: string; lastName: string | null; rollNo: number | null; photoUrl: string | null; marks: string | null; absent: boolean }[];
}
type Row = { marks: string; absent: boolean };

export default function ClassTestMarks() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Data | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Data>('GET', `/class-tests/${id}`).then((r) => {
      setD(r); setRows(Object.fromEntries(r.students.map((x) => [x.id, { marks: x.marks != null ? String(Number(x.marks)) : '', absent: x.absent }])));
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
  }, [id]);
  const max = d ? Number(d.test.maxMarks) : 0;
  const counts = useMemo(() => {
    const v = Object.values(rows);
    return { filled: v.filter((r) => r.absent || r.marks !== '').length, high: v.some((r) => r.marks !== '' && Number(r.marks) > max) };
  }, [rows, max]);
  if (!d) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;

  const published = !!d.test.publishedAt;
  const send = async (publish: boolean) => {
    setBusy(true); setError(null);
    try {
      await call('PUT', `/class-tests/${id}/marks`, { publish,
        rows: d.students.map((x) => ({ studentId: x.id, absent: rows[x.id]!.absent, marks: rows[x.id]!.marks === '' ? null : Number(rows[x.id]!.marks) })) });
      router.back();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const remove = () => Alert.alert('Remove this test?', 'Its marks are removed too.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await call('DELETE', `/class-tests/${id}`); router.back(); } },
  ]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `${d.test.subjectName}, ${sectionLabel(d.section.className, d.section.sectionName)}` }} />
      <FlatList
        data={d.students}
        keyExtractor={(x) => x.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 150 + insets.bottom }}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 4 }}>
            <T soft size={14}>Class test · {shortDate(d.test.heldOn)}</T>
            <T display size={22}>{d.test.title}</T>
            <T soft size={14}>Out of {max}. {published ? 'Parents have these marks; a correction is sent to that family.' : 'Parents see the marks when you publish.'}</T>
            <Button kind="quiet" label="Remove this test" style={{ alignSelf: 'flex-start' }} onPress={remove} />
          </View>
        }
        renderItem={({ item }) => {
          const r = rows[item.id]!;
          const high = r.marks !== '' && Number(r.marks) > max;
          return (
            <View style={[st.row, r.absent && { backgroundColor: C.marigoldWash }]}>
              <Avatar name={`${item.firstName} ${item.lastName ?? ''}`} uri={item.photoUrl} size={40} />
              <View style={{ flex: 1 }}>
                <T bold size={15} numberOfLines={2}>{item.firstName} {item.lastName ?? ''}</T>
                <T size={12} style={{ color: high ? C.red : C.inkSoft }}>{high ? `More than ${max}` : `Roll ${item.rollNo ?? '-'}`}</T>
              </View>
              <TextInput value={r.absent ? '' : r.marks} editable={!r.absent} keyboardType="decimal-pad" maxLength={6}
                accessibilityLabel={`Marks for ${item.firstName}`} placeholder={r.absent ? 'AB' : '–'} placeholderTextColor={C.inkSoft}
                onChangeText={(v) => setRows({ ...rows, [item.id]: { ...r, marks: v.replace(/[^\d.]/g, '') } })}
                style={[st.box, high ? { borderColor: C.red, borderWidth: 1.5 } : null]} />
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: r.absent }} accessibilityLabel={`${item.firstName} was absent`}
                onPress={() => setRows({ ...rows, [item.id]: { ...r, absent: !r.absent } })}
                style={[st.ab, r.absent && { backgroundColor: C.gold, ...SH.glow(C.gold) }]}>
                <T bold size={13} style={{ color: r.absent ? C.goldInk : C.inkSoft }}>AB</T>
              </Pressable>
            </View>
          );
        }}
      />
      <View style={[st.bar, { paddingBottom: 12 + insets.bottom }]}>
        <ErrorText error={error} />
        <T size={15} style={{ textAlign: 'center' }}><T bold size={15}>{counts.filled}</T> of {d.students.length} filled</T>
        {published ? <Button label="Save corrections" busy={busy} disabled={counts.high} onPress={() => void send(false)} /> : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button kind="plain" label="Save draft" busy={busy} disabled={counts.high} onPress={() => void send(false)} /></View>
            <View style={{ flex: 1 }}><Button label="Publish" busy={busy} disabled={counts.high || counts.filled < d.students.length} onPress={() => void send(true)} /></View>
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.sheet, marginHorizontal: 16, marginBottom: 8, padding: 8, borderRadius: 18, ...SH.lift },
  box: { width: 70, height: 46, borderRadius: 12, textAlign: 'center', fontFamily: F.bold, fontSize: 18, color: C.ink,
    backgroundColor: C.paper, ...SH.inset, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) },
  ab: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper, ...SH.inset },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 8, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: 'rgba(238,244,247,0.94)', borderTopWidth: 1, borderTopColor: C.glassEdge },
});
