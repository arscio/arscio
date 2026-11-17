// Wipes the LOCAL database and rebuilds it empty (all tables, no data). For demos and testing only.
// Refuses to run against anything that isn't on this computer.
import pg from 'pg';
import { migrate } from '../migrate.js';

const url = process.env.DATABASE_OWNER_URL ?? '';
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to wipe a database on ${host}. This only works on your own computer.`);
  process.exit(1);
}
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query('DROP SCHEMA public CASCADE');
await db.query('CREATE SCHEMA public');
await db.end();
console.log('Local database wiped.');
await migrate(url, process.env.APP_DB_PASSWORD ?? '', () => undefined);
console.log('Database rebuilt with all tables.');
