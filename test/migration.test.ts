import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { openDb } from '../src/server/db.ts';
import { auth, CLIENT_DIR } from './helpers.ts';

// Exactly what the original JavaScript server (db/connect.js) created.
const LEGACY_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT);
CREATE TABLE snippets (
  id TEXT PRIMARY KEY, user_id TEXT, title TEXT, html TEXT, css TEXT, js TEXT,
  share_id TEXT UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);`;

function legacyDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bincode-legacy-'));
  const file = path.join(dir, 'bincode.db');
  const db = new DatabaseSync(file);
  db.exec(LEGACY_SCHEMA);
  // The old addUser.js used the native bcrypt module, which writes $2b$ hashes.
  const hash = bcrypt.hashSync('old-password', 4).replace(/^\$2a\$/, '$2b$');
  db.prepare('INSERT INTO users VALUES (?, ?, ?)').run('u1', 'Old.User@Example.com', hash);
  db.prepare('INSERT INTO snippets (id, user_id, title, html, css, js, share_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('s1', 'u1', 'My old snippet', '<p>old</p>', 'p{color:red}', 'console.log(1)', 'AbCdEf1234', '2024-05-01 12:30:00');
  db.prepare('INSERT INTO snippets (id, user_id, title, html, css, js, share_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('s2', 'u1', null, null, null, null, 'ZyXwVu9876');
  db.close();
  return { dir, file };
}

function appFor(file: string) {
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    BCRYPT_ROUNDS: '4',
    DB_FILE: file,
  });
  const db = openDb(file);
  return { db, app: createApp({ db, config, clientDir: CLIENT_DIR, limits: { api: 10_000 } }) };
}

test('legacy v1 database is migrated in place without losing data', async (t) => {
  const { dir, file } = legacyDb();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => {});

  const { db, app } = appFor(file);
  t.after(() => db.close());

  // A full backup is written before anything changes.
  const backups = fs.readdirSync(dir).filter((f) => f.endsWith('.bak'));
  assert.equal(backups.length, 1);

  // Old share links keep working, with content intact.
  const shared = await request(app).get('/api/snippets/AbCdEf1234').expect(200);
  assert.equal(shared.body.title, 'My old snippet');
  assert.equal(shared.body.html, '<p>old</p>');
  assert.equal(shared.body.css, 'p{color:red}');
  assert.equal(shared.body.js, 'console.log(1)');
  assert.equal(shared.body.createdAt, '2024-05-01T12:30:00.000Z');
  assert.equal(shared.body.updatedAt, '2024-05-01T12:30:00.000Z');

  const blank = await request(app).get('/api/snippets/ZyXwVu9876').expect(200);
  assert.equal(blank.body.title, 'Untitled');
  assert.equal(blank.body.html, '');

  // The existing password still works, and the email is matched case-insensitively.
  const login = await request(app).post('/api/auth/login').send({ email: 'old.user@example.com', password: 'old-password' }).expect(200);
  const mine = await request(app).get('/api/snippets').set(...auth(login.body.token)).expect(200);
  assert.deepEqual(mine.body.snippets.map((s: { shareId: string }) => s.shareId).sort(), ['AbCdEf1234', 'ZyXwVu9876']);

  // The owner can update a migrated snippet in place.
  await request(app).put('/api/snippets/AbCdEf1234').set(...auth(login.body.token)).send({ title: 'Updated', html: '', css: '', js: '' }).expect(200);
});

test('migration runs once; reopening a migrated database is a no-op', async (t) => {
  const { dir, file } = legacyDb();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => {});

  openDb(file).close();
  const { db, app } = appFor(file);
  t.after(() => db.close());

  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.bak')).length, 1);
  await request(app).get('/api/snippets/AbCdEf1234').expect(200);
});
