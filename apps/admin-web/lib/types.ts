import type { Permission, Role } from '@aiedu/shared';

export interface SchoolInfo {
  school: {
    id: string; code: string; name: string; board: string;
    address: string | null; phone: string | null; email: string | null;
    logo_url: string | null; website_domain: string | null;
    attendance_mode: 'daily' | 'period'; periods_per_day: number;
    online_payments_enabled: boolean; receipt_prefix: string;
    brand_color: string | null; short_name: string | null; affiliation_no: string | null;
  };
  me: { roles: Role[]; permissions: Permission[] };
}

export interface Me {
  account: { id: string; name: string; phone: string };
  schools: { id: string; name: string; logo_url: string | null; roles: Role[] }[];
}

export interface Section {
  id: string; name: string; classTeacherId: string | null; classTeacherName: string | null; students: number;
}
export interface ClassRow {
  id: string; name: string; sort_order: number;
  assessment_style: 'grades_only' | 'marks_and_grades';
  sections: Section[]; subject_ids: string[];
}
export interface Subject { id: string; name: string; code: string | null }
export interface Structure { year: { id: string; name: string }; classes: ClassRow[]; subjects: Subject[] }

export interface StaffMember {
  membershipId: string; accountId: string; name: string; designation: string | null;
  employeeCode: string | null; status: 'active' | 'inactive'; phone: string;
  hasLoggedIn: boolean; roles: Role[];
}

export interface StudentRow {
  id: string; admissionNo: string; firstName: string; lastName: string | null;
  gender: string | null; dateOfBirth: string | null; status: string;
  className: string | null; sectionName: string | null; sectionId: string | null; rollNo: number | null;
  familyPhone: string; fatherName: string | null; motherName: string | null;
}

export const classLabel = (name: string) => (/^\d+$/.test(name) ? `Class ${name}` : name);
export const showPhone = (p: string) => p.replace(/^\+91(\d{5})(\d{5})$/, '$1 $2');
