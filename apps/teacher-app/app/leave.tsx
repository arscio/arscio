// Apply for leave, and see what happened to earlier requests.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, Platform } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { C, F, SH } from '@/lib/theme';
import { Button, ErrorText, Loading, Pill, T } from '@/components/ui';

interface Leave { id: string; fromDate: string; toDate: string; part: string; periods: number[]; reason: string; status: string; decisionNote: string | null; decidedBy: string | null }
type Part = 'full' | 'first_half' | 'second_half' | 'periods';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const PART: Record<Part, string> = { full: 'Full day', first_half: 'First half', second_half: 'Second half', periods: 'Some periods' };
const STATUS: Record<string, ['done' | 'todo' | 'plain', string]> = {
  pending: ['todo', 'Waiting for the principal'], approved: ['done', 'Approved'], rejected: ['plain', 'Not approved'], cancelled: ['plain', 'Cancelled'],
};

function Chip({ text, on, onPress, small }: { text: string; on: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress}
      style={[st.chip, small && { minWidth: 44, paddingHorizontal: 10 }, on && { backgroundColor: C.board, ...SH.glow(C.board) }]}>
      <T bold size={14} style={{ color: on ? '#fff' : C.ink }}>{text}</T>
    </Pressable>
  );
}

export default function LeaveScreen() {
  const today = todayIST();
  const [mine, setMine] = useState<Leave[] | null>(null);
  const [from, setFrom] = useState(addDays(today, 1));
  const [days, setDays] = useState(1);
  const [part, setPart] = useState<Part>('full');
  const [periods, setPeriods] = useState<number[]>([]);
  const [periodsPerDay, setPeriodsPerDay] = useState(8);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    const [m, t] = await Promise.all([call<{ leaves: Leave[] }>('GET', '/leaves/mine'), call<{ periodsPerDay: number }>('GET', '/teacher/today')]);
    setMine(m.leaves); setPeriodsPerDay(t.periodsPerDay);
  }, []);
  useEffect(() => { void load().catch(() => setMine([])); }, [load]);
  if (!mine) return <Loading />;

  const choices = Array.from({ length: 21 }, (_, i) => addDays(today, i - 1));
  const to = part === 'full' ? addDays(from, days - 1) : from;
  const apply = async () => {
    setBusy(true); setError(null);
    try {
      await call('POST', '/leaves', { fromDate: from, toDate: to, part, periods: part === 'periods' ? periods : [], reason });
      setSent(true); setReason(''); setPeriods([]); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send'); }
    finally { setBusy(false); }
  };
  const cancel = async (l: Leave) => {
    try { await call('POST', `/leaves/${l.id}/cancel`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not cancel'); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={st.card}>
        <T display size={20}>Apply for leave</T>
        {sent ? <View style={st.ok}><T bold size={14} style={{ color: C.lagoonDeep }}>Sent. You&apos;ll get a message when the principal decides.</T></View> : null}

        <T bold size={15}>Starting</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6, paddingHorizontal: 2 }}>
          {choices.map((d) => <Chip key={d} text={d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : label(d)} on={from === d} onPress={() => { setFrom(d); setSent(false); }} />)}
        </ScrollView>

        <T bold size={15}>How much</T>
        <View style={st.wrap}>{(Object.keys(PART) as Part[]).map((p) => <Chip key={p} text={PART[p]} on={part === p} onPress={() => { setPart(p); if (p !== 'full') setDays(1); }} />)}</View>

        {part === 'full' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <T size={15}>For</T>
            <Pressable accessibilityRole="button" accessibilityLabel="One day fewer" onPress={() => setDays(Math.max(1, days - 1))} style={st.step}><T bold size={18}>−</T></Pressable>
            <T display size={20}>{days}</T>
            <Pressable accessibilityRole="button" accessibilityLabel="One day more" onPress={() => setDays(Math.min(30, days + 1))} style={st.step}><T bold size={18}>+</T></Pressable>
            <T size={15}>{days === 1 ? 'day' : 'days'}</T>
          </View>
        ) : null}
        {part === 'periods' ? (
          <View style={st.wrap}>{Array.from({ length: periodsPerDay }, (_, i) => i + 1).map((p) => (
            <Chip key={p} small text={String(p)} on={periods.includes(p)} onPress={() => setPeriods(periods.includes(p) ? periods.filter((x) => x !== p) : [...periods, p].sort((a, b) => a - b))} />
          ))}</View>
        ) : null}
        <T soft size={14}>{from === to ? label(from) : `${label(from)} to ${label(to)}`}{part !== 'full' ? `, ${PART[part].toLowerCase()}` : ''}</T>

        <T bold size={15}>Reason</T>
        <TextInput value={reason} onChangeText={setReason} placeholder="For example: fever, family function" placeholderTextColor={C.inkSoft}
          multiline maxLength={300} style={st.input} accessibilityLabel="Reason" />
        <ErrorText error={error} />
        <Button label="Send to the principal" busy={busy} disabled={reason.trim().length < 3 || (part === 'periods' && !periods.length)} onPress={apply} />
      </View>

      <T bold size={17}>Your leave</T>
      {mine.length === 0 ? <T soft>No leave yet.</T> : mine.map((l) => {
        const [tone, text] = STATUS[l.status] ?? ['plain', l.status];
        const canCancel = l.status === 'pending' || (l.status === 'approved' && l.fromDate > today);
        return (
          <View key={l.id} style={st.item}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <T bold size={15}>{l.fromDate === l.toDate ? label(l.fromDate) : `${label(l.fromDate)} – ${label(l.toDate)}`}</T>
              <Pill tone={tone} text={text} />
            </View>
            <T soft size={13}>{PART[l.part as Part]}{l.part === 'periods' ? `: ${l.periods.join(', ')}` : ''} · {l.reason}</T>
            {l.decisionNote ? <T size={13}>{l.decidedBy}: {l.decisionNote}</T> : null}
            {canCancel ? <Pressable accessibilityRole="button" onPress={() => cancel(l)}><T bold size={14} style={{ color: C.board }}>Cancel this leave</T></Pressable> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 24, padding: 18, gap: 10, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassEdge, ...SH.lift },
  ok: { borderRadius: 12, padding: 12, backgroundColor: C.lagoonWash },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6FAFC', ...SH.raised },
  step: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6FAFC', ...SH.raised },
  input: {
    minHeight: 80, borderRadius: 14, padding: 12, fontFamily: F.regular, fontSize: 16, color: C.ink, backgroundColor: C.paper, textAlignVertical: 'top', ...SH.inset,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  item: { borderRadius: 18, padding: 14, gap: 6, backgroundColor: '#fff', ...SH.lift },
});
