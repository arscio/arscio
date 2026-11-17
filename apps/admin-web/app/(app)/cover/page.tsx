'use client';
// Leave and cover: approve teachers' leave, then fill each empty period with a free teacher.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useToast } from '@/components/ui';

interface Leave {
  id: string; teacher: string; fromDate: string; toDate: string; part: string; periods: number[]; reason: string;
  status: string; decisionNote: string | null; decidedBy: string | null; createdAt: string;
}
interface Gap {
  sectionId: string; classLabel: string; periodNo: number; subject: string | null;
  teacher: { membershipId: string; name: string } | null;
  substitute: { id: string; membershipId: string; name: string } | null;
  time: { startsAt: string; endsAt: string } | null;
  free: { membershipId: string; name: string; periodsToday: number }[];
}
interface Cover {
  date: string; today: string; day: { label: string; noClasses: boolean; note: string | null };
  away: { name: string; part: string; periods: number[]; reason: string }[];
  pendingLeaves: number; gaps: Gap[]; needCover: number;
}
const PART: Record<string, string> = { full: 'Full day', first_half: 'First half', second_half: 'Second half', periods: 'Some periods' };
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function CoverPage() {
  const toast = useToast();
  const [leaves, setLeaves] = useState<Leave[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [c, setC] = useState<Cover | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLeaves = useCallback(async () => setLeaves((await api.get<{ leaves: Leave[] }>('/leaves')).leaves), []);
  const loadCover = useCallback(async (d: string | null) => { const r = await api.get<Cover>(`/cover${d ? `?date=${d}` : ''}`); setC(r); setDate(r.date); }, []);
  useEffect(() => { void loadLeaves(); void loadCover(null); }, [loadLeaves, loadCover]);
  if (!leaves || !c || !date) return <Loading />;

  const decide = async (l: Leave, approve: boolean) => {
    const note = approve ? null : prompt('Reason for not approving (the teacher will see it):');
    if (!approve && note === null) return;
    await api.post(`/leaves/${l.id}/decide`, { approve, note });
    await Promise.all([loadLeaves(), loadCover(date)]);
    toast.show(approve ? `Leave approved. ${l.teacher} has been told.` : 'Leave not approved. The teacher has been told.');
  };
  const assign = async (g: Gap, membershipId: string, name: string) => {
    setError(null);
    try { await api.post('/cover', { date, sectionId: g.sectionId, periodNo: g.periodNo, membershipId }); await loadCover(date); toast.show(`${name} is covering. They have been told.`); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not assign'); }
  };
  const unassign = async (g: Gap) => { await api.del(`/cover/${g.substitute!.id}`); await loadCover(date); toast.show('Substitute removed'); };

  return (
    <>
      <div className="page-head"><div><h1>Leave and cover</h1><p>Approve teachers&apos; leave, then choose who covers each of their periods.</p></div></div>

      {leaves.length ? (
        <section className="sheet" style={{ marginBottom: 22 }} aria-labelledby="req-h">
          <div className="sheet-pad"><h2 id="req-h">Leave requests waiting</h2></div>
          <table className="register"><tbody>{leaves.map((l) => (
            <tr key={l.id}>
              <td><strong>{l.teacher}</strong><div className="small muted">Asked {new Date(l.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div></td>
              <td>{l.fromDate === l.toDate ? nice(l.fromDate) : `${nice(l.fromDate)} to ${nice(l.toDate)}`}<div className="small muted">{PART[l.part]}{l.part === 'periods' ? `: ${l.periods.join(', ')}` : ''}</div></td>
              <td style={{ maxWidth: 320 }}>{l.reason}</td>
              <td className="actions">
                <button className="btn btn-plain" onClick={() => decide(l, false)}>Don&apos;t approve</button>{' '}
                <button className="btn btn-primary" onClick={() => decide(l, true)}>Approve</button>
              </td>
            </tr>
          ))}</tbody></table>
        </section>
      ) : null}

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn-plain" disabled={date <= c.today} onClick={() => loadCover(shift(date, -1))}>Previous day</button>
        <h2 style={{ margin: '0 8px' }}>{date === c.today ? 'Today' : nice(date)}</h2>
        <span className="tag">{c.day.label}{c.day.note ? `: ${c.day.note}` : ''}</span>
        <button className="btn btn-plain" onClick={() => loadCover(shift(date, 1))}>Next day</button>
        {c.away.length ? <span className="small muted" style={{ marginLeft: 'auto' }}>On leave: {c.away.map((a) => `${a.name} (${PART[a.part]?.toLowerCase()})`).join(', ')}</span> : null}
      </div>
      <ErrorBox error={error} />

      {c.day.noClasses ? (
        <div className="sheet empty"><h3>No classes this day</h3></div>
      ) : c.gaps.length === 0 ? (
        <div className="sheet empty"><h3>No periods need cover</h3><p>When you approve a teacher&apos;s leave, their periods for those days show up here.</p></div>
      ) : (
        <div className="stack">
          {c.gaps.map((g) => (
            <section key={`${g.sectionId}-${g.periodNo}`} className={`cover-card${g.substitute ? ' done' : ''}`}>
              <div className="cover-when">
                <span className="cover-p">P{g.periodNo}</span>
                {g.time ? <span className="small muted">{g.time.startsAt}</span> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{g.classLabel}</strong>{g.subject ? <span className="muted"> · {g.subject}</span> : null}
                <div className="small muted">{g.teacher?.name} is on leave</div>
              </div>
              {g.substitute ? (
                <div className="row">
                  <span className="tag tag-board">Covered by {g.substitute.name}</span>
                  <button className="btn btn-quiet" onClick={() => unassign(g)}>Change</button>
                </div>
              ) : g.free.length ? (
                <div className="cover-free">
                  <span className="small muted">Free now:</span>
                  {g.free.map((f) => (
                    <button key={f.membershipId} className="btn btn-plain" onClick={() => assign(g, f.membershipId, f.name)}>
                      {f.name} <span className="small muted">{f.periodsToday} {f.periodsToday === 1 ? 'period' : 'periods'} today</span>
                    </button>
                  ))}
                </div>
              ) : <span className="tag tag-warn">No teacher is free in this period</span>}
            </section>
          ))}
        </div>
      )}
      {toast.node}
    </>
  );
}
