'use client';
// Print one report card (?student=) or a whole class (?section=), one card per A4 page.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Report } from '@/components/Exams';
import { ReportCard } from '@/components/ReportCard';
import { Loading } from '@/components/ui';

export default function Page() { return <Suspense fallback={<Loading />}><Print /></Suspense>; }

function Print() {
  const p = useSearchParams();
  const student = p.get('student');
  const section = p.get('section');
  const [reports, setReports] = useState<Report[] | null>(null);
  useEffect(() => {
    if (student) api.get<Report>(`/reportcards/student/${student}`).then((r) => setReports([r]));
    else if (section) api.get<{ reports: Report[] }>(`/reportcards/section/${section}`).then((r) => setReports(r.reports));
  }, [student, section]);
  if (!reports) return <Loading />;
  return (
    <>
      <div className="page-head no-print">
        <div>
          <Link href="/exams/report-cards" className="small">Back to report cards</Link>
          <h1 style={{ marginTop: 4 }}>{reports.length === 1 ? reports[0]!.student.name : `${reports.length} report cards`}</h1>
          <p>Prints one card per A4 page with very little ink.</p>
        </div>
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="report-sheet">{reports.map((r) => <ReportCard key={r.student.id} r={r} />)}</div>
    </>
  );
}
