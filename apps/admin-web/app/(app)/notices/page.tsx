'use client';
// Notices: write once, choose who gets it, and it arrives as an app notification.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel, type Structure } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

interface Notice {
  id: string; title: string; body: string; audience: string; classIds: string[]; sectionIds: string[];
  publishedAt: string; sentBy: string; withdrawnAt: string | null; withdrawnBy: string | null;
  recipients: number; readBy: number;
}
const AUDIENCE: Record<string, string> = {
  everyone: 'Everyone (parents and staff)', parents: 'All parents', staff: 'All staff', classes: 'Parents of chosen classes', sections: 'Parents of chosen sections',
};
const when = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function NoticesPage() {
  const { can } = useSchool();
  const [list, setList] = useState<Notice[] | null>(null);
  const [structure, setStructure] = useState<Structure | null>(null);
  const [writing, setWriting] = useState(false);
  const [open, setOpen] = useState<Notice | null>(null);
  const toast = useToast();
  const load = useCallback(async () => setList((await api.get<{ notices: Notice[] }>('/notices')).notices), []);
  useEffect(() => { void load(); api.get<Structure>('/setup/structure').then(setStructure); }, [load]);
  if (!list || !structure) return <Loading />;

  const classNames = new Map(structure.classes.map((c) => [c.id, classLabel(c.name)]));
  const sectionNames = new Map(structure.classes.flatMap((c) => c.sections.map((s) => [s.id, `${sectionLabel(c.name, s.name)}`] as const)));
  const to = (n: Notice) => n.audience === 'classes' ? n.classIds.map((id) => classNames.get(id)).join(', ')
    : n.audience === 'sections' ? n.sectionIds.map((id) => sectionNames.get(id)).join(', ') : AUDIENCE[n.audience];

  return (
    <>
      <div className="page-head">
        <div><h1>Notices</h1><p>Each notice arrives as a notification in the parent or teacher app, and stays in their messages.</p></div>
        {can('notices.publish') ? <button className="btn btn-primary" onClick={() => setWriting(true)}>Write a notice</button> : null}
      </div>
      <div className="sheet table-wrap">
        {list.length === 0 ? <div className="empty"><h3>No notices yet</h3><p>Holidays, exam dates, meetings: write one and choose who should get it.</p></div> : (
          <table className="register">
            <thead><tr><th>Sent</th><th>Notice</th><th>To</th><th>Read by</th><th></th></tr></thead>
            <tbody>{list.map((n) => (
              <tr key={n.id} className={n.withdrawnAt ? 'struck' : undefined}>
                <td className="small nowrap">{when(n.publishedAt)}<div className="muted">{n.sentBy}</div></td>
                <td><strong>{n.title}</strong><div className="small muted" style={{ maxWidth: '52ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div></td>
                <td className="small">{to(n)}</td>
                <td className="small keep">{n.withdrawnAt ? <span className="tag tag-off">Withdrawn</span>
                  : <><span className="num">{n.readBy}</span> of <span className="num">{n.recipients}</span></>}</td>
                <td className="actions keep"><button className="btn btn-plain" onClick={() => setOpen(n)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <Panel open={writing} title="Write a notice" onClose={() => setWriting(false)}>
        {writing ? <Compose structure={structure} onSent={async (m) => { setWriting(false); await load(); toast.show(m); }} /> : null}
      </Panel>
      <Panel open={!!open} title={open?.title ?? ''} onClose={() => setOpen(null)}>
        {open ? (
          <div className="stack">
            <p className="small muted">Sent {when(open.publishedAt)} by {open.sentBy} to {to(open)}.</p>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{open.body}</div>
            {open.withdrawnAt ? <p className="small" style={{ color: 'var(--red-ink)' }}>Withdrawn by {open.withdrawnBy} on {when(open.withdrawnAt)}.</p>
              : <p className="small"><strong>{open.readBy}</strong> of <strong>{open.recipients}</strong> people have opened it.</p>}
            {!open.withdrawnAt && can('notices.publish') ? (
              <div><button className="btn btn-danger" onClick={async () => {
                if (!confirm('Withdraw this notice? It will disappear from everyone’s app. The record is kept here.')) return;
                await api.post(`/notices/${open.id}/withdraw`); setOpen(null); await load(); toast.show('Notice withdrawn');
              }}>Withdraw notice</button></div>
            ) : null}
          </div>
        ) : null}
      </Panel>
      {toast.node}
    </>
  );
}

function Compose({ structure, onSent }: { structure: Structure; onSent: (m: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('parents');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const send = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api.post<{ recipients: number }>('/notices', { title, body, audience, classIds, sectionIds });
      await onSent(`Notice sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}`);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not send'); }
    finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={send}>
      <Field label="Title" htmlFor="nt" hint="Short, like a headline: “School closed on Monday”">
        <input id="nt" className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Notice" htmlFor="nb">
        <textarea id="nb" className="input" rows={7} required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label="Send to" htmlFor="na">
        <select id="na" className="input" value={audience} onChange={(e) => setAudience(e.target.value)}>
          {Object.entries(AUDIENCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {audience === 'classes' ? (
        <div className="checks">{structure.classes.map((c) => (
          <label key={c.id} className="check"><input type="checkbox" checked={classIds.includes(c.id)} onChange={() => setClassIds(toggle(classIds, c.id))} />{classLabel(c.name)}</label>
        ))}</div>
      ) : null}
      {audience === 'sections' ? (
        <div className="checks">{structure.classes.flatMap((c) => c.sections.map((s) => (
          <label key={s.id} className="check"><input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => setSectionIds(toggle(sectionIds, s.id))} />{sectionLabel(c.name, s.name)}</label>
        )))}</div>
      ) : null}
      <p className="small muted">It goes out as an app notification right away. SMS is not used for notices.</p>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy || title.trim().length < 3 || body.trim().length < 3}>Send notice</button></div>
    </form>
  );
}
