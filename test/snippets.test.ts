import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { LIMITS, SHARE_ID_PATTERN } from '../src/shared/constants.ts';
import { auth, createSnippet, makeApp } from './helpers.ts';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

test('create requires auth', async () => {
  const t = makeApp();
  await request(t.app).post('/api/snippets').send({ title: 'x' }).expect(401);
});

test('create returns the full snippet without internal ids', async () => {
  const t = makeApp();
  const s = await createSnippet(t, ALICE, { title: 'a<b', html: '<b>x</b>', css: 'b{}', js: 'alert(1)' });
  assert.match(s.shareId, SHARE_ID_PATTERN);
  assert.equal(s.title, 'a<b');
  assert.equal(s.html, '<b>x</b>');
  assert.equal(s.css, 'b{}');
  assert.equal(s.js, 'alert(1)');
  assert.equal(s.isOwner, true);
  assert.equal(s.forkedFrom, null);
  assert.equal(s.createdAt, s.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(s.createdAt)));
  assert.deepEqual(Object.keys(s).sort(), ['collections', 'createdAt', 'css', 'forkedFrom', 'html', 'isOwner', 'js', 'shareId', 'title', 'updatedAt', 'visibility']);
});

test('empty or missing title becomes Untitled and code defaults to empty', async () => {
  const t = makeApp();
  const a = await createSnippet(t, ALICE, { title: '   ' });
  assert.equal(a.title, 'Untitled');
  const b = await createSnippet(t, ALICE, {});
  assert.deepEqual([b.title, b.html, b.css, b.js], ['Untitled', '', '', '']);
});

test('create validation', async () => {
  const t = makeApp();
  const token = t.tokenFor(ALICE);
  const post = (body: unknown) => request(t.app).post('/api/snippets').set(...auth(token)).send(body as object);

  const long = await post({ title: 'x'.repeat(LIMITS.titleMax + 1) }).expect(400);
  assert.equal(long.body.error, 'Validation failed');
  assert.equal(long.body.details[0].path, 'title');

  await post({ title: 'x'.repeat(LIMITS.titleMax) }).expect(201);
  await post({ html: 123 }).expect(400);
  await post({ js: { a: 1 } }).expect(400);
  await post({ css: null }).expect(400);

  const third = Math.ceil(LIMITS.codeMax / 3) + 1;
  const big = await post({ html: 'a'.repeat(third), css: 'b'.repeat(third), js: 'c'.repeat(third) }).expect(400);
  assert.match(big.body.details[0].message, /Combined code/);

  const huge = await post({ html: 'a'.repeat(2.1 * 1024 * 1024) }).expect(413);
  assert.equal(typeof huge.body.error, 'string');
});

test('public GET works anonymously and sets isOwner', async () => {
  const t = makeApp();
  const s = await createSnippet(t, ALICE);

  const anon = await request(t.app).get(`/api/snippets/${s.shareId}`).expect(200);
  assert.equal(anon.body.isOwner, false);
  assert.equal(anon.body.html, s.html);

  const owner = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor(ALICE))).expect(200);
  assert.equal(owner.body.isOwner, true);

  const other = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor(BOB))).expect(200);
  assert.equal(other.body.isOwner, false);

  // A bad token on a public route degrades to anonymous rather than failing.
  const bad = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth('garbage')).expect(200);
  assert.equal(bad.body.isOwner, false);
});

test('GET unknown or malformed shareId is 404', async () => {
  const t = makeApp();
  for (const id of ['AAAAAAAAAA', 'short', 'way-too-long-share-id', 'bad%20chars']) {
    const res = await request(t.app).get(`/api/snippets/${id}`).expect(404);
    assert.deepEqual(res.body, { error: 'Snippet not found' });
  }
});

test('list shows only own snippets, newest updatedAt first, without code', async () => {
  const t = makeApp();
  await request(t.app).get('/api/snippets').expect(401);

  const first = await createSnippet(t, ALICE, { title: 'first' });
  const second = await createSnippet(t, ALICE, { title: 'second' });
  await createSnippet(t, BOB, { title: 'bob' });

  // Touch the older one so it moves to the top.
  await request(t.app).put(`/api/snippets/${first.shareId}`).set(...auth(t.tokenFor(ALICE))).send({ title: 'first!' }).expect(200);

  const res = await request(t.app).get('/api/snippets').set(...auth(t.tokenFor(ALICE))).expect(200);
  assert.deepEqual(res.body.snippets.map((s: { title: string }) => s.title), ['first!', 'second']);
  assert.equal(res.body.snippets[1].shareId, second.shareId);
  for (const s of res.body.snippets) {
    assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'forkedFrom', 'shareId', 'title', 'updatedAt', 'visibility']);
  }

  const empty = await request(t.app).get('/api/snippets').set(...auth(t.tokenFor(BOB))).expect(200);
  assert.equal(empty.body.snippets.length, 1);
});

test('PUT updates in place and advances updatedAt', async () => {
  const t = makeApp();
  const s = await createSnippet(t, ALICE);
  const res = await request(t.app)
    .put(`/api/snippets/${s.shareId}`)
    .set(...auth(t.tokenFor(ALICE)))
    .send({ title: 'New', html: '<i>new</i>', css: '', js: '' })
    .expect(200);
  assert.equal(res.body.shareId, s.shareId);
  assert.equal(res.body.title, 'New');
  assert.equal(res.body.html, '<i>new</i>');
  assert.equal(res.body.createdAt, s.createdAt);
  assert.ok(res.body.updatedAt > s.updatedAt);

  const again = await request(t.app).put(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor(ALICE))).send({ title: 'New' }).expect(200);
  assert.ok(again.body.updatedAt > res.body.updatedAt);
});

test('PUT auth, ownership and validation', async () => {
  const t = makeApp();
  const s = await createSnippet(t, ALICE);
  const url = `/api/snippets/${s.shareId}`;
  await request(t.app).put(url).send({ title: 'x' }).expect(401);
  const forbidden = await request(t.app).put(url).set(...auth(t.tokenFor(BOB))).send({ title: 'x' }).expect(403);
  assert.equal(typeof forbidden.body.error, 'string');
  await request(t.app).put(url).set(...auth(t.tokenFor(BOB))).send({ html: 1 }).expect(403);
  await request(t.app).put('/api/snippets/AAAAAAAAAA').set(...auth(t.tokenFor(ALICE))).send({ title: 'x' }).expect(404);
  await request(t.app).put(url).set(...auth(t.tokenFor(ALICE))).send({ html: 1 }).expect(400);

  const unchanged = await request(t.app).get(url).expect(200);
  assert.equal(unchanged.body.title, 'Hello');
});

test('DELETE auth, ownership and effect', async () => {
  const t = makeApp();
  const s = await createSnippet(t, ALICE);
  const url = `/api/snippets/${s.shareId}`;
  await request(t.app).delete(url).expect(401);
  await request(t.app).delete(url).set(...auth(t.tokenFor(BOB))).expect(403);
  await request(t.app).delete('/api/snippets/AAAAAAAAAA').set(...auth(t.tokenFor(ALICE))).expect(404);
  const res = await request(t.app).delete(url).set(...auth(t.tokenFor(ALICE))).expect(204);
  assert.equal(res.text, '');
  await request(t.app).get(url).expect(404);
  await request(t.app).delete(url).set(...auth(t.tokenFor(ALICE))).expect(404);
});

test('deleting a user cascades to their snippets', async () => {
  const t = makeApp();
  const s = await createSnippet(t, BOB);
  t.users.delete(t.seeded.bob.id);
  await request(t.app).get(`/api/snippets/${s.shareId}`).expect(404);
});

test('mutations are limited per user', async () => {
  const t = makeApp({ limits: { writes: 2 } });
  const alice = auth(t.tokenFor('alice@example.com'));
  await request(t.app).post('/api/snippets').set(...alice).send({ title: 'a' }).expect(201);
  await request(t.app).post('/api/snippets').set(...alice).send({ title: 'b' }).expect(201);
  await request(t.app).post('/api/snippets').set(...alice).send({ title: 'c' }).expect(429);
  // Reads and other users are unaffected.
  await request(t.app).get('/api/snippets').set(...alice).expect(200);
  await request(t.app).post('/api/snippets').set(...auth(t.tokenFor('bob@example.com'))).send({ title: 'd' }).expect(201);
});
