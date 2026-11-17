// Usage:
//   pnpm --filter @arscio/api create-school -- --code DEMO --name "Demo Public School" \
//        --owner-name "Zahid" --owner-phone 9876543210 --year 2027-28 \
//        [--owner-email owner@school.in]
// With LOGIN_MODE=password, the owner gets a one-time password printed here
// (shown once; they must change it after logging in).
import { parseArgs } from 'node:util';
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../auth/passwords.js';
import { normalizeIndianPhone } from '@arscio/shared';
import { createSchool } from '../platform/create-school.js';

const { values } = parseArgs({
  options: {
    code: { type: 'string' },
    name: { type: 'string' },
    'owner-name': { type: 'string' },
    'owner-phone': { type: 'string' },
    'owner-email': { type: 'string' },
    year: { type: 'string', default: '2027-28' },
    prefix: { type: 'string', default: 'RC' },
  },
});

const phone = normalizeIndianPhone(values['owner-phone'] ?? '');
if (!values.code || !values.name || !values['owner-name'] || !phone) {
  console.error('Need --code, --name, --owner-name and a valid --owner-phone');
  process.exit(1);
}
const [startYear] = values.year!.split('-');
const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
await client.connect();
const result = await createSchool(client, {
  code: values.code,
  name: values.name,
  ownerName: values['owner-name']!,
  ownerPhone: phone,
  receiptPrefix: values.prefix,
  academicYear: { name: values.year!, startsOn: `${startYear}-04-01`, endsOn: `${Number(startYear) + 1}-03-31` },
});
const email = values['owner-email']?.trim().toLowerCase();
if (email) await client.query('UPDATE accounts SET email = $2 WHERE phone = $1', [phone, email]);
if (process.env.LOGIN_MODE === 'password') {
  // Easy to read out over the phone: no 0/O or 1/l look-alikes.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const temp = Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('');
  await client.query(
    `UPDATE accounts SET password_hash = $2, password_set_at = now(), must_change_password = true WHERE phone = $1`,
    [phone, await hashPassword(temp)]);
  await client.end();
  console.log('School created:', result);
  console.log(`Owner login: ${email ?? phone}  (or ${phone})`);
  console.log(`One-time password: ${temp}   <- give this to the owner privately; they must change it after logging in.`);
} else {
  await client.end();
  console.log('School created:', result);
  console.log(`The owner can now open the app and log in with ${phone} (an OTP will be sent).`);
}
