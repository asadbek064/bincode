import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { LIMITS } from '../src/shared/constants.ts';
import { auth, createSnippet, makeApp } from './helpers.ts';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

test('fork requires auth', async () => {
  const t = makeApp();
  const s = await createSnippet(t, ALICE);
  await request(t.app).post(`/api/snippets/${s.shareId}/fork`).send({}).expect(401);
});

test('fork copies content and sets forkedFrom', async () => {
  const t = makeApp();
  const src = await createSnippet(t, ALICE);
  const res = await request(t.app).post(`/api/snippets/${src.shareId}/fork`).set(...auth(t.tokenFor(BOB))).expect(201);
  const fork = res.body;
  assert.notEqual(fork.shareId, src.shareId);
  assert.equal(fork.title, 'Hello (fork)');
  assert.deepEqual([fork.html, fork.css, fork.js], [src.html, src.css, src.js]);
  assert.equal(fork.forkedFrom, src.shareId);
  assert.equal(fork.isOwner, true);

  const list = await request(t.app).get('/api/snippets').set(...auth(t.tokenFor(BOB))).expect(200);
  assert.equal(list.body.snippets[0].forkedFrom, src.shareId);

  // Owners can fork their own snippets too.
  await request(t.app).post(`/api/snippets/${src.shareId}/fork`).set(...auth(t.tokenFor(ALICE))).send({}).expect(201);
});

test('fork body overrides the source content', async () => {
  const t = makeApp();
  const src = await createSnippet(t, ALICE);
  const res = await request(t.app)
    .post(`/api/snippets/${src.shareId}/fork`)
    .set(...auth(t.tokenFor(BOB)))
    .send({ title: 'Mine', js: 'changed();' })
    .expect(201);
  assert.equal(res.body.title, 'Mine');
  assert.equal(res.body.js, 'changed();');
  assert.equal(res.body.html, src.html);
  assert.equal(res.body.forkedFrom, src.shareId);

  await request(t.app).post(`/api/snippets/${src.shareId}/fork`).set(...auth(t.tokenFor(BOB))).send({ html: 5 }).expect(400);
});

test('fork default title is truncated to the limit', async () => {
  const t = makeApp();
  const src = await createSnippet(t, ALICE, { title: 'x'.repeat(LIMITS.titleMax) });
  const res = await request(t.app).post(`/api/snippets/${src.shareId}/fork`).set(...auth(t.tokenFor(BOB))).expect(201);
  assert.equal(res.body.title.length, LIMITS.titleMax);
});

test('fork rejects overrides that push combined code over the limit', async () => {
  const t = makeApp();
  const half = LIMITS.codeMax / 2 + 1;
  const src = await createSnippet(t, ALICE, { html: 'a'.repeat(half) });
  await request(t.app).post(`/api/snippets/${src.shareId}/fork`).set(...auth(t.tokenFor(BOB))).send({ js: 'b'.repeat(half) }).expect(400);
});

test('fork of unknown source is 404', async () => {
  const t = makeApp();
  const res = await request(t.app).post('/api/snippets/AAAAAAAAAA/fork').set(...auth(t.tokenFor(BOB))).expect(404);
  assert.deepEqual(res.body, { error: 'Snippet not found' });
});

test('deleting the source nulls forkedFrom on the fork', async () => {
  const t = makeApp();
  const src = await createSnippet(t, ALICE);
  const fork = (await request(t.app).post(`/api/snippets/${src.shareId}/fork`).set(...auth(t.tokenFor(BOB))).expect(201)).body;
  await request(t.app).delete(`/api/snippets/${src.shareId}`).set(...auth(t.tokenFor(ALICE))).expect(204);
  const res = await request(t.app).get(`/api/snippets/${fork.shareId}`).expect(200);
  assert.equal(res.body.forkedFrom, null);
  assert.equal(res.body.html, src.html);
});
