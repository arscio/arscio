'use client';
// Small building blocks used on every screen.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function Field(props: {
  label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={props.htmlFor}>{props.label}</label>
      {props.children}
      {props.error ? <span className="err" role="alert">{props.error}</span>
        : props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}

/** Indian mobile number box with +91 shown in front. */
export function PhoneInput(props: {
  id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; required?: boolean;
}) {
  return (
    <div className="phone-input">
      <span aria-hidden>+91</span>
      <input
        id={props.id} className="input num" inputMode="numeric" autoComplete="tel-national"
        maxLength={10} placeholder="10-digit mobile number" required={props.required}
        autoFocus={props.autoFocus} value={props.value}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
      />
    </div>
  );
}

/** Form that slides in from the right. */
export function Panel(props: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} className="panel" onClose={props.onClose} aria-labelledby="panel-title">
      <div className="panel-head">
        <h2 id="panel-title">{props.title}</h2>
        <button className="x" onClick={props.onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">{props.open ? props.children : null}</div>
      {props.footer ? <div className="panel-foot">{props.footer}</div> : null}
    </dialog>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className="toast" role="status">{msg}</div> : null;
  return { show: useCallback((m: string) => setMsg(m), []), node };
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error-box" role="alert">{error}</div> : null;
}

export function Loading() {
  return <p className="muted" style={{ padding: 20 }}>Loading…</p>;
}
