// Things shared by the server, the admin website and both phone apps,
// so they always agree on role names and what each role may do.

export const ROLES = [
  'owner',
  'principal',
  'office_admin',
  'accountant',
  'teacher',
  'parent',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  principal: 'Principal',
  office_admin: 'Office Admin',
  accountant: 'Accountant',
  teacher: 'Teacher',
  parent: 'Parent',
};

export const PERMISSIONS = [
  'dashboard.view',
  'school.settings',
  'roles.assign',
  'accounts.reset_login',
  'students.view',
  'students.manage',
  'students.import',
  'attendance.take',
  'attendance.view_all',
  'homework.post',
  'marks.enter',
  'reportcards.manage',
  'fees.collect',
  'fees.cancel_receipt',
  'fees.manage_structure',
  'fees.view_reports',
  'notices.publish',
  'parent.own_children',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_STAFF: Permission[] = PERMISSIONS.filter((p) => p !== 'parent.own_children');

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL_STAFF,
  principal: ALL_STAFF,
  office_admin: [
    'students.view', 'students.manage', 'students.import',
    'attendance.view_all', 'fees.collect', 'notices.publish',
    'accounts.reset_login',
  ],
  accountant: [
    'students.view', 'fees.collect', 'fees.cancel_receipt',
    'fees.manage_structure', 'fees.view_reports',
  ],
  teacher: ['attendance.take', 'homework.post', 'marks.enter'],
  parent: ['parent.own_children'],
};

/** Everything a person can do, given all the roles they hold. */
export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}

/** Who may hand out which role. Only the owner can create owners/principals. */
export function canAssignRole(assignerRoles: readonly Role[], role: Role): boolean {
  if (assignerRoles.includes('owner')) return true;
  if (assignerRoles.includes('principal')) return role !== 'owner' && role !== 'principal';
  return false;
}

/** Indian mobile numbers, stored as +91XXXXXXXXXX. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
    : digits;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}
