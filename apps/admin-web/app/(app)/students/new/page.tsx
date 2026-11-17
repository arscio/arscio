'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { StudentForm, emptyStudent, toPayload, type StudentValues } from '@/components/StudentForm';

type OverSeats = { label: string; students: number; seats: number };

export default function NewStudent() {
  const [saved, setSaved] = useState<{ id: string; name: string; admissionNo: string; photoFailed: boolean; siblings: number; keep: StudentValues; overSeats: OverSeats | null } | null>(null);
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
            <strong>{saved.name}</strong> was added with admission number <strong className="num">{saved.admissionNo}</strong>
            {saved.siblings > 0 ? `, and joined a family that already has ${saved.siblings} ${saved.siblings === 1 ? 'child' : 'children'} here` : ''}.
            {saved.photoFailed ? ' The photo could not be saved; add it from the student file.' : ''}
            {saved.overSeats ? <><br />{saved.overSeats.label} now has {saved.overSeats.students} students for {saved.overSeats.seats} seats. The principal will be asked whether to make another section.</> : null}
          </span>
          <span className="row">
            <Link className="btn btn-plain" href={`/students/${saved.id}/file`}>Add documents</Link>
            <button className="btn btn-plain" onClick={() => {
              setInitial({ ...emptyStudent, sectionId: saved.keep.sectionId, family: saved.keep.family });
              setFormKey((k) => k + 1); setSaved(null);
            }}>Add a brother or sister</button>
          </span>
        </div>
      ) : null}
      <StudentForm key={formKey} initial={initial} editing={false} submitLabel="Add student"
        onSubmit={async (v) => {
          const r = await api.post<{ id: string; admissionNo: string; siblings: number; overSeats: OverSeats | null }>('/students', toPayload(v, false));
          let photoFailed = false;
          if (v.photo) await api.put(`/students/${r.id}/photo`, { dataUrl: v.photo }).catch(() => { photoFailed = true; });
          setSaved({ id: r.id, name: `${v.firstName} ${v.lastName}`.trim(), admissionNo: r.admissionNo, photoFailed, siblings: r.siblings, keep: v, overSeats: r.overSeats ?? null });
          setInitial({ ...emptyStudent, sectionId: v.sectionId });
          setFormKey((k) => k + 1);
          window.scrollTo({ top: 0 });
        }} />
    </>
  );
}
