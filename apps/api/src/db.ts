// Database connection.
//
// The key idea: every piece of work runs inside a "transaction" that first
// tells the database which school and which person it is for. The database
// then only shows that school's rows (Row-Level Security). When the work
// finishes, that setting disappears automatically.
import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export interface DbContext {
  schoolId?: string | null;
  accountId?: string | null;
}

// Connection budget on the shared server (PostgreSQL allows 30): website/apps 12 + background jobs 4 +
// control panel 3 = 19, leaving room for backups and maintenance.
export function createPool(connectionString: string, max = 12): Db {
  const pool = new pg.Pool({ connectionString, max });
  // Keep money as exact strings ("1500.00"), never floating-point numbers.
  pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
  // Keep plain dates as "YYYY-MM-DD" text so timezones never shift them.
  pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
  return pool;
}

export async function withContext<T>(
  db: Db,
  ctx: DbContext,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(
      "SELECT set_config('app.school_id', $1, true), set_config('app.account_id', $2, true)",
      [ctx.schoolId ?? '', ctx.accountId ?? ''],
    );
    const result = await work(tx);
    await tx.query('COMMIT');
    return result;
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}
