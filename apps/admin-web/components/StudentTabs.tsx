'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSchool } from './AppShell';

export function StudentTabs({ id }: { id: string }) {
  const { can } = useSchool();
  const path = usePathname();
  if (!can('students.manage')) return null;
  const tabs = [{ href: `/students/${id}`, label: 'Details' }, { href: `/students/${id}/file`, label: 'Student file' }];
  return (
    <nav className="tabs" aria-label="Student">
      {tabs.map((t) => <Link key={t.href} href={t.href} aria-current={path === t.href ? 'page' : undefined}>{t.label}</Link>)}
    </nav>
  );
}
