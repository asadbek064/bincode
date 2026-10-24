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

interface Migration {
  sql: string;
  /**
   * Rebuilds a table (SQLite can't alter constraints in place). Foreign keys are switched off
   * around it, as the SQLite docs prescribe, and checked before committing.
   */
  rebuild?: boolean;
}

// Each entry upgrades the schema by one version; PRAGMA user_version records how many have run.
// Append only — never edit a migration that has shipped.
const MIGRATIONS: Migration[] = [
  // 1: private bins and collections
  {
    sql: `
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
  },
  // 2: password-protected bins, expiration and burn after read
  {
    rebuild: true,
    sql: `
  CREATE TABLE snippets_new (
    id TEXT PRIMARY KEY,
    share_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    html TEXT NOT NULL DEFAULT '',
    css TEXT NOT NULL DEFAULT '',
    js TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK (visibility IN ('unlisted', 'password', 'private')),
    password_hash TEXT,
    password_version INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    burn_after_read INTEGER NOT NULL DEFAULT 0 CHECK (burn_after_read IN (0, 1)),
    forked_from TEXT REFERENCES snippets(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((visibility = 'password') = (password_hash IS NOT NULL))
  );

  INSERT INTO snippets_new (id, share_id, user_id, title, html, css, js, visibility, forked_from, created_at, updated_at)
    SELECT id, share_id, user_id, title, html, css, js, visibility, forked_from, created_at, updated_at FROM snippets;

  DROP TABLE snippets;
  ALTER TABLE snippets_new RENAME TO snippets;

  CREATE INDEX snippets_user_updated ON snippets (user_id, updated_at DESC);
  CREATE INDEX snippets_expires ON snippets (expires_at) WHERE expires_at IS NOT NULL;
  `,
  },
  // 3: remember every shareId that was ever deleted, so a backup import can't take over a link that
  // belonged to someone else. Triggers also catch burn, the expiry sweep and user-deletion cascades.
  {
    sql: `
  CREATE TABLE retired_share_ids (
    share_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('snippet', 'collection'))
  );

  CREATE TRIGGER retire_snippet_share_id AFTER DELETE ON snippets BEGIN
    INSERT OR IGNORE INTO retired_share_ids (share_id, user_id, kind) VALUES (OLD.share_id, OLD.user_id, 'snippet');
  END;

  CREATE TRIGGER retire_collection_share_id AFTER DELETE ON collections BEGIN
    INSERT OR IGNORE INTO retired_share_ids (share_id, user_id, kind) VALUES (OLD.share_id, OLD.user_id, 'collection');
  END;
  `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    const { sql, rebuild } = MIGRATIONS[v]!;
    // This pragma is a no-op inside a transaction, so it has to be set before BEGIN.
    if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      if (rebuild && db.prepare('PRAGMA foreign_key_check').all().length > 0) {
        throw new Error(`Migration ${v + 1} left foreign key violations`);
      }
      // PRAGMA does not accept bound parameters; v is a loop integer.
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (rebuild) db.exec('PRAGMA foreign_keys = ON');
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
