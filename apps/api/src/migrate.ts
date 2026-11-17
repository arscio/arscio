// Applies database changes (files in /db/migrations) in order, once each.
// Runs with the OWNER connection, never the app connection.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/migrations',
);

export async function migrate(ownerUrl: string, appPassword: string, log = console.log) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // The locked-down user the running app logs in as.
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'arscio_app'");
    if (role.rowCount === 0) {
      await client.query(
        `CREATE ROLE arscio_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${client.escapeLiteral(appPassword)}`,
      );
      log('Created database user arscio_app');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    log('Database is up to date.');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const owner = process.env.DATABASE_OWNER_URL;
  const appPw = process.env.APP_DB_PASSWORD;
  if (!owner || !appPw) {
    console.error('Set DATABASE_OWNER_URL and APP_DB_PASSWORD in apps/api/.env');
    process.exit(1);
  }
  migrate(owner, appPw).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
