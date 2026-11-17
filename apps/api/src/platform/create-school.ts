// Adds a brand-new school to the platform. Only WE (the platform) do this,
// using the owner database connection - schools can't create schools.
//
// It sets up: the school, the current academic year, Nursery-LKG-UKG
// (grades + comments) and Classes 1-10 (marks + grades), the CBSE grade
// scale, and the school owner's login (who then logs in with an OTP).
import type pg from 'pg';

export interface NewSchool {
  code: string;
  name: string;
  ownerName: string;
  ownerPhone: string;            // +91XXXXXXXXXX
  academicYear: { name: string; startsOn: string; endsOn: string };
  receiptPrefix?: string;
}

export const DEFAULT_CLASSES: { name: string; style: 'grades_only' | 'marks_and_grades' }[] = [
  { name: 'Nursery', style: 'grades_only' },
  { name: 'LKG', style: 'grades_only' },
  { name: 'UKG', style: 'grades_only' },
  ...Array.from({ length: 10 }, (_, i) => ({ name: String(i + 1), style: 'marks_and_grades' as const })),
];

export const DEFAULT_DOCUMENT_TYPES: { name: string; category: string; required?: 'all' | 'class2up'; asksForClass?: boolean; system?: boolean }[] = [
  { name: 'Birth certificate', category: 'admission', required: 'all' },
  { name: "Parent's ID proof", category: 'admission', required: 'all' },
  { name: 'Previous school TC', category: 'admission', required: 'class2up' },
  { name: 'Previous school marksheet', category: 'admission', required: 'class2up', asksForClass: true },
  { name: 'Aadhaar card', category: 'admission' },
  { name: 'Caste / category certificate', category: 'admission' },
  { name: 'Medical / disability certificate', category: 'admission' },
  { name: 'Address proof', category: 'admission' },
  { name: 'Report card', category: 'report_card', asksForClass: true, system: true },
  { name: 'Transfer certificate (issued)', category: 'certificate', system: true },
  { name: 'Bonafide certificate (issued)', category: 'certificate', system: true },
  { name: 'Character certificate (issued)', category: 'certificate', system: true },
  { name: 'Other document', category: 'other' },
];

// CBSE 8-point scale (adjustable later by the school admin)
export const CBSE_SCALE = [
  { min: 91, max: 100, grade: 'A1', point: 10 },
  { min: 81, max: 90.99, grade: 'A2', point: 9 },
  { min: 71, max: 80.99, grade: 'B1', point: 8 },
  { min: 61, max: 70.99, grade: 'B2', point: 7 },
  { min: 51, max: 60.99, grade: 'C1', point: 6 },
  { min: 41, max: 50.99, grade: 'C2', point: 5 },
  { min: 33, max: 40.99, grade: 'D', point: 4 },
  { min: 0, max: 32.99, grade: 'E', point: 0 },
];

export const PRE_PRIMARY_SCALE = [
  { grade: 'A+', label: 'Outstanding' },
  { grade: 'A', label: 'Excellent' },
  { grade: 'B', label: 'Very Good' },
  { grade: 'C', label: 'Good' },
  { grade: 'D', label: 'Needs Improvement' },
];

export async function createSchool(owner: pg.ClientBase, s: NewSchool) {
  await owner.query('BEGIN');
  try {
    const school = (
      await owner.query<{ id: string }>(
        'INSERT INTO schools (code, name, receipt_prefix) VALUES ($1, $2, $3) RETURNING id',
        [s.code, s.name, s.receiptPrefix ?? 'RC'],
      )
    ).rows[0]!;
    await owner.query(
      `INSERT INTO academic_years (school_id, name, starts_on, ends_on, is_current)
       VALUES ($1, $2, $3, $4, true)`,
      [school.id, s.academicYear.name, s.academicYear.startsOn, s.academicYear.endsOn],
    );
    for (const [i, c] of DEFAULT_CLASSES.entries()) {
      await owner.query(
        'INSERT INTO classes (school_id, name, sort_order, assessment_style) VALUES ($1, $2, $3, $4)',
        [school.id, c.name, i, c.style],
      );
    }
    // Default document checklist (the principal can change it).
    const allClasses = (await owner.query<{ id: string; name: string }>('SELECT id, name FROM classes WHERE school_id = $1', [school.id])).rows;
    const class2up = allClasses.filter((c) => /^\d+$/.test(c.name) && Number(c.name) >= 2).map((c) => c.id);
    for (const [i, d] of DEFAULT_DOCUMENT_TYPES.entries()) {
      await owner.query(
        `INSERT INTO document_types (school_id, name, category, required_classes, asks_for_class, system, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [school.id, d.name, d.category, d.required === 'all' ? allClasses.map((c) => c.id) : d.required === 'class2up' ? class2up : [],
         d.asksForClass ?? false, d.system ?? false, i + 1]);
    }
    await owner.query('INSERT INTO grading_scales (school_id, name, bands) VALUES ($1, $2, $3), ($1, $4, $5)', [
      school.id, 'CBSE 8-point', JSON.stringify(CBSE_SCALE), 'Pre-primary', JSON.stringify(PRE_PRIMARY_SCALE),
    ]);
    const account = (
      await owner.query<{ id: string }>(
        `INSERT INTO accounts (phone, name) VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET name = accounts.name RETURNING id`,
        [s.ownerPhone, s.ownerName],
      )
    ).rows[0]!;
    const membership = (
      await owner.query<{ id: string }>(
        `INSERT INTO memberships (school_id, account_id, display_name, designation)
         VALUES ($1, $2, $3, 'Owner') RETURNING id`,
        [school.id, account.id, s.ownerName],
      )
    ).rows[0]!;
    await owner.query(
      "INSERT INTO membership_roles (school_id, membership_id, role) VALUES ($1, $2, 'owner')",
      [school.id, membership.id],
    );
    await owner.query('COMMIT');
    return { schoolId: school.id, ownerAccountId: account.id, ownerMembershipId: membership.id };
  } catch (e) {
    await owner.query('ROLLBACK');
    throw e;
  }
}
