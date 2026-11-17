'use client';
// Change password. Also the screen everyone lands on after logging in with a
// password the school gave them (they must choose their own before going on).
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, auth } from '@/lib/api';
import { ErrorBox, Field, Loading } from '@/components/ui';
import { Logo } from '@/components/Logo';

interface MeLite { account: { name: string; mustChangePassword?: boolean } }

export default function ChangePassword() {
  const router = useRouter();
  const [me, setMe] = useState<MeLite | null>(null);
  const [oldPw, setOldPw] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<MeLite>('/me').then(setMe).catch(() => router.replace('/login')); }, [router]);
  if (!me) return <Loading />;
  const forced = !!me.account.mustChangePassword;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setError('The two new passwords are not the same.'); return; }
    setBusy(true); setError(null);
    auth.step('change-password', { oldPassword: oldPw, newPassword: pw })
      .then(() => router.replace(forced ? '/choose-school' : '/'))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not connect. Check the internet and try again.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="main" style={{ maxWidth: 440, margin: '0 auto', paddingTop: 64 }}>
      <div style={{ marginBottom: 28 }}><Logo size={30} /></div>
      <form className="stack" onSubmit={submit}>
        <div>
          <h1 style={{ fontSize: 24 }}>{forced ? 'Choose your own password' : 'Change password'}</h1>
          <p className="muted">
            {forced
              ? `Welcome, ${me.account.name}. The password you were given works only once. Choose one that only you know.`
              : 'You will be logged out on your other phones and computers.'}
          </p>
        </div>
        {!forced && (
          <Field label="Current password" htmlFor="old">
            <input id="old" className="input" type="password" autoComplete="current-password" required autoFocus
              value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </Field>
        )}
        <Field label="New password" htmlFor="np" hint="At least 6 characters. Avoid easy ones like 123456 or a date of birth.">
          <input id="np" className="input" type="password" autoComplete="new-password" required autoFocus={forced}
            value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Type it again" htmlFor="np2">
          <input id="np2" className="input" type="password" autoComplete="new-password" required
            value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy || pw.length < 6}>Save new password</button>
        {forced
          ? <button type="button" className="btn btn-quiet" onClick={async () => { await auth.logout(); router.replace('/login'); }}>Log out</button>
          : <button type="button" className="btn btn-quiet" onClick={() => router.back()}>Cancel</button>}
      </form>
    </div>
  );
}
