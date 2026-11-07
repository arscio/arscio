'use client';
// The frame around every screen: the side menu (showing only what this
// person's roles allow), the school's name, and who's logged in.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ROLE_LABELS, type Permission } from '@aiedu/shared';
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
      { href: '/fees', label: 'Fees & receipts', perm: 'fees.collect' },
      { href: '/notices', label: 'Notices', perm: 'notices.publish', soon: 'Dec' },
      { href: '/exams', label: 'Exams & report cards', perm: 'reportcards.manage', soon: 'Jan' },
    ],
  },
  {
    group: 'School setup',
    items: [
      { href: '/classes', label: 'Classes & sections', perm: 'students.view' },
      { href: '/subjects', label: 'Subjects', perm: 'school.settings' },
      { href: '/staff', label: 'Staff & roles', perm: 'students.view' },
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
  const multiSchool = state.me.schools.filter((s) => s.roles.some((r) => r !== 'parent')).length > 1;

  return (
    <SchoolCtx.Provider value={{ ...state, can, reload: load }}>
      <div className="frame">
        <nav className="side" data-open={menuOpen} aria-label="Main menu">
          <div className="side-brand"><Logo size={26} onDark /></div>
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
                    aria-current={(it.href === '/' ? path === '/' : path.startsWith(it.href)) ? 'page' : undefined}>
                    {it.label}
                    {it.soon ? <span className="soon">{it.soon}</span> : null}
                  </Link>
                ))}
              </div>
            );
          })}
          <div className="side-foot">
            <div><strong>{state.me.account.name}</strong></div>
            <div style={{ color: '#9DB7AC' }}>{state.info.me.roles.map((r) => ROLE_LABELS[r]).join(', ')}</div>
            {multiSchool ? <button onClick={() => router.push('/choose-school')}>Switch school</button> : null}
            <br />
            <button onClick={async () => { await auth.logout(); router.replace('/login'); }}>Log out</button>
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
