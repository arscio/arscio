'use client';
// After login: pick the school to work in. With only one school, this is skipped.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROLE_LABELS } from '@arscio/shared';
import { ApiError, api, auth } from '@/lib/api';
import type { Me } from '@/lib/types';
import { ErrorBox, Loading } from '@/components/ui';
import { Logo } from '@/components/Logo';

export default function ChooseSchool() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (id: string) => {
    try { await auth.chooseSchool(id); router.replace('/'); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not open that school'); }
  };

  useEffect(() => {
    api.get<Me>('/me').then((m) => {
      setMe(m);
      const staff = m.schools.filter((s) => s.roles.some((r) => r !== 'parent'));
      if (staff.length === 1) void pick(staff[0]!.id);
    }).catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return <Loading />;
  const staff = me.schools.filter((s) => s.roles.some((r) => r !== 'parent'));

  return (
    <div className="main" style={{ maxWidth: 640, margin: '0 auto', paddingTop: 64 }}>
      <div style={{ marginBottom: 28 }}><Logo size={30} /></div>
      <div className="page-head"><div><h1>Hello, {me.account.name}</h1>
        <p>{staff.length ? 'Choose the school you want to work in.' : ''}</p></div></div>
      <ErrorBox error={error} />
      {staff.length === 0 ? (
        <div className="sheet empty">
          <h3>This website is for school staff</h3>
          <p>Parents can see their children's attendance, fees and results in the Arscio parent app.</p>
          <button className="btn btn-plain" onClick={async () => { await auth.logout(); router.replace('/login'); }}>Log out</button>
        </div>
      ) : (
        <div className="sheet">
          <table className="register"><tbody>
            {staff.map((s, i) => (
              <tr key={s.id}>
                <td className="num muted">{i + 1}</td>
                <td><strong>{s.name}</strong><div className="small muted">
                  {s.roles.filter((r) => r !== 'parent').map((r) => ROLE_LABELS[r]).join(', ')}</div></td>
                <td className="actions"><button className="btn btn-primary" onClick={() => pick(s.id)}>Open</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
