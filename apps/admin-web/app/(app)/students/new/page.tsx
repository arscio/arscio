'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { StudentForm, emptyStudent, toPayload, type StudentValues } from '@/components/StudentForm';

export default function NewStudent() {
  const [saved, setSaved] = useState<{ id: string; name: string; siblings: number; keep: StudentValues } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [initial, setInitial] = useState(emptyStudent);

  return (
    <>
      <div className="page-head">
        <div><Link href="/students" className="small">Students</Link><h1 style={{ marginTop: 4 }}>Add student</h1></div>
      </div>
      {saved ? (
        <div className="notice row" style={{ justifyContent: 'space-between', marginBottom: 18, borderLeftColor: 'var(--board)', background: 'var(--board-wash)' }}>
          <span>
            <strong>{saved.name}</strong> was added
            {saved.siblings > 0 ? `, and joined a family that already has ${saved.siblings} ${saved.siblings === 1 ? 'child' : 'children'} here` : ''}.
          </span>
          <span className="row">
            <Link className="btn btn-plain" href={`/students/${saved.id}`}>Open</Link>
            <button className="btn btn-plain" onClick={() => {
              setInitial({ ...emptyStudent, sectionId: saved.keep.sectionId, family: saved.keep.family });
              setFormKey((k) => k + 1); setSaved(null);
            }}>Add a brother or sister</button>
          </span>
        </div>
      ) : null}
      <StudentForm key={formKey} initial={initial} editing={false} submitLabel="Add student"
        onSubmit={async (v) => {
          const r = await api.post<{ id: string; siblings: number }>('/students', toPayload(v, false));
          setSaved({ id: r.id, name: `${v.firstName} ${v.lastName}`.trim(), siblings: r.siblings, keep: v });
          setInitial({ ...emptyStudent, sectionId: v.sectionId });
          setFormKey((k) => k + 1);
          window.scrollTo({ top: 0 });
        }} />
    </>
  );
}
