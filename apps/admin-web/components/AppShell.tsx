'use client';
// The frame around every screen: the side menu (showing only what this
// person's roles allow), the school's name, and who's logged in.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ROLE_LABELS, type Permission } from '@arscio/shared';
import { ApiError, api, auth } from '@/lib/api';
import type { Me, SchoolInfo } from '@/lib/types';
import { Loading } from './ui';
import { Logo } from './Logo';

interface Ctx {
  info: SchoolInfo;
  me: Me;
  can: (p: Permission) => boolean;
  reload: () => Promise<void>;
}
const SchoolCtx = createContext<Ctx | null>(null);
export const useSchool = () => {
  const c = useContext(SchoolCtx);
  if (!c) throw new Error('useSchool outside AppShell');
  return c;
};

type NavItem = { href: string; label: string; perm: Permission; soon?: string };
const NAV: { group?: string; items: NavItem[] }[] = [
  { items: [{ href: '/', label: 'Home', perm: 'students.view' }] },
  {
    group: 'Daily work',
    items: [
      { href: '/students', label: 'Students', perm: 'students.view' },
      { href: '/attendance', label: 'Attendance', perm: 'attendance.view_all' },
      { href: '/staff/attendance', label: 'Staff attendance', perm: 'attendance.view_all' },
      { href: '/cover', label: 'Leave and cover', perm: 'leave.approve' },
      { href: '/fees', label: 'Fees & receipts', perm: 'fees.collect' },
      { href: '/notices', label: 'Notices', perm: 'notices.publish' },
      { href: '/exams', label: 'Exams & report cards', perm: 'reportcards.manage' },
    ],
  },
  {
    group: 'School setup',
    items: [
      { href: '/classes', label: 'Classes & sections', perm: 'students.view' },
      { href: '/subjects', label: 'Subjects', perm: 'school.settings' },
      { href: '/timetable', label: 'Timetable', perm: 'timetable.manage' },
      { href: '/staff', label: 'Staff & roles', perm: 'students.view' },
      { href: '/parent-logins', label: 'Parent logins', perm: 'students.view' },
      { href: '/data', label: 'Excel import and export', perm: 'data.import_export' },
      { href: '/new-year', label: 'New school year', perm: 'school.settings' },
      { href: '/settings', label: 'School settings', perm: 'school.settings' },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<{ info: SchoolInfo; me: Me } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [info, me] = await Promise.all([api.get<SchoolInfo>('/school'), api.get<Me>('/me')]);
      setState({ info, me });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) router.replace('/choose-school');
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setMenuOpen(false); }, [path]);

  if (!state) return <Loading />;
  const perms = new Set(state.info.me.permissions);
  const can = (p: Permission) => perms.has(p);
  // The menu item whose link best matches the page (e.g. /staff/attendance over /staff).
  const activeHref = NAV.flatMap((g) => g.items).map((it) => it.href)
    .filter((h) => (h === '/' ? path === '/' : path === h || path.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const multiSchool = state.me.schools.filter((s) => s.roles.some((r) => r !== 'parent')).length > 1;

  return (
    <SchoolCtx.Provider value={{ ...state, can, reload: load }}>
      <div className="frame">
        <nav className="side" data-open={menuOpen} aria-label="Main menu">
          <div className="side-brand"><Logo size={28} /></div>
          <div className="side-school">
            <strong>{state.info.school.name}</strong>
            <span>{state.info.school.board}</span>
          </div>
          {NAV.map((g, i) => {
            const items = g.items.filter((it) => can(it.perm));
            if (!items.length) return null;
            return (
              <div key={i}>
                {g.group ? <div className="side-group">{g.group}</div> : null}
                {items.map((it) => (
                  <Link key={it.href} href={it.href}
                    aria-current={it.href === activeHref ? 'page' : undefined}>
                    <NavIcon href={it.href} />
                    {it.label}
                    {it.soon ? <span className="soon">{it.soon}</span> : null}
                  </Link>
                ))}
              </div>
            );
          })}
          <div className="side-foot">
            <div className="who">
              <span className="initials" aria-hidden>{state.me.account.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <div>
                <div><strong>{state.me.account.name}</strong></div>
                <div className="muted small">{state.info.me.roles.map((r) => ROLE_LABELS[r]).join(', ')}</div>
              </div>
            </div>
            <div className="links">
              {multiSchool ? <button onClick={() => router.push('/choose-school')}>Switch school</button> : null}
              <button onClick={() => router.push('/change-password')}>Change password</button>
              <button onClick={async () => { await auth.logout(); router.replace('/login'); }}>Log out</button>
            </div>
          </div>
        </nav>
        <main className="main">
          <button className="btn btn-plain menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">Menu</button>
          {children}
        </main>
      </div>
    </SchoolCtx.Provider>
  );
}

export function Coming({ title, when, what }: { title: string; when: string; what: string }) {
  return (
    <>
      <div className="page-head"><h1>{title}</h1></div>
      <div className="sheet empty">
        <h3>Coming in {when}</h3>
        <p>{what}</p>
      </div>
    </>
  );
}

const ICON_PATHS: Record<string, string[]> = {
  '/data': ['M5 3h10l4 4v14H5z', 'M15 3v4h4', 'M8.5 11l5 6', 'M13.5 11l-5 6'],
  '/new-year': ['M4 7h16v13H4z', 'M4 11h16', 'M8 4v5', 'M16 4v5', 'M10 15.5l2 2 3.5-3.5'],
  '/': ['M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  '/students': ['M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z', 'M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5', 'M16 4.5a3.5 3.5 0 0 1 0 7', 'M18 15c2 .6 3 2 3.5 5'],
  '/attendance': ['M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z', 'M3 10h18', 'M8 3v4M16 3v4', 'M9 15l2 2 4-4'],
  '/fees': ['M7 4h10M7 9h10', 'M7 4c5 0 5 5 0 5l7 11'],
  '/notices': ['M4 10v4h3l6 4V6l-6 4z', 'M17 9a4 4 0 0 1 0 6'],
  '/exams': ['M6 3h9l4 4v14H6z', 'M9 12h7M9 16h5'],
  '/classes': ['M4 5h16v14H4z', 'M4 10h16M10 10v9'],
  '/subjects': ['M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z', 'M4 19a2 2 0 0 0 2 2h13'],
  '/staff': ['M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6'],
  '/staff/attendance': ['M10 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z', 'M3.5 20c1-3.5 3.5-5 6.5-5 1.5 0 2.8.4 3.9 1.1', 'M15 18l2 2 4-4'],
  '/cover': ['M8 3h8v4H8z', 'M6 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1', 'M9 14l2 2 4-4'],
  '/timetable': ['M4 4h16v16H4z', 'M4 9h16M4 14h16M9 4v16M14 4v16'],
  '/settings': ['M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1'],
};

function NavIcon({ href }: { href: string }) {
  const d = ICON_PATHS[href];
  if (!d) return null;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {d.map((p) => <path key={p} d={p} />)}
    </svg>
  );
}
