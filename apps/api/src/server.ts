import { env } from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { initStorage } from './modules/photos/storage/index.js';

const app = createApp();

async function waitForDatabase(attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (i === attempts) throw error;
      console.log(`[boot] database not ready (${i}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

await waitForDatabase();
await migrate();
await initStorage();

const server = app.listen(env.PORT, () => {
  console.log(`[boot] timeline api listening on :${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
