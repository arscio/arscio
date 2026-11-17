// Before tests: wipe the TEST database and rebuild it from the migrations.
// Never point these settings at a real school's database.
import pg from 'pg';
import { migrate } from '../src/migrate.js';

export const TEST_OWNER_URL =
  process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://arscio_owner:dev_only_password@localhost:5432/arscio_test';
export const TEST_APP_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://arscio_app:dev_app_password@localhost:5432/arscio_test';

export default async function setup() {
  const c = new pg.Client({ connectionString: TEST_OWNER_URL });
  await c.connect();
  const db = (await c.query('SELECT current_database() AS d')).rows[0].d as string;
  if (!db.endsWith('_test')) throw new Error(`Refusing to wipe "${db}" - test database name must end in _test`);
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await migrate(TEST_OWNER_URL, 'dev_app_password', () => {});
}
