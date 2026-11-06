// Usage:
//   pnpm --filter @aiedu/api create-school -- --code DEMO --name "Demo Public School" \
//        --owner-name "Zahid" --owner-phone 9876543210 --year 2027-28
import { parseArgs } from 'node:util';
import pg from 'pg';
import { normalizeIndianPhone } from '@aiedu/shared';
import { createSchool } from '../platform/create-school.js';

const { values } = parseArgs({
  options: {
    code: { type: 'string' },
    name: { type: 'string' },
    'owner-name': { type: 'string' },
    'owner-phone': { type: 'string' },
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
await client.end();
console.log('School created:', result);
console.log(`The owner can now open the app and log in with ${phone} (an OTP will be sent).`);
