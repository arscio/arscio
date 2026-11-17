// Give homework: choose the class and subject, write it, pick when it's due.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { C, SH, classLabel, sectionLabel } from '@/lib/theme';
import { Button, Card, ErrorText, Input, Loading, T } from '@/components/ui';
import { shortDate } from './index';

interface ClassOption {
  sectionId: string; className: string; sectionName: string; mine: boolean;
  subjects: { id: string; name: string; mine: boolean }[];
}

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (n: number) => { const d = new Date(`${todayIST()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress}
      style={[s.chip, on && { backgroundColor: C.board, ...SH.glow(C.board) }]}>
      <T bold size={15} style={{ color: on ? '#fff' : C.ink }}>{label}</T>
    </Pressable>
  );
}

export default function NewHomework() {
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const [classes, setClasses] = useState<ClassOption[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [due, setDue] = useState<string | null>(addDays(1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  useEffect(() => {
    call<{ sections: ClassOption[] }>('GET', '/teacher/classes').then((r) => {
      setClasses(r.sections);
      const mine = r.sections.filter((x) => x.mine);
      const asked = params.sectionId ? r.sections.find((x) => x.sectionId === params.sectionId) : undefined;
      if (asked) pickClass(asked);
      else if (mine.length === 1) pickClass(mine[0]!);
      if (mine.length === 0) setShowAll(true);
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickClass = (c: ClassOption) => {
    setSectionId(c.sectionId);
    const mySubjects = c.subjects.filter((x) => x.mine);
    setSubjectId(mySubjects.length === 1 ? mySubjects[0]!.id : null);
  };

  if (!classes) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;

  const chosen = classes.find((c) => c.sectionId === sectionId);
  const label = chosen ? `${sectionLabel(chosen.className, chosen.sectionName)}` : '';

  if (sent !== null) {
    return (
      <View style={{ padding: 16, gap: 14 }}>
        <Card style={{ gap: 8 }}>
          <T display size={22}>Homework sent</T>
          <T size={17}>{label}: {title}</T>
          <T soft>{sent > 0 ? `${sent} ${sent === 1 ? 'family' : 'families'} will see it in the parent app.` : 'No parents in this class use the app yet.'}</T>
        </Card>
        <Button label="Done" onPress={() => router.back()} />
        <Button kind="plain" label="Give more homework" onPress={() => { setSent(null); setTitle(''); setDetails(''); }} />
      </View>
    );
  }

  const shown = showAll ? classes : classes.filter((c) => c.mine);
  const DUE: [string, string | null][] = [
    ['Tomorrow', addDays(1)], ['Day after', addDays(2)], ['In a week', addDays(7)], ['No date', null],
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <T bold size={15}>Class</T>
          <View style={s.wrap} accessibilityRole="radiogroup">
            {shown.map((c) => (
              <Chip key={c.sectionId} label={`${sectionLabel(c.className, c.sectionName)}`} on={c.sectionId === sectionId} onPress={() => pickClass(c)} />
            ))}
          </View>
          {!showAll ? <Button kind="quiet" label="Show all classes" onPress={() => setShowAll(true)} style={{ alignSelf: 'flex-start' }} /> : null}
        </View>

        {chosen ? (
          <View style={{ gap: 8 }}>
            <T bold size={15}>Subject</T>
            {chosen.subjects.length === 0 ? <T soft size={14}>No subjects are set for this class yet. You can still send it without one.</T> : (
              <View style={s.wrap} accessibilityRole="radiogroup">
                {chosen.subjects.map((x) => <Chip key={x.id} label={x.name} on={x.id === subjectId} onPress={() => setSubjectId(x.id === subjectId ? null : x.id)} />)}
              </View>
            )}
          </View>
        ) : null}

        <Input label="Homework" placeholder="For example: Exercise 4.2, questions 1 to 5" value={title} onChangeText={setTitle} maxLength={120} />
        <Input label="More details (optional)" placeholder="Anything parents should know" value={details} onChangeText={setDetails}
          multiline maxLength={2000} style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }} />

        <View style={{ gap: 8 }}>
          <T bold size={15}>Due</T>
          <View style={s.wrap} accessibilityRole="radiogroup">
            {DUE.map(([l, d]) => <Chip key={l} label={l} on={due === d} onPress={() => setDue(d)} />)}
          </View>
          {due ? <T soft size={14}>{shortDate(due)}</T> : null}
        </View>

        <ErrorText error={error} />
        <Button label={chosen ? `Send to ${label}` : 'Choose a class first'} busy={busy} disabled={!chosen || title.trim().length < 2}
          onPress={async () => {
            setBusy(true); setError(null);
            try {
              const r = await call<{ parentsTold: number }>('POST', '/homework', {
                sectionId, subjectId, title: title.trim(), details: details.trim() || null, dueOn: due,
              });
              setSent(r.parentsTold);
            } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send'); }
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
