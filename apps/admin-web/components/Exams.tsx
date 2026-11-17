'use client';
// Shared pieces for the Exams & report cards pages.
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface Exam {
  id: string; name: string; maxMarks: string; weightagePct: string; classIds: string[];
  startsOn: string | null; locked: boolean; marksEntered: number;
  endsOn?: string | null; marksDueOn?: string | null; internals?: { subjectId: string; internalMax: string }[];
}
export interface Term { id: string; name: string; sortOrder: number; publishedAt: string | null; exams: Exam[] }
export interface Band { min?: number; max?: number; grade: string; point?: number; label?: string }
export interface ExamSetup {
  year: { id: string; name: string };
  terms: Term[];
  classes: { id: string; name: string; style: 'grades_only' | 'marks_and_grades' }[];
  subjects?: { id: string; name: string }[];
  scales: { id: string; name: string; bands: Band[] }[];
}

export interface Cell { examId: string; marks: number | null; max: number; grade: string | null; absent: boolean; entered: boolean;
  internal?: number | null; internalMax?: number | null }
export interface Report {
  student: {
    id: string; name: string; admissionNo: string; photoUrl: string | null; dateOfBirth: string | null;
    fatherName: string | null; motherName: string | null; rollNo: number | null;
    className: string; sectionName: string; classTeacher: string | null;
  };
  school: { id: string; name: string; shortName: string | null; address: string | null; phone: string | null;
    logoUrl: string | null; brandColor: string | null; affiliationNo: string | null; board: string };
  yearName: string;
  style: 'grades_only' | 'marks_and_grades';
  scale: Band[];
  terms: {
    id: string; name: string; publishedAt: string | null;
    exams: { id: string; name: string; max: number; weightagePct: number }[];
    rows: { subjectId: string; subject: string; cells: Cell[]; pct: number | null; grade: string | null }[];
    pct: number | null; grade: string | null; remark: string | null;
  }[];
  year: { rows: { subject: string; pct: number | null; grade: string | null }[]; pct: number | null; grade: string | null; needsSupportIn: string[] } | null;
  attendance: { present: number; days: number; pct: number | null };
}

export function ExamsTabs() {
  const path = usePathname();
  const tabs = [
    { href: '/exams', label: 'Exams and weightage' },
    { href: '/exams/marks', label: 'Marks' },
    { href: '/exams/report-cards', label: 'Report cards' },
    { href: '/exams/results', label: 'Results day' },
  ];
  return (
    <nav className="tabs no-print" aria-label="Exams">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          aria-current={(t.href === '/exams' ? path === '/exams' : path.startsWith(t.href)) ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

export const pct = (n: number | null) => (n === null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);
export const num = (v: string | number) => String(Number(v));

/** 12 Nov */
export const shortDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
