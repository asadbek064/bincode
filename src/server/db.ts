import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

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

// Each entry upgrades the schema by one version; PRAGMA user_version records how many have run.
// Append only — never edit a migration that has shipped.
const MIGRATIONS: string[] = [
  // 1: private bins and collections
  `
  ALTER TABLE snippets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'unlisted'
    CHECK (visibility IN ('unlisted', 'private'));

  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    share_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    password_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX collections_user_updated ON collections (user_id, updated_at DESC);

  CREATE TABLE collection_snippets (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    snippet_id TEXT NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, snippet_id)
  );

  CREATE INDEX collection_snippets_snippet ON collection_snippets (snippet_id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      // PRAGMA does not accept bound parameters; v is a loop integer.
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  // SQLite leaves foreign keys off per connection unless asked.
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
  }
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
