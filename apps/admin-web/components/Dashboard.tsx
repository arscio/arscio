'use client';
// The principal's dashboard: today at a glance, what needs attention, and fees.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSchool } from './AppShell';
import { inr } from './FeesTabs';
import { SetupChecklist } from './SetupChecklist';
import { Loading } from './ui';

interface Dash {
  holiday: string | null;
  date: string;
  year: { id: string; name: string };
  attendance: { totalStudents: number; marked: number; present: number; absent: number; leave: number; pct: number | null; sectionsTaken: number; sectionsTotal: number };
  staff: { total: number; marked: number; in: number; teachers: number; teachersIn: number; away: { name: string; status: string }[] };
  fees: {
    today: string; thisMonth: string; receiptsThisMonth: number; yearBilled: string; yearCollected: string;
    overdueTotal: string; defaulterCount: number;
    topDefaulters: { studentId: string; name: string; class: string; overdue: string; since: string }[];
    months: { month: string; total: string }[];
  };
  attention: { kind: string; tone: 'warn' | 'info'; text: string; href: string }[];
}

const AWAY: Record<string, string> = { absent: 'absent', leave: 'on leave', late: 'late', half_day: 'half day' };
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const short = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${Math.round(v)}`);

export function Dashboard() {
  const { me, info } = useSchool();
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { api.get<Dash>('/dashboard').then(setD); }, []);
  if (!d) return <Loading />;

  const hour = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', timeZone: 'Asia/Kolkata' }));
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const a = d.attendance;
  const maxMonth = Math.max(1, ...d.fees.months.map((m) => Number(m.total)));
  const billed = Number(d.fees.yearBilled);
  const collectedPct = billed ? Math.round((Number(d.fees.yearCollected) / billed) * 100) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{hello}, {me.account.name.replace(/^(dr|mr|mrs|ms|miss|prof)\.?\s+/i, '').split(' ')[0]}</h1>
          <p>{new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} · {info.school.name}</p>
        </div>
        <div className="row">
          <Link className="btn btn-plain" href="/notices">Send a notice</Link>
          <Link className="btn btn-plain" href="/staff/attendance">Staff attendance</Link>
          <Link className="btn btn-primary" href="/fees">Collect fee</Link>
        </div>
      </div>

      <SetupChecklist compact />

      <div className="dash-tiles">
        <Link href="/attendance" className="dash-tile">
          <span className="small muted">Students present today</span>
          <span className="stat-num">{a.pct === null ? '—' : `${a.pct}%`}</span>
          <span className="small">{a.marked ? `${a.present} of ${a.marked} marked` : d.holiday ? `${d.holiday}` : 'No attendance yet today'}</span>
          <div className="meter" aria-hidden><span style={{ width: `${a.sectionsTotal ? Math.round((a.sectionsTaken / a.sectionsTotal) * 100) : 0}%` }} /></div>
          <span className="small muted">{a.sectionsTaken} of {a.sectionsTotal} classes done</span>
        </Link>
        <Link href="/staff/attendance" className="dash-tile">
          <span className="small muted">Teachers present</span>
          <span className="stat-num">{d.staff.marked ? `${d.staff.teachersIn} of ${d.staff.teachers}` : '—'}</span>
          <span className="small">{d.staff.marked ? (d.staff.away.length ? d.staff.away.slice(0, 2).map((x) => `${x.name} ${AWAY[x.status] ?? x.status}`).join(', ') : 'Everyone is in') : d.holiday ? d.holiday : 'Not marked yet today'}</span>
        </Link>
        <Link href="/fees/daybook" className="dash-tile">
          <span className="small muted">Fees collected this month</span>
          <span className="stat-num">{inr(d.fees.thisMonth)}</span>
          <span className="small">{d.fees.receiptsThisMonth} receipts · today {inr(d.fees.today)}</span>
          {collectedPct !== null ? <span className="small muted">{collectedPct}% of this year&apos;s fees collected</span> : null}
        </Link>
        <Link href="/fees/defaulters" className="dash-tile">
          <span className="small muted">Overdue fees</span>
          <span className="stat-num" style={{ color: Number(d.fees.overdueTotal) ? 'var(--marigold)' : undefined }}>{inr(d.fees.overdueTotal)}</span>
          <span className="small">{d.fees.defaulterCount ? `${d.fees.defaulterCount} ${d.fees.defaulterCount === 1 ? 'student' : 'students'}` : 'Nobody is overdue'}</span>
        </Link>
      </div>

      <div className="dash-cols">
        <section className="sheet sheet-pad" aria-labelledby="att-h">
          <h2 id="att-h">Needs attention</h2>
          {d.attention.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>Nothing needs your attention right now.</p>
          ) : (
            <ul className="attention">
              {d.attention.map((x, i) => (
                <li key={i}><Link href={x.href}><span className={`dot ${x.tone}`} aria-hidden />{x.text}</Link></li>
              ))}
            </ul>
          )}
        </section>

        <section className="sheet sheet-pad" aria-labelledby="fee-h">
          <h2 id="fee-h">Fee collection, last 6 months</h2>
          <div className="bars" role="img" aria-label={d.fees.months.map((m) => `${monthName(m.month)} ${inr(m.total)}`).join(', ')}>
            {d.fees.months.map((m, i) => {
              const v = Number(m.total);
              const last = i === d.fees.months.length - 1;
              return (
                <div key={m.month} className="bar-col">
                  <span className="bar-val">{v ? short(v) : ''}</span>
                  <div className={`bar${last ? ' now' : ''}`} style={{ height: `${Math.max(v ? 4 : 0, Math.round((v / maxMonth) * 100))}%` }} />
                  <span className="bar-lab">{monthName(m.month)}</span>
                </div>
              );
            })}
          </div>
          {d.fees.topDefaulters.length ? (
            <>
              <h3 style={{ marginTop: 18, marginBottom: 6 }}>Largest overdue</h3>
              <table className="register"><tbody>
                {d.fees.topDefaulters.map((x) => (
                  <tr key={x.studentId}>
                    <td style={{ width: 'auto', borderRight: 0 }}><Link href={`/fees?student=${x.studentId}`}><strong>{x.name}</strong></Link><div className="small muted">{x.class}</div></td>
                    <td className="money"><strong>{inr(x.overdue)}</strong></td>
                  </tr>
                ))}
              </tbody></table>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
