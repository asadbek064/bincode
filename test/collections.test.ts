import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { UNLOCK_TOKEN_HEADER } from '../src/shared/constants.ts';
import { addToCollection, auth, createCollection, createSnippet, makeApp, type TestApp } from './helpers.ts';

const PW = 'collection-pw';
const PRIVATE = { title: 'Secret', html: '<p>secret</p>', css: '', js: '', settings: { visibility: 'private' } };

async function unlock(t: TestApp, shareId: string, password = PW): Promise<string> {
  const res = await request(t.app).post(`/api/collections/${shareId}/unlock`).send({ password }).expect(200);
  assert.equal(typeof res.body.token, 'string');
  assert.ok(Date.parse(res.body.expiresAt) > Date.now());
  return res.body.token as string;
}

test('create, list, update and delete a collection', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const c = await createCollection(t, 'alice@example.com', { title: '  Demos ', description: 'stuff' });
  assert.deepEqual(Object.keys(c).sort(), ['createdAt', 'description', 'hasPassword', 'shareId', 'snippetCount', 'title', 'updatedAt']);
  assert.equal(c.title, 'Demos');
  assert.equal(c.hasPassword, false);
  assert.equal(c.snippetCount, 0);

  const list = await request(t.app).get('/api/collections').set(...alice).expect(200);
  assert.deepEqual(list.body.collections.map((x: { shareId: string }) => x.shareId), [c.shareId]);
  const bobList = await request(t.app).get('/api/collections').set(...auth(t.tokenFor('bob@example.com'))).expect(200);
  assert.deepEqual(bobList.body.collections, []);

  const updated = await request(t.app)
    .put(`/api/collections/${c.shareId}`)
    .set(...alice)
    .send({ title: 'Renamed', password: PW })
    .expect(200);
  assert.equal(updated.body.title, 'Renamed');
  assert.equal(updated.body.description, 'stuff');
  assert.equal(updated.body.hasPassword, true);
  assert.ok(updated.body.updatedAt > c.updatedAt);

  await request(t.app).delete(`/api/collections/${c.shareId}`).set(...alice).expect(204);
  await request(t.app).get(`/api/collections/${c.shareId}`).set(...alice).expect(404);
});

test('collection passwords are validated and never returned', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  await request(t.app).post('/api/collections').set(...alice).send({ title: 'x', password: 'short' }).expect(400);
  const c = await createCollection(t, 'alice@example.com', { title: 'x', password: PW });
  const res = await request(t.app).get(`/api/collections/${c.shareId}`).set(...alice).expect(200);
  assert.doesNotMatch(JSON.stringify(res.body), /password_?hash|\$2[aby]\$/i);
});

test('owner-only collections are 404 to everyone else', async () => {
  const t = makeApp();
  const c = await createCollection(t, 'alice@example.com');
  const bob = auth(t.tokenFor('bob@example.com'));
  await request(t.app).get(`/api/collections/${c.shareId}`).expect(404);
  await request(t.app).get(`/api/collections/${c.shareId}`).set(...bob).expect(404);
  await request(t.app).put(`/api/collections/${c.shareId}`).set(...bob).send({ title: 'x' }).expect(404);
  await request(t.app).delete(`/api/collections/${c.shareId}`).set(...bob).expect(404);
  await request(t.app).post(`/api/collections/${c.shareId}/unlock`).send({ password: 'anything' }).expect(404);
  await request(t.app).get('/api/collections/not-an-id').expect(404);
});

test('non-owners get 403 when mutating a password collection, even with bad bodies', async () => {
  const t = makeApp();
  const c = await createCollection(t, 'alice@example.com', { title: 'x', password: PW });
  const bob = auth(t.tokenFor('bob@example.com'));
  await request(t.app).put(`/api/collections/${c.shareId}`).set(...bob).send({ title: 123 }).expect(403);
  await request(t.app).delete(`/api/collections/${c.shareId}`).set(...bob).expect(403);
  const s = await createSnippet(t, 'bob@example.com');
  await request(t.app).put(`/api/collections/${c.shareId}/snippets/${s.shareId}`).set(...bob).expect(403);
});

test('a locked collection reveals only its title', async () => {
  const t = makeApp();
  const c = await createCollection(t, 'alice@example.com', { title: 'Gated', description: 'hidden text', password: PW });
  const s = await createSnippet(t, 'alice@example.com', { title: 'Inside', html: '<p>x</p>' });
  await addToCollection(t, 'alice@example.com', c.shareId, s.shareId);

  for (const headers of [{}, { Authorization: `Bearer ${t.tokenFor('bob@example.com')}` }, { [UNLOCK_TOKEN_HEADER]: 'garbage' }]) {
    const res = await request(t.app).get(`/api/collections/${c.shareId}`).set(headers).expect(200);
    assert.deepEqual(res.body, { locked: true, shareId: c.shareId, title: 'Gated' });
  }
});

test('unlocking shows the list but never private bins, and grants no bin access', async () => {
  const t = makeApp();
  const c = await createCollection(t, 'alice@example.com', { title: 'Gated', password: PW });
  const open = await createSnippet(t, 'alice@example.com', { title: 'Open', html: '<p>open</p>' });
  const secret = await createSnippet(t, 'alice@example.com', PRIVATE);
  const gated = await createSnippet(t, 'alice@example.com', {
    title: 'Gated bin',
    settings: { visibility: 'password', password: 'bin-password' },
  });
  for (const s of [open, secret, gated]) await addToCollection(t, 'alice@example.com', c.shareId, s.shareId);

  await request(t.app).post(`/api/collections/${c.shareId}/unlock`).send({ password: 'wrong-password' }).expect(403);
  const token = await unlock(t, c.shareId);

  const res = await request(t.app).get(`/api/collections/${c.shareId}`).set(UNLOCK_TOKEN_HEADER, token).expect(200);
  assert.equal(res.body.locked, false);
  assert.equal(res.body.isOwner, false);
  assert.deepEqual(res.body.snippets.map((s: { title: string }) => s.title).sort(), ['Gated bin', 'Open']);
  // Not even the count gives the private bin away.
  assert.equal(res.body.collection.snippetCount, 2);
  assert.equal('html' in res.body.snippets[0], false);

  // The collection token opens nothing: each bin keeps its own visibility.
  await request(t.app).get(`/api/snippets/${secret.shareId}`).set(UNLOCK_TOKEN_HEADER, token).expect(404);
  const stillLocked = await request(t.app).get(`/api/snippets/${gated.shareId}`).set(UNLOCK_TOKEN_HEADER, token).expect(200);
  assert.equal(stillLocked.body.locked, true);

  // The owner sees everything.
  const own = await request(t.app).get(`/api/collections/${c.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  assert.equal(own.body.snippets.length, 3);
  assert.equal(own.body.collection.snippetCount, 3);
});

test('a token for one collection does not unlock another', async () => {
  const t = makeApp();
  const a = await createCollection(t, 'alice@example.com', { title: 'A', password: PW });
  const b = await createCollection(t, 'alice@example.com', { title: 'B', password: PW });
  const tokenA = await unlock(t, a.shareId);
  const res = await request(t.app).get(`/api/collections/${b.shareId}`).set(UNLOCK_TOKEN_HEADER, tokenA).expect(200);
  assert.equal(res.body.locked, true);
});

test('changing or removing the password revokes unlock tokens', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const c = await createCollection(t, 'alice@example.com', { title: 'Gated', password: PW });
  const token = await unlock(t, c.shareId);

  await request(t.app).put(`/api/collections/${c.shareId}`).set(...alice).send({ title: 'Gated', password: 'another-pw' }).expect(200);
  const relocked = await request(t.app).get(`/api/collections/${c.shareId}`).set(UNLOCK_TOKEN_HEADER, token).expect(200);
  assert.equal(relocked.body.locked, true);

  // A rename alone keeps the new token valid.
  const fresh = await unlock(t, c.shareId, 'another-pw');
  await request(t.app).put(`/api/collections/${c.shareId}`).set(...alice).send({ title: 'New name' }).expect(200);
  const still = await request(t.app).get(`/api/collections/${c.shareId}`).set(UNLOCK_TOKEN_HEADER, fresh).expect(200);
  assert.equal(still.body.locked, false);

  // Removing the password makes it owner-only again.
  await request(t.app).put(`/api/collections/${c.shareId}`).set(...alice).send({ title: 'x', password: null }).expect(200);
  await request(t.app).get(`/api/collections/${c.shareId}`).set(UNLOCK_TOKEN_HEADER, fresh).expect(404);
});

test('collection tokens and login tokens are not interchangeable', async () => {
  const t = makeApp();
  const c = await createCollection(t, 'alice@example.com', { title: 'Gated', password: PW });
  const token = await unlock(t, c.shareId);
  await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
  const res = await request(t.app)
    .get(`/api/collections/${c.shareId}`)
    .set(UNLOCK_TOKEN_HEADER, t.tokenFor('alice@example.com'))
    .expect(200);
  assert.equal(res.body.locked, true);
});

test('membership is idempotent and owner-only', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const c = await createCollection(t, 'alice@example.com');
  const s = await createSnippet(t, 'alice@example.com');
  await addToCollection(t, 'alice@example.com', c.shareId, s.shareId);
  await addToCollection(t, 'alice@example.com', c.shareId, s.shareId);

  const view = await request(t.app).get(`/api/collections/${c.shareId}`).set(...alice).expect(200);
  assert.equal(view.body.isOwner, true);
  assert.equal(view.body.collection.snippetCount, 1);
  const bin = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...alice).expect(200);
  assert.deepEqual(bin.body.collections, [c.shareId]);

  // Someone else's bin can't be added: 403 if it is unlisted, 404 if private.
  const bobs = await createSnippet(t, 'bob@example.com');
  const bobsPrivate = await createSnippet(t, 'bob@example.com', PRIVATE);
  await request(t.app).put(`/api/collections/${c.shareId}/snippets/${bobs.shareId}`).set(...alice).expect(403);
  await request(t.app).put(`/api/collections/${c.shareId}/snippets/${bobsPrivate.shareId}`).set(...alice).expect(404);

  await request(t.app).delete(`/api/collections/${c.shareId}/snippets/${s.shareId}`).set(...alice).expect(204);
  await request(t.app).delete(`/api/collections/${c.shareId}/snippets/${s.shareId}`).set(...alice).expect(204);
  const after = await request(t.app).get(`/api/collections/${c.shareId}`).set(...alice).expect(200);
  assert.deepEqual(after.body.snippets, []);
});

test('a bin can be in several collections', async () => {
  const t = makeApp();
  const a = await createCollection(t, 'alice@example.com', { title: 'A' });
  const b = await createCollection(t, 'alice@example.com', { title: 'B' });
  const s = await createSnippet(t, 'alice@example.com');
  await addToCollection(t, 'alice@example.com', a.shareId, s.shareId);
  await addToCollection(t, 'alice@example.com', b.shareId, s.shareId);
  const bin = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  assert.deepEqual(bin.body.collections, [a.shareId, b.shareId]);
});

test('deleting a collection keeps its bins; deleting a bin removes its membership', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const c = await createCollection(t, 'alice@example.com');
  const keep = await createSnippet(t, 'alice@example.com');
  const drop = await createSnippet(t, 'alice@example.com');
  await addToCollection(t, 'alice@example.com', c.shareId, keep.shareId);
  await addToCollection(t, 'alice@example.com', c.shareId, drop.shareId);

  await request(t.app).delete(`/api/snippets/${drop.shareId}`).set(...alice).expect(204);
  const view = await request(t.app).get(`/api/collections/${c.shareId}`).set(...alice).expect(200);
  assert.deepEqual(view.body.snippets.map((s: { shareId: string }) => s.shareId), [keep.shareId]);

  await request(t.app).delete(`/api/collections/${c.shareId}`).set(...alice).expect(204);
  await request(t.app).get(`/api/snippets/${keep.shareId}`).expect(200);
});

test('membership changes bump the collection updatedAt', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const c = await createCollection(t, 'alice@example.com');
  const s = await createSnippet(t, 'alice@example.com');
  await addToCollection(t, 'alice@example.com', c.shareId, s.shareId);
  const view = await request(t.app).get(`/api/collections/${c.shareId}`).set(...alice).expect(200);
  assert.ok(view.body.collection.updatedAt > c.updatedAt);
});

test('failed unlocks are limited per IP and per collection', async () => {
  const t = makeApp({ limits: { unlock: 2, unlockTarget: 3 }, env: { TRUST_PROXY: '1' } });
  const c = await createCollection(t, 'alice@example.com', { title: 'Gated', password: PW });
  const attempt = (ip: string, password = 'wrong-password') =>
    request(t.app).post(`/api/collections/${c.shareId}/unlock`).set('X-Forwarded-For', ip).send({ password });

  await attempt('10.0.0.1').expect(403);
  await attempt('10.0.0.1').expect(403);
  await attempt('10.0.0.1', PW).expect(429);
  // A new IP gets past the per-IP limit but the collection's budget runs out.
  await attempt('10.0.0.2').expect(403);
  await attempt('10.0.0.3', PW).expect(429);
});
