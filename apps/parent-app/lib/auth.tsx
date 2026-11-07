// Who is logged in, their children (from every school), and which child is selected.
// The selected child's SCHOOL decides the look inside the app: its logo, name and colour.
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { call, logout as apiLogout, session } from './api';
import { registerForPush } from './push';
import { C } from './theme';

export interface Child {
  id: string; first_name: string; last_name: string | null; admission_no: string; photo_url: string | null;
  class_name: string | null; section_name: string | null; roll_no: number | null;
  schoolId: string; schoolName: string; schoolShortName: string | null; schoolLogoUrl: string | null; schoolColor: string | null;
}
interface Me { account: { id: string; name: string; phone: string } }

type State =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; me: Me; children: Child[]; childId: string | null };

const Ctx = createContext<{
  state: State;
  child: Child | null;
  /** The school's colour, or AIEdu emerald if the school hasn't set one. */
  accent: string;
  afterLogin: () => Promise<void>;
  selectChild: (id: string) => void;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export const useParent = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useParent outside ParentProvider');
  return c;
};

/**
 * A school-specific build can lock the app to one school. Only a real school ID
 * counts (Expo turns an empty setting into "{}", which must NOT lock the app).
 */
const rawLock = (Constants.expoConfig?.extra as { brand?: { lockToSchoolId?: unknown } } | undefined)?.brand?.lockToSchoolId;
const lockedSchool: string | null =
  typeof rawLock === 'string' && /^[0-9a-f-]{36}$/i.test(rawLock) ? rawLock : null;

function goFresh(path: '/' | '/login') {
  if (router.canDismiss()) router.dismissAll();
  router.replace(path);
}

export function ParentProvider({ children: kids }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const enter = useCallback(async () => {
    const me = await call<Me>('GET', '/me');
    let list = (await call<{ children: Child[] }>('GET', '/me/children')).children;
    if (lockedSchool) list = list.filter((c) => c.schoolId === lockedSchool);
    const saved = session.schoolId; // (we store the selected child's id here)
    const childId = list.find((c) => c.id === saved)?.id ?? list[0]?.id ?? null;
    setState({ status: 'in', me, children: list, childId });
    void registerForPush();
    goFresh('/');
  }, []);

  useEffect(() => {
    session.onLoggedOut(() => { setState({ status: 'out' }); goFresh('/login'); });
    (async () => {
      if (!(await session.load())) { setState({ status: 'out' }); goFresh('/login'); return; }
      try { await enter(); } catch { setState({ status: 'out' }); goFresh('/login'); }
    })();
  }, [enter]);

  const child = state.status === 'in' ? state.children.find((c) => c.id === state.childId) ?? null : null;
  const value = {
    state,
    child,
    accent: child?.schoolColor ?? C.board,
    afterLogin: enter,
    selectChild: (id: string) => {
      if (state.status !== 'in') return;
      void session.setSchool(id);
      setState({ ...state, childId: id });
    },
    reload: async () => {
      if (state.status !== 'in') return;
      let list = (await call<{ children: Child[] }>('GET', '/me/children')).children;
      if (lockedSchool) list = list.filter((c) => c.schoolId === lockedSchool);
      setState({ ...state, children: list });
    },
    logout: async () => { await apiLogout(); setState({ status: 'out' }); goFresh('/login'); },
  };
  return <Ctx.Provider value={value}>{kids}</Ctx.Provider>;
}
