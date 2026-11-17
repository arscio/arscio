'use client';
// Login, exactly as decided:
//   phone -> (first time) code by SMS -> set a password
//   phone -> (after that) password
//   "Forgot password" -> code by SMS -> new password
// Password mode (no SMS): email or mobile number + the password the principal gave,
// then the person must choose their own password.
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, auth } from '@/lib/api';
import { ErrorBox, Field, PhoneInput } from '@/components/ui';
import { Logo } from '@/components/Logo';

type Step = 'phone' | 'password' | 'otp' | 'new-password';

export default function LoginPage() {
  const [mode, setMode] = useState<'otp' | 'password' | null>(null);
  useEffect(() => { auth.mode().then((m) => setMode(m.mode)).catch(() => setMode('otp')); }, []);
  if (!mode) return <div className="login-wrap"><LoginArt /><section className="login-form" /></div>;
  return mode === 'password' ? <PasswordLogin /> : <OtpLogin />;
}

function LoginArt() {
  return (
    <section className="login-art">
      <Logo size={34} />
      <svg className="big-mark" width="460" height="460" viewBox="0 0 100 100" aria-hidden>
          <g fill="#0B7FA6" stroke="#0B7FA6" strokeWidth="7" strokeLinejoin="round"><path d="M10 89L41 12H59L90 89H74L50 33L26 89Z" /></g>
          <path d="M41 80C41 66 49 58 61 57C61 71 53 79 41 80Z" fill="#F2A33A" />
      </svg>
      <div>
        <h1>The school office, in one place.</h1>
        <p>Students, attendance, fees, notices and report cards, for owners, principals and office staff.</p>
      </div>
    </section>
  );
}

function PasswordLogin() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    auth.step<{ mustChangePassword: boolean }>('login', { identifier: id, password })
      .then((r) => router.replace(r.mustChangePassword ? '/change-password' : '/choose-school'))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not connect. Check the internet and try again.'))
      .finally(() => setBusy(false));
  };
  return (
    <div className="login-wrap">
      <LoginArt />
      <section className="login-form">
        <form className="stack" style={{ maxWidth: 380 }} onSubmit={submit}>
          <div><h2>Log in</h2><p className="muted">Use the email or mobile number the school has for you.</p></div>
          <Field label="Email or mobile number" htmlFor="id">
            <input id="id" className="input" autoComplete="username" autoFocus required
              value={id} onChange={(e) => setId(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="pw">
            <input id="pw" className="input" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy || !id.trim() || !password}>Log in</button>
          <p className="muted small">Forgot your password? Ask the principal to give you a new one.</p>
        </form>
      </section>
    </div>
  );
}

function OtpLogin() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [isReset, setIsReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not connect. Check the internet and try again.'); }
    finally { setBusy(false); }
  };

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await auth.step<{ next: 'otp' | 'password' }>('start', { phone });
      if (r.next === 'password') setStep('password');
      else { setIsReset(false); setInfo(`We sent a 6-digit code by SMS to +91 ${phone}.`); setStep('otp'); }
    });
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await auth.step('login', { phone, password });
      router.replace('/choose-school');
    });
  };

  const forgot = () => run(async () => {
    await auth.step('forgot', { phone });
    setIsReset(true); setCode(''); setInfo(`We sent a 6-digit code by SMS to +91 ${phone}.`); setStep('otp');
  });

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await auth.step<{ setupToken: string }>('verify-otp', { phone, code });
      setSetupToken(r.setupToken); setInfo(null); setStep('new-password');
    });
  };

  const submitNewPassword = (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== newPw2) { setError('The two passwords are not the same.'); return; }
    void run(async () => {
      await auth.step('set-password', { setupToken, password: newPw });
      router.replace('/choose-school');
    });
  };

  const back = () => { setStep('phone'); setError(null); setInfo(null); setPassword(''); setCode(''); };

  return (
    <div className="login-wrap">
<LoginArt />

      <section className="login-form">
        <div className="stack" style={{ maxWidth: 380 }}>
          {step === 'phone' && (
            <form className="stack" onSubmit={submitPhone}>
              <div><h2>Log in</h2><p className="muted">Use the mobile number the school has for you.</p></div>
              <Field label="Mobile number" htmlFor="phone">
                <PhoneInput id="phone" value={phone} onChange={setPhone} autoFocus required />
              </Field>
              <ErrorBox error={error} />
              <button className="btn btn-primary" disabled={busy || phone.length !== 10}>Continue</button>
            </form>
          )}

          {step === 'password' && (
            <form className="stack" onSubmit={submitPassword}>
              <div><h2>Enter your password</h2><p className="muted">For +91 {phone}</p></div>
              <Field label="Password" htmlFor="pw">
                <input id="pw" className="input" type="password" autoComplete="current-password" autoFocus required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <ErrorBox error={error} />
              <button className="btn btn-primary" disabled={busy || !password}>Log in</button>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-quiet" onClick={back}>Use another number</button>
                <button type="button" className="btn btn-quiet" onClick={forgot} disabled={busy}>Forgot password?</button>
              </div>
            </form>
          )}

          {step === 'otp' && (
            <form className="stack" onSubmit={submitCode}>
              <div><h2>Enter the code</h2><p className="muted">{info}</p></div>
              <Field label="6-digit code" htmlFor="otp" hint="The code works for 5 minutes.">
                <input id="otp" className="input otp-input" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={6} autoFocus required value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <ErrorBox error={error} />
              <button className="btn btn-primary" disabled={busy || code.length !== 6}>Check code</button>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-quiet" onClick={back}>Use another number</button>
                <button type="button" className="btn btn-quiet" disabled={busy}
                  onClick={() => (isReset ? forgot() : run(async () => {
                    await auth.step('start', { phone }); setInfo(`We sent a new code to +91 ${phone}.`);
                  }))}>Send a new code</button>
              </div>
            </form>
          )}

          {step === 'new-password' && (
            <form className="stack" onSubmit={submitNewPassword}>
              <div>
                <h2>{isReset ? 'Choose a new password' : 'Create your password'}</h2>
                <p className="muted">You will use this with your mobile number from now on.</p>
              </div>
              <Field label="New password" htmlFor="np" hint="At least 6 characters. Avoid easy ones like 123456.">
                <input id="np" className="input" type="password" autoComplete="new-password" autoFocus required
                  value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </Field>
              <Field label="Type it again" htmlFor="np2">
                <input id="np2" className="input" type="password" autoComplete="new-password" required
                  value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
              </Field>
              <ErrorBox error={error} />
              <button className="btn btn-primary" disabled={busy || newPw.length < 6}>Save password and log in</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
