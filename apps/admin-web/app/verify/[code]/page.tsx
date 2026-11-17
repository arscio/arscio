'use client';
// Anyone who scans the QR code on a marksheet lands here and sees what the school issued.
// If it matches the paper, the marksheet is genuine.
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';

interface Result {
  valid: boolean; school?: string; student?: string; admissionNo?: string; class?: string; session?: string;
  pct?: number | null; grade?: string | null; result?: string; issuedOn?: string;
}

export default function Verify() {
  const { code } = useParams<{ code: string }>();
  const [r, setR] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`/api/verify/${encodeURIComponent(code)}`).then((x) => (x.ok ? x.json() : Promise.reject())).then(setR).catch(() => setFailed(true));
  }, [code]);

  return (
    <div className="main" style={{ maxWidth: 520, margin: '0 auto', paddingTop: 56 }}>
      <div style={{ marginBottom: 28 }}><Logo size={28} /></div>
      <h1 style={{ fontSize: 26 }}>Marksheet check</h1>
      <p className="muted" style={{ marginTop: 6 }}>Code <strong className="num">{decodeURIComponent(code).toUpperCase()}</strong></p>
      <div className="sheet sheet-pad" style={{ marginTop: 20 }}>
        {failed ? <p>The check could not be done right now. Please try again in a few minutes.</p>
          : !r ? <p className="muted">Checking…</p>
          : !r.valid ? (
            <>
              <h2 style={{ color: 'var(--red-ink)' }}>No marksheet with this code</h2>
              <p style={{ marginTop: 8 }}>Check that the code matches the one printed under the QR code. If it does, this marksheet was not issued by the school; please contact the school.</p>
            </>
          ) : (
            <>
              <h2 style={{ color: 'var(--lagoon-deep)' }}>Issued by {r.school}</h2>
              <p className="small muted" style={{ marginTop: 4 }}>Compare these details with the paper. If they match, the marksheet is genuine.</p>
              <dl className="stack" style={{ gap: 10, marginTop: 16 }}>
                {([['Student', r.student], ['Admission no.', r.admissionNo], ['Class', r.class], ['Session', r.session],
                   ['Overall', r.pct != null ? `${r.pct}%${r.grade ? ` (grade ${r.grade})` : ''}` : r.grade ?? '-'], ['Result', r.result],
                   ['Issued', r.issuedOn ? new Date(r.issuedOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '-']] as const)
                  .map(([k, v]) => (
                    <div key={k} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--rule)', paddingBottom: 8 }}>
                      <dt className="muted">{k}</dt><dd><strong>{v}</strong></dd>
                    </div>
                  ))}
              </dl>
            </>
          )}
      </div>
    </div>
  );
}
