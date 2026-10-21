import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { auth, createSnippet, makeApp } from './helpers.ts';

const PRIVATE = { title: 'Secret', html: '<p>s</p>', css: '', js: '', visibility: 'private' };

test('snippets default to unlisted', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com');
  assert.equal(s.visibility, 'unlisted');
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

  const own = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  assert.equal(own.body.html, '<p>s</p>');
});

test('non-owners get 404, not 403, when mutating a private snippet', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com', PRIVATE);
  const bob = auth(t.tokenFor('bob@example.com'));
  await request(t.app).put(`/api/snippets/${s.shareId}`).set(...bob).send({ title: 'x' }).expect(404);
  await request(t.app).delete(`/api/snippets/${s.shareId}`).set(...bob).expect(404);
  await request(t.app).post(`/api/snippets/${s.shareId}/fork`).set(...bob).send({}).expect(404);
});

test('PUT keeps visibility when omitted and changes it when given', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const s = await createSnippet(t, 'alice@example.com', PRIVATE);

  const kept = await request(t.app).put(`/api/snippets/${s.shareId}`).set(...alice).send({ title: 'Renamed' }).expect(200);
  assert.equal(kept.body.visibility, 'private');

  const changed = await request(t.app)
    .put(`/api/snippets/${s.shareId}`)
    .set(...alice)
    .send({ title: 'Renamed', visibility: 'unlisted' })
    .expect(200);
  assert.equal(changed.body.visibility, 'unlisted');
  await request(t.app).get(`/api/snippets/${s.shareId}`).expect(200);
});

test('invalid visibility is a 400', async () => {
  const t = makeApp();
  await request(t.app)
    .post('/api/snippets')
    .set(...auth(t.tokenFor('alice@example.com')))
    .send({ title: 'x', visibility: 'public' })
    .expect(400);
});

test('forks inherit visibility unless overridden', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const s = await createSnippet(t, 'alice@example.com', PRIVATE);

  const inherited = await request(t.app).post(`/api/snippets/${s.shareId}/fork`).set(...alice).send({}).expect(201);
  assert.equal(inherited.body.visibility, 'private');

  const overridden = await request(t.app)
    .post(`/api/snippets/${s.shareId}/fork`)
    .set(...alice)
    .send({ visibility: 'unlisted' })
    .expect(201);
  assert.equal(overridden.body.visibility, 'unlisted');
});

test('forkedFrom is hidden from others once the source turns private', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const bob = auth(t.tokenFor('bob@example.com'));
  const source = await createSnippet(t, 'alice@example.com');
  const fork = await request(t.app).post(`/api/snippets/${source.shareId}/fork`).set(...bob).send({}).expect(201);
  assert.equal(fork.body.forkedFrom, source.shareId);

  await request(t.app).put(`/api/snippets/${source.shareId}`).set(...alice).send({ title: 'x', visibility: 'private' }).expect(200);

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
