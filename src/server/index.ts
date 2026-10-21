import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';

if (fs.existsSync('.env')) process.loadEnvFile();

const config = loadConfig();
const db = openDb(config.DB_FILE);
const app = createApp({ db, config, clientDir: path.resolve('dist/client') });

const server = app.listen(config.PORT, (err?: Error) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`BinCode listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Keep-alive connections can hold close() open indefinitely.
  server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
