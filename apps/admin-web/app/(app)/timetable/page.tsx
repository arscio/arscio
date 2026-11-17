'use client';
// Timetable: how it repeats (same every week, or Day 1..N), bell times, one-off days,
// and each class's grid of subject + teacher per period.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel, type Structure } from '@/lib/types';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

interface Settings {
  mode: 'weekly' | 'cycle'; cycleDays: number; cycleStart: string | null; workingDays: number[]; periodsPerDay: number;
  periodTimes: { periodNo: number; startsAt: string; endsAt: string }[];
  days: { dayNo: number; label: string }[];
  changes: { date: string; noClasses: boolean; followsDay: number | null; note: string | null }[];
  today: { label: string };
}
interface Grid {
  section: { id: string; label: string };
  days: { dayNo: number; label: string }[];
  periodsPerDay: number;
  periodTimes: { periodNo: number; startsAt: string; endsAt: string }[];
  slots: { dayNo: number; periodNo: number; subjectId: string | null; subject: string | null; membershipId: string | null; teacher: string | null }[];
  subjects: { id: string; name: string }[];
  teachers: { membershipId: string; name: string; teachesHere: boolean }[];
  busy: { membershipId: string; dayNo: number; periodNo: number; label: string }[];
}
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function TimetablePage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [structure, setStructure] = useState<Structure | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [cell, setCell] = useState<{ dayNo: number; periodNo: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);

  const loadSettings = useCallback(async () => setS(await api.get<Settings>('/timetable/settings')), []);
  useEffect(() => {
    void loadSettings();
    api.get<Structure>('/setup/structure').then((x) => { setStructure(x); const f = x.classes.flatMap((c) => c.sections)[0]; if (f) setSectionId(f.id); });
  }, [loadSettings]);
  const loadGrid = useCallback(async () => { if (sectionId) setGrid(await api.get<Grid>(`/timetable/sections/${sectionId}`)); }, [sectionId]);
  useEffect(() => { setGrid(null); void loadGrid(); }, [loadGrid]);
  if (!s || !structure) return <Loading />;

  const slotAt = (d: number, p: number) => grid?.slots.find((x) => x.dayNo === d && x.periodNo === p);
  const time = (p: number) => grid?.periodTimes.find((t) => t.periodNo === p);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Timetable</h1>
          <p>{s.mode === 'weekly' ? 'The same timetable every week' : `A ${s.cycleDays}-day cycle (Day 1 to Day ${s.cycleDays})`}, {s.periodsPerDay} periods a day. Today follows: <strong>{s.today.label}</strong>.</p>
        </div>
        <div className="row">
          <button className="btn btn-plain" onClick={() => setDayOpen(true)}>Change a single day</button>
          <button className="btn btn-plain" onClick={() => setSettingsOpen(true)}>Timetable settings</button>
        </div>
      </div>

      {s.changes.length ? (
        <div className="sheet sheet-pad" style={{ marginBottom: 18 }}>
          <h3 style={{ marginBottom: 8 }}>Coming one-off changes</h3>
          <div className="checks">{s.changes.map((c) => (
            <span key={c.date} className="chip-section">
              <b>{niceDate(c.date)}</b>
              <span className="small muted">{c.noClasses ? 'No classes' : `follows ${s.days.find((d) => d.dayNo === c.followsDay)?.label ?? `day ${c.followsDay}`}`}{c.note ? ` · ${c.note}` : ''}</span>
              <button className="x" aria-label={`Remove the change on ${niceDate(c.date)}`} onClick={async () => { await api.del(`/timetable/days/${c.date}`); await loadSettings(); toast.show('Change removed'); }}>×</button>
            </span>
          ))}</div>
        </div>
      ) : null}

      <div className="row" style={{ marginBottom: 14 }}>
        <label htmlFor="sec" className="small muted">Class</label>
        <select id="sec" className="input" style={{ width: 200 }} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          {structure.classes.flatMap((c) => c.sections.map((x) => <option key={x.id} value={x.id}>{sectionLabel(c.name, x.name)}</option>))}
        </select>
        <span className="small muted">Click a box to choose the subject and teacher.</span>
      </div>

      {!grid ? <Loading /> : (
        <div className="sheet table-wrap">
          <table className="tt-grid">
            <thead><tr><th>Period</th>{grid.days.map((d) => <th key={d.dayNo}>{d.label}</th>)}</tr></thead>
            <tbody>{Array.from({ length: grid.periodsPerDay }, (_, i) => i + 1).map((p) => (
              <tr key={p}>
                <th scope="row"><strong>{p}</strong>{time(p) ? <div className="small muted">{time(p)!.startsAt}–{time(p)!.endsAt}</div> : null}</th>
                {grid.days.map((d) => {
                  const x = slotAt(d.dayNo, p);
                  return (
                    <td key={d.dayNo}>
                      <button className={`tt-cell${x ? ' filled' : ''}`} onClick={() => setCell({ dayNo: d.dayNo, periodNo: p })}
                        aria-label={`${d.label}, period ${p}: ${x ? `${x.subject ?? 'no subject'}, ${x.teacher ?? 'no teacher'}` : 'empty'}`}>
                        {x ? <><strong>{x.subject ?? 'Activity'}</strong><span className="small muted">{x.teacher ?? 'No teacher'}</span></> : <span className="small muted">+</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <Panel open={!!cell && !!grid} title={cell && grid ? `${grid.section.label}: ${grid.days.find((d) => d.dayNo === cell.dayNo)?.label}, period ${cell.periodNo}` : ''} onClose={() => setCell(null)}>
        {cell && grid ? <CellForm grid={grid} cell={cell} onDone={async (m) => { setCell(null); await loadGrid(); toast.show(m); }} /> : null}
      </Panel>
      <Panel open={settingsOpen} title="Timetable settings" onClose={() => setSettingsOpen(false)}>
        {settingsOpen ? <SettingsForm s={s} onDone={async () => { setSettingsOpen(false); await loadSettings(); await loadGrid(); toast.show('Timetable settings saved'); }} /> : null}
      </Panel>
      <Panel open={dayOpen} title="Change a single day" onClose={() => setDayOpen(false)}>
        {dayOpen ? <DayForm s={s} onDone={async () => { setDayOpen(false); await loadSettings(); toast.show('Day change saved'); }} /> : null}
      </Panel>
      {toast.node}
    </>
  );
}

function CellForm({ grid, cell, onDone }: { grid: Grid; cell: { dayNo: number; periodNo: number }; onDone: (m: string) => Promise<void> }) {
  const cur = grid.slots.find((x) => x.dayNo === cell.dayNo && x.periodNo === cell.periodNo);
  const [subjectId, setSubjectId] = useState(cur?.subjectId ?? '');
  const [membershipId, setMembershipId] = useState(cur?.membershipId ?? '');
  const [error, setError] = useState<string | null>(null);
  const busyWith = (m: string) => grid.busy.find((b) => b.membershipId === m && b.dayNo === cell.dayNo && b.periodNo === cell.periodNo)?.label;
  const save = async (clear = false) => {
    setError(null);
    try {
      await api.put('/timetable/slot', { sectionId: grid.section.id, ...cell, subjectId: clear ? null : subjectId || null, membershipId: clear ? null : membershipId || null });
      await onDone(clear ? 'Period cleared' : 'Period saved');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
  };
  return (
    <div className="stack">
      <Field label="Subject" htmlFor="sub">
        <select id="sub" className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Activity (games, library, assembly)</option>
          {grid.subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <div className="field">
        <span className="label">Teacher</span>
        <span className="hint">Teachers already in another class at this time can&apos;t be chosen.</span>
        <div className="stack" style={{ gap: 6 }}>
          {grid.teachers.map((t) => {
            const b = busyWith(t.membershipId);
            return (
              <label key={t.membershipId} className="check" style={{ justifyContent: 'space-between', opacity: b ? 0.55 : 1 }}>
                <span className="row" style={{ gap: 8 }}><input type="radio" name="teacher" disabled={!!b} checked={membershipId === t.membershipId} onChange={() => setMembershipId(t.membershipId)} />{t.name}</span>
                <span className="small muted">{b ? `Busy: ${b}` : t.teachesHere ? 'Teaches this class' : ''}</span>
              </label>
            );
          })}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-primary" disabled={!subjectId && !membershipId} onClick={() => save()}>Save</button>
        {cur ? <button className="btn btn-danger" onClick={() => save(true)}>Clear this period</button> : null}
      </div>
    </div>
  );
}

function SettingsForm({ s, onDone }: { s: Settings; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState(s.mode);
  const [cycleDays, setCycleDays] = useState(s.cycleDays);
  const [cycleStart, setCycleStart] = useState(s.cycleStart ?? '');
  const [working, setWorking] = useState<number[]>(s.workingDays);
  const [periods, setPeriods] = useState(s.periodsPerDay);
  const [times, setTimes] = useState<Record<number, { startsAt: string; endsAt: string }>>(Object.fromEntries(s.periodTimes.map((t) => [t.periodNo, t])));
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      await api.put('/timetable/settings', {
        mode, cycleDays, cycleStart: cycleStart || null, workingDays: working, periodsPerDay: periods,
        periodTimes: Object.entries(times).filter(([, t]) => t.startsAt && t.endsAt).map(([p, t]) => ({ periodNo: Number(p), ...t })),
      });
      await onDone();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); }
  };
  return (
    <form className="stack" onSubmit={save}>
      <div className="field">
        <span className="label">How does the timetable repeat?</span>
        <label className="check"><input type="radio" checked={mode === 'weekly'} onChange={() => setMode('weekly')} />The same every week (Monday, Tuesday…)</label>
        <label className="check"><input type="radio" checked={mode === 'cycle'} onChange={() => setMode('cycle')} />A cycle of days (Day 1, Day 2…) that moves on each working day</label>
      </div>
      {mode === 'cycle' ? (
        <div className="grid-2">
          <Field label="Days in the cycle" htmlFor="cd"><input id="cd" className="input" type="number" min={2} max={10} value={cycleDays} onChange={(e) => setCycleDays(Number(e.target.value))} /></Field>
          <Field label="Which date was Day 1?" htmlFor="cs"><input id="cs" className="input" type="date" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} /></Field>
        </div>
      ) : null}
      <div className="field">
        <span className="label">Working days</span>
        <div className="checks">{WEEK.map((w, i) => (
          <label key={w} className="check"><input type="checkbox" checked={working.includes(i + 1)}
            onChange={(e) => setWorking(e.target.checked ? [...working, i + 1] : working.filter((x) => x !== i + 1))} />{w}</label>
        ))}</div>
      </div>
      <Field label="Periods in a day" htmlFor="ppd"><input id="ppd" className="input" type="number" min={1} max={15} style={{ width: 100 }} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} /></Field>
      <div className="field">
        <span className="label">Bell times (optional)</span>
        <div className="stack" style={{ gap: 6 }}>{Array.from({ length: periods }, (_, i) => i + 1).map((p) => (
          <div key={p} className="row">
            <span className="small" style={{ width: 70 }}>Period {p}</span>
            <input className="input" type="time" style={{ width: 130 }} aria-label={`Period ${p} starts`} value={times[p]?.startsAt ?? ''} onChange={(e) => setTimes({ ...times, [p]: { startsAt: e.target.value, endsAt: times[p]?.endsAt ?? '' } })} />
            <span className="small muted">to</span>
            <input className="input" type="time" style={{ width: 130 }} aria-label={`Period ${p} ends`} value={times[p]?.endsAt ?? ''} onChange={(e) => setTimes({ ...times, [p]: { startsAt: times[p]?.startsAt ?? '', endsAt: e.target.value } })} />
          </div>
        ))}</div>
      </div>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary">Save settings</button></div>
    </form>
  );
}

function DayForm({ s, onDone }: { s: Settings; onDone: () => Promise<void> }) {
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<'none' | 'follow'>('none');
  const [follows, setFollows] = useState(s.days[0]?.dayNo ?? 1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api.put(`/timetable/days/${date}`, { noClasses: kind === 'none', followsDay: kind === 'follow' ? follows : null, note: note || null }); await onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); }
  };
  return (
    <form className="stack" onSubmit={save}>
      <Field label="Date" htmlFor="dd"><input id="dd" className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="field">
        <span className="label">On this day</span>
        <label className="check"><input type="radio" checked={kind === 'none'} onChange={() => setKind('none')} />No classes (holiday, exam or event day)</label>
        <label className="check"><input type="radio" checked={kind === 'follow'} onChange={() => setKind('follow')} />Follow another day&apos;s timetable</label>
      </div>
      {kind === 'follow' ? (
        <Field label="Follow" htmlFor="fd">
          <select id="fd" className="input" value={follows} onChange={(e) => setFollows(Number(e.target.value))}>{s.days.map((d) => <option key={d.dayNo} value={d.dayNo}>{d.label}</option>)}</select>
        </Field>
      ) : null}
      <Field label="Note (optional)" htmlFor="dn"><input id="dn" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Annual sports day" /></Field>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={!date}>Save</button></div>
    </form>
  );
}
