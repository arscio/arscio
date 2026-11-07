// Remembers who is logged in and which school they're working in,
// and sends them to the right screen.
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { call, logout as apiLogout, session } from './api';

export interface Me {
  account: { id: string; name: string; phone: string };
  schools: { id: string; name: string; roles: string[] }[];
}

type State =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; me: Me; schoolId: string | null; canTeach: boolean };

const Ctx = createContext<{
  state: State;
  afterLogin: () => Promise<void>;
  chooseSchool: (id: string) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
};

// The teacher app is for teaching only: you need the Teacher role at the school.
// (Office work, even for a principal, is done on the school website.)
const teachingSchools = (me: Me) => me.schools.filter((s) => s.roles.includes('teacher'));

/** Go to a screen and forget the screens behind it (so there's no stray "back" arrow). */
function goFresh(path: '/' | '/login' | '/choose-school') {
  if (router.canDismiss()) router.dismissAll();
  router.replace(path);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const enter = useCallback(async () => {
    const me = await call<Me>('GET', '/me');
    const schools = teachingSchools(me);
    let schoolId = session.schoolId && schools.some((s) => s.id === session.schoolId) ? session.schoolId : null;
    if (!schoolId && schools.length === 1) schoolId = schools[0]!.id;
    await session.setSchool(schoolId);
    const canTeach = Boolean(schoolId);
    setState({ status: 'in', me, schoolId, canTeach });
    goFresh(schoolId || schools.length === 0 ? '/' : '/choose-school');
  }, []);

  useEffect(() => {
    session.onLoggedOut(() => { setState({ status: 'out' }); goFresh('/login'); });
    (async () => {
      if (!(await session.load())) { setState({ status: 'out' }); goFresh('/login'); return; }
      try { await enter(); } catch { setState({ status: 'out' }); goFresh('/login'); }
    })();
  }, [enter]);

  const value = {
    state,
    afterLogin: enter,
    chooseSchool: async (id: string) => { await session.setSchool(id); await enter(); },
    logout: async () => { await apiLogout(); setState({ status: 'out' }); goFresh('/login'); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
