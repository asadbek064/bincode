import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { UNLOCK_TOKEN_HEADER } from '../src/shared/constants.ts';
import { auth, createCollection, createSnippet, makeApp, type TestApp } from './helpers.ts';

const PW = 'bin-password';

test('API responses are never cacheable', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com', { title: 'x', settings: { visibility: 'password', password: PW } });
  const { token } = (await request(t.app).post(`/api/snippets/${s.shareId}/unlock`).send({ password: PW })).body;
  for (const res of [
    await request(t.app).get(`/api/snippets/${s.shareId}`).set(UNLOCK_TOKEN_HEADER, token),
    await request(t.app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'password123' }),
    await request(t.app).get('/api/nope'),
  ]) {
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('the preview page is sandboxed by its own CSP, not only by the iframe attribute', async () => {
  const t = makeApp();
  const res = await request(t.app).get('/preview.html').expect(200);
  assert.match(res.headers['content-security-policy']!, /sandbox allow-scripts allow-modals allow-forms allow-popups/);
  assert.doesNotMatch(res.headers['content-security-policy']!, /allow-same-origin/);
});

test('only snippet content may be large; other bodies are capped at 16kb', async () => {
  const t = makeApp();
  const pad = 'x'.repeat(20 * 1024);
  await request(t.app).post('/api/auth/login').send({ email: 'a@example.com', password: 'p', pad }).expect(413);
  const s = await createSnippet(t, 'alice@example.com');
  await request(t.app).post(`/api/snippets/${s.shareId}/unlock`).send({ password: pad }).expect(413);
  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).send({ pad }).expect(413);
  // Content routes still take big (valid) snippets.
  const big = { title: 'big', html: 'a'.repeat(400_000) };
  const alice = auth(t.tokenFor('alice@example.com'));
  await request(t.app).post('/api/snippets').set(...alice).send(big).expect(201);
  await request(t.app).put(`/api/snippets/${s.shareId}`).set(...alice).send(big).expect(200);
  await request(t.app).post(`/api/snippets/${s.shareId}/fork`).set(...alice).send(big).expect(201);
});

test('per-account quotas cap bins, storage and collections', async () => {
  const t = makeApp({ quotas: { binsPerUser: 2, storagePerUser: 100, collectionsPerUser: 1 } });
  const alice = auth(t.tokenFor('alice@example.com'));
  const a = await createSnippet(t, 'alice@example.com', { title: 'a', html: 'x'.repeat(40) });
  await createSnippet(t, 'alice@example.com', { title: 'b', html: 'x'.repeat(40) });

  const third = await request(t.app).post('/api/snippets').set(...alice).send({ title: 'c' }).expect(403);
  assert.match(third.body.error, /limit of 2 bins/);
  await request(t.app).post(`/api/snippets/${a.shareId}/fork`).set(...alice).send({}).expect(403);
  // Growing a bin past the storage cap is refused; shrinking or same-size edits are fine.
  await request(t.app).put(`/api/snippets/${a.shareId}`).set(...alice).send({ title: 'a', html: 'x'.repeat(61) }).expect(403);
  await request(t.app).put(`/api/snippets/${a.shareId}`).set(...alice).send({ title: 'a', html: 'x'.repeat(60) }).expect(200);
  // Quotas are per account.
  await createSnippet(t, 'bob@example.com');

  await createCollection(t, 'alice@example.com');
  await request(t.app).post('/api/collections').set(...alice).send({ title: 'two' }).expect(403);
});

test('access matrix: who can read each kind of bin', async () => {
  const t = makeApp();
  const make = (settings: Record<string, unknown>) => createSnippet(t, 'alice@example.com', { title: 'x', html: 'CODE', settings });
  const bins = {
    unlisted: await make({}),
    password: await make({ visibility: 'password', password: PW }),
    private: await make({ visibility: 'private' }),
    burn: await make({ burnAfterRead: true }),
  };
  const viewers: Record<string, [string, string][]> = {
    anonymous: [],
    'other user': [['Authorization', `Bearer ${t.tokenFor('bob@example.com')}`]],
    owner: [['Authorization', `Bearer ${t.tokenFor('alice@example.com')}`]],
  };
  const expected: Record<string, Record<string, 'code' | 'locked' | 404>> = {
    anonymous: { unlisted: 'code', password: 'locked', private: 404, burn: 'locked' },
    'other user': { unlisted: 'code', password: 'locked', private: 404, burn: 'locked' },
    owner: { unlisted: 'code', password: 'code', private: 'code', burn: 'code' },
  };
  for (const [viewer, headers] of Object.entries(viewers)) {
    for (const [kind, bin] of Object.entries(bins)) {
      let req = request(t.app).get(`/api/snippets/${bin.shareId}`);
      for (const [k, v] of headers) req = req.set(k, v);
      const res = await req;
      const got = res.status === 404 ? 404 : res.body.locked ? 'locked' : 'code';
      assert.equal(got, expected[viewer]![kind], `${viewer} reading ${kind}`);
      if (got !== 'code') assert.doesNotMatch(JSON.stringify(res.body), /CODE/, `${viewer} must not get ${kind} code`);
    }
  }
});

test('forged, foreign and malformed tokens are rejected', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com', { title: 'x', settings: { visibility: 'private' } });
  const aliceId = t.seeded.alice.id;
  const forged = [
    jwt.sign({}, 'wrong-secret-wrong-secret-wrong-secret', { subject: aliceId }),
    jwt.sign({}, t.config.JWT_SECRET, { subject: aliceId, algorithm: 'HS512' }),
    jwt.sign({}, t.config.JWT_SECRET, { subject: aliceId, expiresIn: -10 }),
    jwt.sign({}, t.config.JWT_SECRET, { subject: aliceId, audience: 'bincode:snippet' }),
    `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(`{"sub":"${aliceId}"}`).toString('base64url')}.`,
    'not-a-jwt',
  ];
  for (const token of forged) {
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
    // optionalAuth falls back to anonymous, which can't see the private bin.
    await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(token)).expect(404);
  }
});

test('mutations of another user’s bins and collections are refused', async () => {
  const t: TestApp = makeApp();
  const s = await createSnippet(t, 'alice@example.com');
  const c = await createCollection(t, 'alice@example.com', { title: 'c', password: 'collection-pw' });
  const bob = auth(t.tokenFor('bob@example.com'));
  await request(t.app).put(`/api/snippets/${s.shareId}`).set(...bob).send({ title: 'x' }).expect(403);
  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...bob).send({ visibility: 'private' }).expect(403);
  await request(t.app).delete(`/api/snippets/${s.shareId}`).set(...bob).expect(403);
  await request(t.app).put(`/api/collections/${c.shareId}`).set(...bob).send({ title: 'x' }).expect(403);
  await request(t.app).delete(`/api/collections/${c.shareId}`).set(...bob).expect(403);
  await request(t.app).put(`/api/collections/${c.shareId}/snippets/${s.shareId}`).set(...bob).expect(403);
  // Nothing changed.
  const own = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  assert.equal(own.body.title, s.title);
  assert.equal(own.body.visibility, 'unlisted');
});

test('mass assignment: unknown fields are ignored', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const res = await request(t.app)
    .post('/api/snippets')
    .set(...alice)
    .send({ title: 'x', userId: t.seeded.bob.id, user_id: t.seeded.bob.id, shareId: 'AAAAAAAAAA', isOwner: false, __proto__: { admin: true } })
    .expect(201);
  assert.notEqual(res.body.shareId, 'AAAAAAAAAA');
  assert.equal(res.body.isOwner, true);
  const bobList = await request(t.app).get('/api/snippets').set(...auth(t.tokenFor('bob@example.com'))).expect(200);
  assert.equal(bobList.body.snippets.length, 0);
});
