import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * Arbitrary, constant, and ours. Session-scoped advisory locks share one namespace per database, so
 * the only requirement is that nothing else picks the same number.
 */
const MIGRATION_LOCK = 8274193004115;

export async function migrate(): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    /*
     * One migrator at a time. The API is meant to run as more than one replica and they boot
     * together, and the test suite runs each file in its own process against one database — so
     * without this two of them read the same "not applied yet", both run the file, and the loser
     * fails on `column already exists` instead of seeing it as already done. Taken before the
     * bookkeeping table is even created, because that races too.
     */
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string }>('select name from schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
        console.log(`[migrate] applied ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    if (applied.length === 0) console.log('[migrate] already up to date');
    return applied;
  } finally {
    // Released explicitly rather than left to the connection closing: this client goes back to the
    // pool, and a session-scoped lock would ride along with it.
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
