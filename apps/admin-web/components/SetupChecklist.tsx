'use client';
// The steps to get the school ready, ticking them off as they're done.
// Shown on Home for office staff, and on /setup for the principal.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { StaffMember, Structure, StudentRow } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { Loading } from '@/components/ui';

export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const { info, me, can } = useSchool();
  const [data, setData] = useState<{ s: Structure; staff: StaffMember[]; students: number } | null>(null);
  const isOffice = can('students.view');

  useEffect(() => {
    if (!isOffice) return;
    Promise.all([
      api.get<Structure>('/setup/structure'),
      api.get<{ staff: StaffMember[] }>('/staff'),
      api.get<{ students: StudentRow[] }>('/students'),
    ]).then(([s, st, stu]) => setData({ s, staff: st.staff, students: stu.students.length }));
  }, [isOffice]);

  if (!isOffice) {
    return (
      <div className="sheet empty">
        <h3>Hello, {me.account.name}</h3>
        <p>Attendance, homework and marks are done in the Arscio teacher app, with the same number and password.</p>
      </div>
    );
  }
  if (!data) return <Loading />;

  const sections = data.s.classes.flatMap((c) => c.sections);
  const steps = [
    { done: Boolean(info.school.address && info.school.phone), title: 'Check the school details',
      what: 'Name, address and phone number that appear on receipts and report cards.', href: '/settings', perm: 'school.settings' },
    { done: sections.length > 0, title: 'Add sections to each class',
      what: `${sections.length} sections so far for ${data.s.year.name}.`, href: '/classes', perm: 'school.settings' },
    { done: data.s.subjects.length > 0 && data.s.classes.some((c) => c.subject_ids.length), title: 'Add subjects and choose them for each class',
      what: `${data.s.subjects.length} subjects added.`, href: '/subjects', perm: 'school.settings' },
    { done: data.staff.length > 1, title: 'Add teachers and office staff, and give them roles',
      what: `${data.staff.length} people on the staff list.`, href: '/staff', perm: 'roles.assign' },
    { done: sections.length > 0 && sections.every((x) => x.classTeacherId), title: 'Choose a class teacher for each section',
      what: `${sections.filter((x) => x.classTeacherId).length} of ${sections.length} sections have one.`, href: '/classes', perm: 'school.settings' },
    { done: data.students > 0, title: 'Add students',
      what: `${data.students} students added. Each family is linked by one phone number.`, href: '/students', perm: 'students.manage' },
  ].filter((s) => can(s.perm as never));
  const left = steps.filter((s) => !s.done).length;
  if (compact) {
    if (left === 0) return null;
    return (
      <Link href="/setup" className="setup-nudge">
        <span><strong>{left} setup {left === 1 ? 'step' : 'steps'} left</strong> <span className="muted small">{steps.find((x) => !x.done)?.title}</span></span>
        <span className="small">Continue setup</span>
      </Link>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Getting {info.school.name} ready</h1>
          <p>{left === 0 ? 'Everything is set up for this year.' : `${left} of ${steps.length} steps left. Do them in this order; each one uses the one before.`}</p>
        </div>
      </div>
      <div className="sheet">
        <table className="register"><tbody>
          {steps.map((s, i) => (
            <tr key={s.title}>
              <td className="num muted" style={{ fontSize: '1.125rem' }}>{i + 1}</td>
              <td>
                <strong>{s.title}</strong>
                <div className="small muted">{s.what}</div>
              </td>
              <td style={{ width: 110 }}>{s.done ? <span className="tag tag-board">Done</span> : <span className="tag tag-warn">To do</span>}</td>
              <td className="actions"><Link className={`btn ${s.done ? 'btn-plain' : 'btn-primary'}`} href={s.href}>{s.done ? 'Review' : 'Start'}</Link></td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}
