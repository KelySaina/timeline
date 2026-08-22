import { env } from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { initStorage } from './modules/photos/storage/index.js';
import { closeStreams, startRealtime, stopRealtime } from './modules/realtime/bus.js';
import { startReminders, stopReminders } from './modules/push/reminders.js';

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
await startRealtime();
// A no-op unless this deploy has a VAPID pair, so an install without push boots exactly as before.
startReminders();

const server = app.listen(env.PORT, () => {
  console.log(`[boot] timeline api listening on :${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // server.close() waits for open connections, and an SSE stream never ends by itself — so the
    // streams are ended first, otherwise shutdown blocks until the orchestrator loses patience.
    closeStreams();
    stopReminders();
    server.close(() => {
      void stopRealtime()
        .then(() => pool.end())
        .then(() => process.exit(0));
    });
  });
}
