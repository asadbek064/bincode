import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  html TEXT NOT NULL DEFAULT '',
  css TEXT NOT NULL DEFAULT '',
  js TEXT NOT NULL DEFAULT '',
  forked_from TEXT REFERENCES snippets(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS snippets_user_updated ON snippets (user_id, updated_at DESC);
`;

// Converts the v1 JavaScript app's DATETIME ('YYYY-MM-DD HH:MM:SS', UTC) to the ISO strings used now.
const LEGACY_TIME = `COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// Emails are now matched lowercased; keep the original spelling only where lowercasing would collide.
const MIGRATE_LEGACY = `
CREATE TABLE IF NOT EXISTS snippets (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, html TEXT, css TEXT, js TEXT,
  share_id TEXT UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE users RENAME TO legacy_users;
ALTER TABLE snippets RENAME TO legacy_snippets;
${SCHEMA}
INSERT INTO users (id, email, password_hash, created_at)
  SELECT u.id,
         CASE WHEN (SELECT count(*) FROM legacy_users o WHERE lower(trim(o.email)) = lower(trim(u.email))) > 1
              THEN u.email ELSE lower(trim(u.email)) END,
         u.password,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM legacy_users u
  WHERE u.email IS NOT NULL AND u.password IS NOT NULL;
INSERT INTO snippets (id, share_id, user_id, title, html, css, js, forked_from, created_at, updated_at)
  SELECT id, share_id, user_id, COALESCE(NULLIF(trim(title), ''), 'Untitled'),
         COALESCE(html, ''), COALESCE(css, ''), COALESCE(js, ''), NULL, ${LEGACY_TIME}, ${LEGACY_TIME}
  FROM legacy_snippets
  WHERE share_id IS NOT NULL AND user_id IN (SELECT id FROM users);
`;

function columns(db: Db, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function count(db: Db, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Databases created by the original JavaScript server have `users.password` and no timestamps. */
function isLegacy(db: Db): boolean {
  const userCols = columns(db, 'users');
  return userCols.includes('password') && !userCols.includes('password_hash');
}

function migrateLegacy(db: Db, file: string): void {
  // A full copy first, so nothing can be lost even if rows don't fit the new constraints.
  const backup = `${file}.pre-v2-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  db.prepare('VACUUM INTO ?').run(backup);

  // Renaming tables with foreign keys on would rewrite references; this pragma is ignored inside a transaction.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(MIGRATE_LEGACY);
    const users = [count(db, 'legacy_users'), count(db, 'users')];
    const snippets = [count(db, 'legacy_snippets'), count(db, 'snippets')];
    db.exec('DROP TABLE legacy_snippets; DROP TABLE legacy_users;');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
    console.log(
      `Migrated legacy database: ${users[1]}/${users[0]} users, ${snippets[1]}/${snippets[0]} snippets. Backup: ${backup}`,
    );
    if (users[0] !== users[1] || snippets[0] !== snippets[1]) {
      console.warn('Some legacy rows were incomplete (missing email, password, share id or owner) and were skipped; they remain in the backup.');
    }
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  // SQLite leaves foreign keys off per connection unless asked.
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') {
    db.exec('PRAGMA busy_timeout = 5000');
    if (isLegacy(db)) migrateLegacy(db, file);
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
