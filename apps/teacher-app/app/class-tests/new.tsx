// New class test: class, subject, name, the day it was held, and out of how many marks.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { C, SH, classLabel } from '@/lib/theme';
import { Button, ErrorText, Input, Loading, T } from '@/components/ui';
import { shortDate } from '../homework/index';

interface ClassOption {
  sectionId: string; className: string; sectionName: string; mine: boolean;
  subjects: { id: string; name: string; mine: boolean }[];
}
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysAgo = (n: number) => { const d = new Date(`${todayIST()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress}
      style={[s.chip, on && { backgroundColor: C.board, ...SH.glow(C.board) }]}>
      <T bold size={15} style={{ color: on ? '#fff' : C.ink }}>{label}</T>
    </Pressable>
  );
}

export default function NewClassTest() {
  const [classes, setClasses] = useState<ClassOption[] | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [max, setMax] = useState('20');
  const [heldOn, setHeldOn] = useState(todayIST());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<{ sections: ClassOption[] }>('GET', '/teacher/classes').then((r) => {
      const mine = r.sections.filter((x) => x.mine);
      setClasses(mine);
      if (mine.length === 1) pick(mine[0]!);
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
  }, []);
  const pick = (c: ClassOption) => {
    setSectionId(c.sectionId);
    const my = c.subjects.filter((x) => x.mine);
    setSubjectId(my.length === 1 ? my[0]!.id : null);
  };
  if (!classes) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;
  const chosen = classes.find((c) => c.sectionId === sectionId);
  // Subject teachers pick their own subjects; a class teacher can pick any subject of the class.
  const subjects = chosen ? (chosen.subjects.some((x) => x.mine) ? chosen.subjects.filter((x) => x.mine) : chosen.subjects) : [];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {classes.length === 0 ? <T soft>You don&apos;t teach a class yet. The principal sets this up on the school website.</T> : null}
        <View style={{ gap: 8 }}>
          <T bold size={15}>Class</T>
          <View style={s.wrap} accessibilityRole="radiogroup">
            {classes.map((c) => <Chip key={c.sectionId} label={`${classLabel(c.className)} ${c.sectionName}`} on={c.sectionId === sectionId} onPress={() => pick(c)} />)}
          </View>
        </View>
        {chosen ? (
          <View style={{ gap: 8 }}>
            <T bold size={15}>Subject</T>
            <View style={s.wrap} accessibilityRole="radiogroup">
              {subjects.map((x) => <Chip key={x.id} label={x.name} on={x.id === subjectId} onPress={() => setSubjectId(x.id)} />)}
            </View>
          </View>
        ) : null}
        <Input label="Test name" placeholder="For example: Fractions quiz" value={title} onChangeText={setTitle} maxLength={80} />
        <Input label="Out of" keyboardType="number-pad" value={max} onChangeText={(v) => setMax(v.replace(/[^\d.]/g, ''))} maxLength={5} />
        <View style={{ gap: 8 }}>
          <T bold size={15}>Held on</T>
          <View style={s.wrap} accessibilityRole="radiogroup">
            {[0, 1, 2, 3, 4, 5, 6].map((n) => {
              const d = daysAgo(n);
              return <Chip key={d} label={n === 0 ? 'Today' : n === 1 ? 'Yesterday' : shortDate(d).split(',')[0]!} on={heldOn === d} onPress={() => setHeldOn(d)} />;
            })}
          </View>
          <T soft size={14}>{shortDate(heldOn)}</T>
        </View>
        <ErrorText error={error} />
        <Button label="Next: enter marks" busy={busy} disabled={!chosen || !subjectId || title.trim().length < 2 || !Number(max)}
          onPress={async () => {
            setBusy(true); setError(null);
            try {
              const r = await call<{ id: string }>('POST', '/class-tests', { sectionId, subjectId, title: title.trim(), heldOn, maxMarks: Number(max) });
              router.replace({ pathname: '/class-tests/[id]', params: { id: r.id } });
            } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
            finally { setBusy(false); }
          }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 46, paddingHorizontal: 16, borderRadius: 14, backgroundColor: '#F6FAFC', alignItems: 'center', justifyContent: 'center', ...SH.raised },
});
