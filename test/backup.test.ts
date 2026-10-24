import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { BackupFile } from '../src/shared/api.ts';
import { UNLOCK_TOKEN_HEADER } from '../src/shared/constants.ts';
import { addToCollection, auth, createCollection, createSnippet, makeApp, type TestApp } from './helpers.ts';

const BIN_PW = 'bin-password';
const COL_PW = 'collection-pw';

async function exportRaw(t: TestApp, email = 'alice@example.com') {
  return request(t.app)
    .get('/api/account/export')
    .set(...auth(t.tokenFor(email)))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
}

const decode = (buf: Buffer) => JSON.parse(zlib.brotliDecompressSync(buf).toString('utf8')) as BackupFile;
const encode = (file: unknown) => zlib.brotliCompressSync(Buffer.from(JSON.stringify(file)));

function importRaw(t: TestApp, body: Buffer, email = 'alice@example.com') {
  return request(t.app)
    .post('/api/account/import')
    .set(...auth(t.tokenFor(email)))
    .set('Content-Type', 'application/octet-stream')
    .send(body);
}

async function seed(t: TestApp) {
  const plain = await createSnippet(t, 'alice@example.com', { title: 'Plain', html: '<p>plain</p>' });
  const gated = await createSnippet(t, 'alice@example.com', {
    title: 'Gated',
    html: '<p>gated</p>',
    settings: { visibility: 'password', password: BIN_PW },
  });
  const mine = await createSnippet(t, 'alice@example.com', { title: 'Mine', settings: { visibility: 'private', expiresIn: '1d' } });
  const fork = (await request(t.app)
    .post(`/api/snippets/${plain.shareId}/fork`)
    .set(...auth(t.tokenFor('alice@example.com')))
    .send({})
    .expect(201)).body;
  const col = await createCollection(t, 'alice@example.com', { title: 'Shelf', password: COL_PW });
  await addToCollection(t, 'alice@example.com', col.shareId, plain.shareId);
  await addToCollection(t, 'alice@example.com', col.shareId, gated.shareId);
  return { plain, gated, mine, fork, col };
}

async function deleteEverything(t: TestApp, email = 'alice@example.com') {
  const a = auth(t.tokenFor(email));
  for (const s of (await request(t.app).get('/api/snippets').set(...a)).body.snippets) {
    await request(t.app).delete(`/api/snippets/${s.shareId}`).set(...a).expect(204);
  }
  for (const c of (await request(t.app).get('/api/collections').set(...a)).body.collections) {
    await request(t.app).delete(`/api/collections/${c.shareId}`).set(...a).expect(204);
  }
}

test('export is a Brotli attachment with everything the user owns and no internal ids', async () => {
  const t = makeApp();
  const { plain, gated, mine, fork, col } = await seed(t);
  await createSnippet(t, 'bob@example.com', { title: 'Bobs' });
  const res = await exportRaw(t);
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  assert.match(res.headers['content-disposition']!, /^attachment; filename="bincode-backup-\d{4}-\d{2}-\d{2}\.json\.br"$/);
  assert.equal(res.headers['cache-control'], 'no-store');
  const file = decode(res.body as Buffer);
  assert.equal(file.format, 'bincode-backup');
  assert.deepEqual(file.bins.map((b) => b.shareId).sort(), [plain, gated, mine, fork].map((s) => s.shareId).sort());
  const g = file.bins.find((b) => b.shareId === gated.shareId)!;
  assert.match(g.passwordHash!, /^\$2[aby]\$/);
  assert.equal(file.bins.find((b) => b.shareId === fork.shareId)!.forkedFrom, plain.shareId);
  assert.deepEqual(file.collections[0]!.bins.sort(), [plain.shareId, gated.shareId].sort());
  assert.equal(file.collections[0]!.shareId, col.shareId);
  const text = JSON.stringify(file);
  assert.doesNotMatch(text, new RegExp(t.seeded.alice.id));
  assert.doesNotMatch(text, /"id"|userId|user_id|Bobs/);
});

test('round trip restores bins, settings, collections and links; passwords still work', async () => {
  const t = makeApp();
  const { plain, gated, mine, fork, col } = await seed(t);
  const backup = (await exportRaw(t)).body as Buffer;
  await deleteEverything(t);

  const res = await importRaw(t, backup).expect(200);
  assert.deepEqual(res.body, {
    bins: { imported: 4, skipped: 0, newLinks: 0 },
    collections: { imported: 1, skipped: 0, newLinks: 0 },
    memberships: 2,
  });
  const alice = auth(t.tokenFor('alice@example.com'));
  const p = await request(t.app).get(`/api/snippets/${plain.shareId}`).expect(200);
  assert.equal(p.body.html, '<p>plain</p>');
  assert.equal(p.body.createdAt, plain.createdAt);
  // Private stays private, with its expiry.
  await request(t.app).get(`/api/snippets/${mine.shareId}`).expect(404);
  const m = await request(t.app).get(`/api/snippets/${mine.shareId}`).set(...alice).expect(200);
  assert.equal(m.body.expiresAt, mine.expiresAt);
  // The old bin password still unlocks.
  const locked = await request(t.app).get(`/api/snippets/${gated.shareId}`).expect(200);
  assert.equal(locked.body.locked, true);
  await request(t.app).post(`/api/snippets/${gated.shareId}/unlock`).send({ password: BIN_PW }).expect(200);
  // Fork link and collection (with its password) are back.
  const f = await request(t.app).get(`/api/snippets/${fork.shareId}`).set(...alice).expect(200);
  assert.equal(f.body.forkedFrom, plain.shareId);
  const { token } = (await request(t.app).post(`/api/collections/${col.shareId}/unlock`).send({ password: COL_PW }).expect(200)).body;
  const view = await request(t.app).get(`/api/collections/${col.shareId}`).set(UNLOCK_TOKEN_HEADER, token).expect(200);
  assert.equal(view.body.snippets.length, 2);
});

test('re-importing changes nothing but restores missing memberships', async () => {
  const t = makeApp();
  const { plain, col } = await seed(t);
  const backup = (await exportRaw(t)).body as Buffer;
  const alice = auth(t.tokenFor('alice@example.com'));
  await request(t.app).delete(`/api/collections/${col.shareId}/snippets/${plain.shareId}`).set(...alice).expect(204);
  const res = await importRaw(t, backup).expect(200);
  assert.deepEqual(res.body, {
    bins: { imported: 0, skipped: 4, newLinks: 0 },
    collections: { imported: 0, skipped: 1, newLinks: 0 },
    memberships: 1,
  });
  assert.equal((await request(t.app).get('/api/snippets').set(...alice)).body.snippets.length, 4);
});

test('links that are or were someone else’s are never taken over', async () => {
  const t = makeApp();
  const bobLive = await createSnippet(t, 'bob@example.com', { title: 'bob live' });
  const bobGone = await createSnippet(t, 'bob@example.com', { title: 'bob gone' });
  await request(t.app).delete(`/api/snippets/${bobGone.shareId}`).set(...auth(t.tokenFor('bob@example.com'))).expect(204);
  const own = await createSnippet(t, 'alice@example.com', { title: 'own' });
  const backup = decode((await exportRaw(t)).body as Buffer);
  await deleteEverything(t);

  const bin = backup.bins[0]!;
  backup.bins = [
    bin, // alice's own retired link -> reused
    { ...bin, shareId: bobLive.shareId, title: 'hijack live' },
    { ...bin, shareId: bobGone.shareId, title: 'hijack retired' },
  ];
  const res = await importRaw(t, encode(backup)).expect(200);
  assert.deepEqual(res.body.bins, { imported: 3, skipped: 0, newLinks: 2 });
  assert.equal((await request(t.app).get(`/api/snippets/${own.shareId}`).expect(200)).body.title, 'own');
  assert.equal((await request(t.app).get(`/api/snippets/${bobLive.shareId}`).expect(200)).body.title, 'bob live');
  await request(t.app).get(`/api/snippets/${bobGone.shareId}`).expect(404);
});

test('deleting a user retires their links (trigger fires on cascade)', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'bob@example.com');
  t.users.delete(t.seeded.bob.id);
  const row = t.db.prepare('SELECT user_id, kind FROM retired_share_ids WHERE share_id = ?').get(s.shareId) as Record<string, string>;
  assert.deepEqual({ ...row }, { user_id: t.seeded.bob.id, kind: 'snippet' });
});

test('invalid backups are rejected', async () => {
  const t = makeApp();
  await seed(t);
  const good = decode((await exportRaw(t)).body as Buffer);
  const gated = good.bins.find((b) => b.visibility === 'password')!;
  const slowHash = `$2b$31$${'a'.repeat(53)}`;
  const cases: unknown[] = [
    { ...good, bins: [{ ...gated, passwordHash: slowHash }] },
    { ...good, bins: [{ ...gated, passwordHash: 'not-a-hash' }] },
    { ...good, bins: [{ ...gated, passwordHash: null }] },
    { ...good, bins: [good.bins[0], good.bins[0]] },
    { ...good, bins: [{ ...good.bins[0]!, html: 'x'.repeat(500_001) }] },
    { ...good, format: 'other' },
    { ...good, version: 2 },
    { ...good, collections: [{ ...good.collections[0]!, passwordHash: '$2b$04$short' }] },
  ];
  for (const c of cases) await importRaw(t, encode(c)).expect(400);
  await importRaw(t, Buffer.from('garbage bytes that are not brotli')).expect(400);
  await importRaw(t, Buffer.from('{not json')).expect(400);
  // The hash rule accepts real bcrypt hashes.
  const real = await bcrypt.hash('x', 4);
  assert.match(real, /^\$2[aby]\$04\$/);
});

test('decompression bombs and oversized uploads get 413', async () => {
  const t = makeApp();
  const bomb = zlib.brotliCompressSync(Buffer.alloc(70 * 1024 * 1024, 0x20));
  assert.ok(bomb.length < 1024 * 1024);
  await importRaw(t, bomb).expect(413);
  await importRaw(t, Buffer.alloc(26 * 1024 * 1024, 0x61)).expect(413);
});

test('plain JSON backups import too', async () => {
  const t = makeApp();
  await seed(t);
  const file = decode((await exportRaw(t)).body as Buffer);
  const res = await importRaw(t, Buffer.from(`  ${JSON.stringify(file)}`), 'bob@example.com').expect(200);
  // Every link is alice's, so bob gets copies under new links.
  assert.deepEqual(res.body.bins, { imported: 4, skipped: 0, newLinks: 4 });
});

test('an import over quota imports nothing', async () => {
  const t = makeApp({ quotas: { binsPerUser: 3 } });
  const a = await createSnippet(t, 'alice@example.com');
  const file = decode((await exportRaw(t)).body as Buffer);
  file.bins = ['AAAAAAAAA1', 'AAAAAAAAA2', 'AAAAAAAAA3'].map((shareId) => ({ ...file.bins[0]!, shareId }));
  const res = await importRaw(t, encode(file)).expect(403);
  assert.match(res.body.error, /limits/);
  const list = (await request(t.app).get('/api/snippets').set(...auth(t.tokenFor('alice@example.com')))).body.snippets;
  assert.deepEqual(list.map((s: { shareId: string }) => s.shareId), [a.shareId]);
});

test('expired bins are neither exported nor imported', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com', { title: 'soon', settings: { expiresIn: '10m' } });
  const file = decode((await exportRaw(t)).body as Buffer);
  assert.equal(file.bins.length, 1);
  t.db.prepare('UPDATE snippets SET expires_at = ? WHERE share_id = ?').run(new Date(Date.now() - 1000).toISOString(), s.shareId);
  assert.equal(decode((await exportRaw(t)).body as Buffer).bins.length, 0);
  t.db.prepare('DELETE FROM snippets').run();
  file.bins[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await importRaw(t, encode(file)).expect(200)).body.bins.imported, 0);
});

test('backup needs a login and is rate limited', async () => {
  const t = makeApp({ limits: { backup: 2 } });
  await request(t.app).get('/api/account/export').expect(401);
  await request(t.app).post('/api/account/import').set('Content-Type', 'application/octet-stream').send(Buffer.from('{}')).expect(401);
  await exportRaw(t);
  await exportRaw(t);
  await request(t.app).get('/api/account/export').set(...auth(t.tokenFor('alice@example.com'))).expect(429);
});
