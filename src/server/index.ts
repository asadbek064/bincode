import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createSnippetsRepo } from './repos/snippets.ts';

if (fs.existsSync('.env')) process.loadEnvFile();

const config = loadConfig();
const db = openDb(config.DB_FILE);
const app = createApp({ db, config, clientDir: path.resolve('dist/client') });

// Expired bins are already invisible to every query; this only reclaims their space.
const snippets = createSnippetsRepo(db);
const sweep = () => {
  const removed = snippets.sweepExpired();
  if (removed > 0) console.log(`Removed ${removed} expired snippet(s)`);
};
sweep();
const sweepTimer = setInterval(sweep, 60 * 60_000);
sweepTimer.unref();

const server = app.listen(config.PORT, (err?: Error) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`BinCode listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

function shutdown() {
  clearInterval(sweepTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Keep-alive connections can hold close() open indefinitely.
  server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
