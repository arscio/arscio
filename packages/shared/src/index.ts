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

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** Indian style: 125050.50 -> "Rupees One Lakh Twenty Five Thousand Fifty and Fifty Paise Only". */
export function rupeesInWords(amount: string | number): string {
  const [r = '0', p = '0'] = String(amount).split('.');
  let n = Number(r);
  const paise = Number(p.padEnd(2, '0').slice(0, 2));
  if (n === 0 && paise === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000); n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000); n %= 1_00_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  const rupees = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  return `${rupees}${paise ? ` and ${twoDigits(paise)} Paise` : ''} Only`;
}

/** Indian digit grouping: 125050.5 -> "1,25,050.50" */
export function formatINR(amount: string | number): string {
  const [r = '0', p = '00'] = Number(amount).toFixed(2).split('.');
  const last3 = r.slice(-3), rest = r.slice(0, -3);
  return `${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : ''}${last3}.${p}`;
}
