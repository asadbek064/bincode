import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SCHEMA_VERSION, openDb } from '../src/server/db.ts';

// The schema as shipped before migrations existed (user_version 0).
const V0 = `
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE snippets (
  id TEXT PRIMARY KEY, share_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, html TEXT NOT NULL DEFAULT '', css TEXT NOT NULL DEFAULT '', js TEXT NOT NULL DEFAULT '',
  forked_from TEXT REFERENCES snippets(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX snippets_user_updated ON snippets (user_id, updated_at DESC);
`;

test('an existing v0 database is migrated in place', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bincode-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'old.db');

  const old = new DatabaseSync(file);
  old.exec(V0);
  old.prepare("INSERT INTO users VALUES ('u1', 'a@example.com', 'hash', '2024-01-01T00:00:00.000Z')").run();
  old.prepare("INSERT INTO snippets VALUES ('s1', 'AAAAAAAAAA', 'u1', 'Old', '<p>', '', '', NULL, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')").run();
  old.close();

  const db = openDb(file);
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
  const row = db.prepare('SELECT title, html, visibility FROM snippets WHERE id = ?').get('s1') as Record<string, string>;
  assert.deepEqual({ ...row }, { title: 'Old', html: '<p>', visibility: 'unlisted' });
  db.prepare('SELECT COUNT(*) AS n FROM collections').get();
  db.close();

  // Reopening is a no-op.
  const again = openDb(file);
  assert.equal((again.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
  again.close();
});

test('the visibility column rejects unknown values', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users VALUES ('u1', 'a@example.com', 'hash', 'now')").run();
  assert.throws(() =>
    db.prepare("INSERT INTO snippets (id, share_id, user_id, title, visibility, created_at, updated_at) VALUES ('s', 'BBBBBBBBBB', 'u1', 't', 'public', 'n', 'n')").run(),
  );
});
