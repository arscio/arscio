// A month of attendance as a calendar.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C } from '@/lib/theme';
import { Button, Card, Loading, T } from '@/components/ui';
import { SchoolBand } from '@/components/School';

const COLOURS: Record<string, [string, string, string]> = {
  present: [C.boardWash, C.boardDeep, 'Present'],
  late: [C.boardWash, C.boardDeep, 'Late'],
  half_day: [C.marigoldWash, '#7a520a', 'Half day'],
  absent: [C.redWash, C.red, 'Absent'],
  leave: [C.marigoldWash, '#7a520a', 'Leave'],
};
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
const shift = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };

export default function Attendance() {
  const { child } = useParent();
  const [month, setMonth] = useState(thisMonth());
  const [days, setDays] = useState<{ date: string; status: string }[] | null>(null);
  useEffect(() => {
    if (!child) return;
    setDays(null);
    call<{ days: { date: string; status: string }[] }>('GET', `/parent/children/${child.id}/attendance?month=${month}`, undefined, { schoolId: child.schoolId })
      .then((r) => setDays(r.days));
  }, [child, month]);
  if (!child) return <Loading />;

  const first = new Date(`${month}-01T00:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const byDate = new Map(days?.map((d) => [d.date, d.status]));
  const n = (st: string[]) => days?.filter((d) => st.includes(d.status)).length ?? 0;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <SchoolBand />
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Button kind="plain" label="Previous" onPress={() => setMonth(shift(month, -1))} style={{ minHeight: 40 }} />
          <T display size={18}>{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</T>
          <Button kind="plain" label="Next" disabled={month >= thisMonth()} onPress={() => setMonth(shift(month, 1))} style={{ minHeight: 40 }} />
        </View>
        {!days ? <View style={{ height: 300 }}><Loading /></View> : (
          <Card style={{ padding: 10 }}>
            <View style={s.grid}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <View key={i} style={s.cell}><T soft size={12}>{d}</T></View>)}
              {Array.from({ length: lead }, (_, i) => <View key={`b${i}`} style={s.cell} />)}
              {Array.from({ length: count }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                const st = byDate.get(date);
                const col = st ? COLOURS[st] : null;
                return (
                  <View key={date} style={s.cell} accessibilityLabel={`${i + 1}: ${col ? col[2] : 'no attendance'}`}>
                    <View style={[s.day, col ? { backgroundColor: col[0] } : null]}>
                      <T bold={!!col} size={14} style={{ color: col ? col[1] : C.inkSoft }}>{i + 1}</T>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        )}
        {days ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            <T><T bold>{n(['present', 'late'])}</T> present</T>
            <T><T bold style={{ color: C.red }}>{n(['absent'])}</T> absent</T>
            <T><T bold>{n(['leave'])}</T> on leave</T>
            <T soft>{days.length} school days marked</T>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  day: { width: '84%', height: '84%', borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
