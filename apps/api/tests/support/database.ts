/**
 * Make sure the database the tests are pointed at exists.
 *
 * `TEST_DATABASE_URL` names a database of its own so the suite does not share state with whatever
 * else is running — in particular a dev API container, which listens on the same Postgres change
 * channel and will act on changes a test publishes. That is the design working across replicas, but
 * it makes "did *this* process send the notification" a race, and it is invisible in CI where the
 * database is already dedicated.
 *
 * Created here rather than in a shell step so that `npm test` works with nothing else run first.
 */
import pg from 'pg';

/** Postgres has no CREATE DATABASE IF NOT EXISTS; 42P04 is "already exists". */
const ALREADY_EXISTS = '42P04';

export async function ensureDatabase(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  // Nothing to do: without this set the suite uses DATABASE_URL, which is how CI runs.
  if (!url) return;

  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!name) throw new Error(`TEST_DATABASE_URL has no database name: ${url}`);

  // Connected to 'postgres' rather than the target, which is the thing that may not exist yet.
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });

  try {
    await client.connect();
    // The name comes from our own .env, never from a request — and it is quoted regardless.
    await client.query(`create database "${name.replace(/"/g, '""')}"`);
    console.log(`[test] created database ${name}`);
  } catch (error) {
    if ((error as { code?: string }).code !== ALREADY_EXISTS) {
      throw new Error(
        `Cannot prepare the test database (${name}): ${(error as Error).message}\n` +
          'Start the dev stack first:  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db',
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
