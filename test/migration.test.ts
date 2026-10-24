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

test('a v1 database with collections and forks survives the snippets rebuild', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bincode-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'v1.db');

  const old = new DatabaseSync(file);
  old.exec(V0);
  old.exec(`
    ALTER TABLE snippets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK (visibility IN ('unlisted', 'private'));
    CREATE TABLE collections (id TEXT PRIMARY KEY, share_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', password_hash TEXT, password_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE collection_snippets (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      snippet_id TEXT NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL, PRIMARY KEY (collection_id, snippet_id));
    PRAGMA user_version = 1;
    INSERT INTO users VALUES ('u1', 'a@example.com', 'hash', 'now');
    INSERT INTO snippets (id, share_id, user_id, title, visibility, created_at, updated_at)
      VALUES ('s1', 'AAAAAAAAAA', 'u1', 'Source', 'private', 'n', 'n');
    INSERT INTO snippets (id, share_id, user_id, title, forked_from, created_at, updated_at)
      VALUES ('s2', 'BBBBBBBBBB', 'u1', 'Fork', 's1', 'n', 'n');
    INSERT INTO collections (id, share_id, user_id, title, created_at, updated_at) VALUES ('c1', 'CCCCCCCCCC', 'u1', 'C', 'n', 'n');
    INSERT INTO collection_snippets VALUES ('c1', 's1', 'n');
  `);
  old.close();

  const db = openDb(file);
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
  const rows = db.prepare('SELECT id, visibility, forked_from, burn_after_read, expires_at FROM snippets ORDER BY id').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { id: 's1', visibility: 'private', forked_from: null, burn_after_read: 0, expires_at: null },
    { id: 's2', visibility: 'unlisted', forked_from: 's1', burn_after_read: 0, expires_at: null },
  ]);

  // Foreign keys still point at the rebuilt table.
  db.prepare("DELETE FROM snippets WHERE id = 's1'").run();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM collection_snippets').get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT forked_from FROM snippets WHERE id = 's2'").get() as { forked_from: null }).forked_from, null);

  // A password bin must have a hash, and only a password bin may have one.
  assert.throws(() => db.prepare("UPDATE snippets SET visibility = 'password' WHERE id = 's2'").run());
  assert.throws(() => db.prepare("UPDATE snippets SET password_hash = 'h' WHERE id = 's2'").run());
  db.close();
});

test('migration 3 adds retired share ids with delete triggers', () => {
  const db = openDb(':memory:');
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  for (const n of ['retired_share_ids', 'retire_snippet_share_id', 'retire_collection_share_id']) assert.ok(names.includes(n), n);
  db.close();
});
