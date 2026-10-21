import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { auth, createSnippet, makeApp, type TestApp } from './helpers.ts';

const PRIVATE = { title: 'Secret', html: '<p>s</p>', css: '', js: '', settings: { visibility: 'private' } };

function patch(t: TestApp, email: string, shareId: string, body: Record<string, unknown>) {
  return request(t.app).patch(`/api/snippets/${shareId}`).set(...auth(t.tokenFor(email))).send(body);
}

test('snippets default to unlisted with no expiry or burn', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com');
  assert.equal(s.visibility, 'unlisted');
  assert.equal(s.expiresAt, null);
  assert.equal(s.burnAfterRead, false);
  await request(t.app).get(`/api/snippets/${s.shareId}`).expect(200);
});

test('private snippets are 404 to everyone but the owner', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com', PRIVATE);
  assert.equal(s.visibility, 'private');

  const anon = await request(t.app).get(`/api/snippets/${s.shareId}`).expect(404);
  const bob = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('bob@example.com'))).expect(404);
  assert.deepEqual(anon.body, { error: 'Snippet not found' });
  assert.deepEqual(bob.body, anon.body);
  await request(t.app).post(`/api/snippets/${s.shareId}/unlock`).send({}).expect(404);

  const own = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  assert.equal(own.body.html, '<p>s</p>');
});

test('non-owners get 404, not 403, when mutating a private snippet', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com', PRIVATE);
  const bob = auth(t.tokenFor('bob@example.com'));
  await request(t.app).put(`/api/snippets/${s.shareId}`).set(...bob).send({ title: 'x' }).expect(404);
  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...bob).send({ visibility: 'unlisted' }).expect(404);
  await request(t.app).delete(`/api/snippets/${s.shareId}`).set(...bob).expect(404);
  await request(t.app).post(`/api/snippets/${s.shareId}/fork`).set(...bob).send({}).expect(404);
});

test('PATCH changes settings without touching content; PUT ignores settings', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com');

  const patched = await patch(t, 'alice@example.com', s.shareId, { visibility: 'private' }).expect(200);
  assert.equal(patched.body.visibility, 'private');
  assert.equal(patched.body.html, s.html);
  assert.ok(patched.body.updatedAt > s.updatedAt);
  await request(t.app).get(`/api/snippets/${s.shareId}`).expect(404);

  const put = await request(t.app)
    .put(`/api/snippets/${s.shareId}`)
    .set(...auth(t.tokenFor('alice@example.com')))
    .send({ title: 'Renamed', visibility: 'unlisted' })
    .expect(200);
  assert.equal(put.body.title, 'Renamed');
  assert.equal(put.body.visibility, 'private');
});

test('PATCH checks ownership before validating', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com');
  await patch(t, 'bob@example.com', s.shareId, { visibility: 'nope' }).expect(403);
  await patch(t, 'alice@example.com', s.shareId, { visibility: 'nope' }).expect(400);
  await patch(t, 'alice@example.com', s.shareId, { expiresIn: '2y' }).expect(400);
});

test('forks: owners keep visibility and password, others start unlisted', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const s = await createSnippet(t, 'alice@example.com', PRIVATE);
  const own = await request(t.app).post(`/api/snippets/${s.shareId}/fork`).set(...alice).send({}).expect(201);
  assert.equal(own.body.visibility, 'private');

  const pw = await createSnippet(t, 'alice@example.com', {
    title: 'pw',
    settings: { visibility: 'password', password: 'bin-password', expiresIn: '1d', burnAfterRead: false },
  });
  const ownPw = await request(t.app).post(`/api/snippets/${pw.shareId}/fork`).set(...alice).send({}).expect(201);
  assert.equal(ownPw.body.visibility, 'password');
  assert.equal(ownPw.body.expiresAt, null);
  // The copy keeps the password: a visitor still has to unlock it.
  const locked = await request(t.app).get(`/api/snippets/${ownPw.body.shareId}`).expect(200);
  assert.equal(locked.body.locked, true);

  const unlisted = await createSnippet(t, 'alice@example.com');
  const bobs = await request(t.app)
    .post(`/api/snippets/${unlisted.shareId}/fork`)
    .set(...auth(t.tokenFor('bob@example.com')))
    .send({})
    .expect(201);
  assert.equal(bobs.body.visibility, 'unlisted');
});

test('forkedFrom is hidden from others once the source turns private', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const bob = auth(t.tokenFor('bob@example.com'));
  const source = await createSnippet(t, 'alice@example.com');
  const fork = await request(t.app).post(`/api/snippets/${source.shareId}/fork`).set(...bob).send({}).expect(201);
  assert.equal(fork.body.forkedFrom, source.shareId);

  await patch(t, 'alice@example.com', source.shareId, { visibility: 'private' }).expect(200);

  const asBob = await request(t.app).get(`/api/snippets/${fork.body.shareId}`).set(...bob).expect(200);
  assert.equal(asBob.body.forkedFrom, null);
  const list = await request(t.app).get('/api/snippets').set(...bob).expect(200);
  assert.equal(list.body.snippets[0].forkedFrom, null);
  // The source's owner still sees the link.
  const asAlice = await request(t.app).get(`/api/snippets/${fork.body.shareId}`).set(...alice).expect(200);
  assert.equal(asAlice.body.forkedFrom, source.shareId);
});

test('only the owner sees which collections a snippet is in', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com');
  const own = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  assert.deepEqual(own.body.collections, []);
  const anon = await request(t.app).get(`/api/snippets/${s.shareId}`).expect(200);
  assert.equal('collections' in anon.body, false);
});
