import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { CollectionSummary, Snippet } from '../src/shared/api.ts';
import { createApp } from '../src/server/app.ts';
import { loadConfig, type Config } from '../src/server/config.ts';
import { openDb } from '../src/server/db.ts';
import { signToken } from '../src/server/middleware/auth.ts';
import type { RateLimits } from '../src/server/middleware/security.ts';
import { createUsersRepo } from '../src/server/repos/users.ts';
import request from 'supertest';

export const PASSWORD = 'password123';
export const CLIENT_DIR = path.resolve(import.meta.dirname, 'fixtures/client');

// Hashing once keeps per-test setup fast.
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export interface MakeAppOptions {
  limits?: RateLimits;
  env?: Record<string, string>;
}

export function makeApp(opts: MakeAppOptions = {}) {
  const config: Config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    BCRYPT_ROUNDS: '4',
    DB_FILE: ':memory:',
    ...opts.env,
  });
  const db = openDb(':memory:');
  const users = createUsersRepo(db);
  const seeded = {
    alice: users.create('alice@example.com', passwordHash),
    bob: users.create('bob@example.com', passwordHash),
  };
  // Generous by default so tests that make many requests don't trip the limiter.
  const app = createApp({ db, config, clientDir: CLIENT_DIR, limits: { api: 10_000, writes: 10_000, ...opts.limits } });

  function tokenFor(email: string): string {
    const user = users.findByEmail(email);
    if (!user) throw new Error(`No such user: ${email}`);
    return signToken(config, user.id);
  }

  return { app, db, config, users, seeded, tokenFor };
}

export type TestApp = ReturnType<typeof makeApp>;

export function auth(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

export async function createSnippet(
  t: TestApp,
  email: string,
  body: Record<string, unknown> = { title: 'Hello', html: '<p>hi</p>', css: 'p{}', js: '1;' },
): Promise<Snippet> {
  const res = await request(t.app)
    .post('/api/snippets')
    .set(...auth(t.tokenFor(email)))
    .send(body)
    .expect(201);
  return res.body as Snippet;
}

export async function createCollection(
  t: TestApp,
  email: string,
  body: Record<string, unknown> = { title: 'My collection' },
): Promise<CollectionSummary> {
  const res = await request(t.app)
    .post('/api/collections')
    .set(...auth(t.tokenFor(email)))
    .send(body)
    .expect(201);
  return res.body as CollectionSummary;
}

export async function addToCollection(t: TestApp, email: string, collectionId: string, snippetId: string) {
  await request(t.app)
    .put(`/api/collections/${collectionId}/snippets/${snippetId}`)
    .set(...auth(t.tokenFor(email)))
    .expect(204);
}
