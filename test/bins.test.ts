import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { UNLOCK_TOKEN_HEADER } from '../src/shared/constants.ts';
import { auth, createSnippet, makeApp, type TestApp } from './helpers.ts';

const BIN_PW = 'bin-password';
const CODE = { title: 'Gated', html: '<p>secret</p>', css: 'p{}', js: '1;' };

function passwordBin(t: TestApp, extra: Record<string, unknown> = {}) {
  return createSnippet(t, 'alice@example.com', { ...CODE, settings: { visibility: 'password', password: BIN_PW, ...extra } });
}

const unlockBin = (t: TestApp, shareId: string, body: Record<string, unknown> = { password: BIN_PW }) =>
  request(t.app).post(`/api/snippets/${shareId}/unlock`).send(body);

test('a password bin shows only its title until unlocked', async () => {
  const t = makeApp();
  const s = await passwordBin(t);
  assert.equal(s.visibility, 'password');
  assert.doesNotMatch(JSON.stringify(s), /password_?hash|\$2[aby]\$/i);

  for (const headers of [{}, { Authorization: `Bearer ${t.tokenFor('bob@example.com')}` }, { [UNLOCK_TOKEN_HEADER]: 'junk' }]) {
    const res = await request(t.app).get(`/api/snippets/${s.shareId}`).set(headers).expect(200);
    assert.deepEqual(res.body, { locked: true, reason: 'password', shareId: s.shareId, title: 'Gated' });
  }
  const own = await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  assert.equal(own.body.html, '<p>secret</p>');
});

test('the bin password unlocks it, and the token reopens it', async () => {
  const t = makeApp();
  const s = await passwordBin(t);
  await unlockBin(t, s.shareId, { password: 'wrong-password' }).expect(403);
  await unlockBin(t, s.shareId, {}).expect(403);

  const res = await unlockBin(t, s.shareId).expect(200);
  assert.equal(res.body.burned, false);
  assert.equal(res.body.snippet.html, '<p>secret</p>');
  assert.equal(res.body.snippet.isOwner, false);
  assert.equal(typeof res.body.token, 'string');

  const again = await request(t.app).get(`/api/snippets/${s.shareId}`).set(UNLOCK_TOKEN_HEADER, res.body.token).expect(200);
  assert.equal(again.body.html, '<p>secret</p>');

  // Read access is copy access.
  await request(t.app)
    .post(`/api/snippets/${s.shareId}/fork`)
    .set(...auth(t.tokenFor('bob@example.com')))
    .set(UNLOCK_TOKEN_HEADER, res.body.token)
    .send({})
    .expect(201);
  await request(t.app).post(`/api/snippets/${s.shareId}/fork`).set(...auth(t.tokenFor('bob@example.com'))).send({}).expect(404);
});

test('unlock tokens are bound to one bin and its current password', async () => {
  const t = makeApp();
  const a = await passwordBin(t);
  const b = await passwordBin(t);
  const { token } = (await unlockBin(t, a.shareId).expect(200)).body;

  const other = await request(t.app).get(`/api/snippets/${b.shareId}`).set(UNLOCK_TOKEN_HEADER, token).expect(200);
  assert.equal(other.body.locked, true);
  // A login token is not an unlock token, and vice versa.
  const asLogin = await request(t.app).get(`/api/snippets/${a.shareId}`).set(UNLOCK_TOKEN_HEADER, t.tokenFor('bob@example.com')).expect(200);
  assert.equal(asLogin.body.locked, true);
  await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);

  const alice = auth(t.tokenFor('alice@example.com'));
  await request(t.app).patch(`/api/snippets/${a.shareId}`).set(...alice).send({ password: 'new-password' }).expect(200);
  const revoked = await request(t.app).get(`/api/snippets/${a.shareId}`).set(UNLOCK_TOKEN_HEADER, token).expect(200);
  assert.equal(revoked.body.locked, true);
  await unlockBin(t, a.shareId).expect(403);
  await unlockBin(t, a.shareId, { password: 'new-password' }).expect(200);
});

test('switching to password needs a password; switching away clears it', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const s = await createSnippet(t, 'alice@example.com');
  const res = await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...alice).send({ visibility: 'password' }).expect(400);
  assert.equal(res.body.details[0].path, 'password');
  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...alice).send({ visibility: 'password', password: 'short' }).expect(400);
  await request(t.app).post('/api/snippets').set(...alice).send({ settings: { visibility: 'password' } }).expect(400);

  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...alice).send({ visibility: 'password', password: BIN_PW }).expect(200);
  // Keeping the stored password: no password field needed.
  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...alice).send({ visibility: 'password', expiresIn: '1d' }).expect(200);
  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...alice).send({ visibility: 'unlisted' }).expect(200);
  await request(t.app).get(`/api/snippets/${s.shareId}`).expect(200);
  // The old password is gone: going back to password needs a new one.
  await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...alice).send({ visibility: 'password' }).expect(400);
});

test('burn after read: GET never sends the code, the first unlock does and deletes the bin', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com', { ...CODE, settings: { burnAfterRead: true } });
  assert.equal(s.burnAfterRead, true);

  // Owner views and link previewers (plain GETs) don't burn it.
  await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(200);
  for (let i = 0; i < 2; i++) {
    const locked = await request(t.app).get(`/api/snippets/${s.shareId}`).expect(200);
    assert.deepEqual(locked.body, { locked: true, reason: 'burn', shareId: s.shareId, title: 'Gated' });
  }

  const res = await unlockBin(t, s.shareId, {}).expect(200);
  assert.equal(res.body.burned, true);
  assert.equal(res.body.snippet.html, '<p>secret</p>');
  assert.equal('token' in res.body, false);

  await unlockBin(t, s.shareId, {}).expect(404);
  await request(t.app).get(`/api/snippets/${s.shareId}`).set(...auth(t.tokenFor('alice@example.com'))).expect(404);
});

test('password plus burn needs the password and still burns once', async () => {
  const t = makeApp();
  const s = await passwordBin(t, { burnAfterRead: true });
  const locked = await request(t.app).get(`/api/snippets/${s.shareId}`).expect(200);
  assert.equal(locked.body.reason, 'password+burn');
  await unlockBin(t, s.shareId, {}).expect(403);
  // A wrong guess does not burn it.
  await unlockBin(t, s.shareId, { password: 'wrong-password' }).expect(403);
  const res = await unlockBin(t, s.shareId).expect(200);
  assert.equal(res.body.burned, true);
  await unlockBin(t, s.shareId).expect(404);
});

test('expired bins disappear everywhere and are swept', async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const s = await createSnippet(t, 'alice@example.com', { ...CODE, settings: { expiresIn: '10m' } });
  const ms = Date.parse(s.expiresAt!) - Date.now();
  assert.ok(ms > 9 * 60_000 && ms <= 10 * 60_000);

  // Expire it by moving the clock in the database.
  t.db.prepare('UPDATE snippets SET expires_at = ? WHERE share_id = ?').run(new Date(Date.now() - 1000).toISOString(), s.shareId);
  await request(t.app).get(`/api/snippets/${s.shareId}`).set(...alice).expect(404);
  const list = await request(t.app).get('/api/snippets').set(...alice).expect(200);
  assert.equal(list.body.snippets.length, 0);

  const count = () => (t.db.prepare('SELECT COUNT(*) AS n FROM snippets').get() as { n: number }).n;
  assert.equal(count(), 1);
  const { createSnippetsRepo } = await import('../src/server/repos/snippets.ts');
  assert.equal(createSnippetsRepo(t.db).sweepExpired(), 1);
  assert.equal(count(), 0);
});

test("expiresIn 'never' clears the expiry", async () => {
  const t = makeApp();
  const alice = auth(t.tokenFor('alice@example.com'));
  const s = await createSnippet(t, 'alice@example.com', { ...CODE, settings: { expiresIn: '1w' } });
  assert.notEqual(s.expiresAt, null);
  const res = await request(t.app).patch(`/api/snippets/${s.shareId}`).set(...alice).send({ expiresIn: 'never' }).expect(200);
  assert.equal(res.body.expiresAt, null);
});

test('unlocking a bin that is not locked is a 404', async () => {
  const t = makeApp();
  const s = await createSnippet(t, 'alice@example.com');
  await unlockBin(t, s.shareId, {}).expect(404);
  await unlockBin(t, 'not-an-id', {}).expect(404);
});

test('failed bin unlocks are limited per IP and per bin', async () => {
  const t = makeApp({ limits: { unlock: 2, unlockTarget: 3 }, env: { TRUST_PROXY: '1' } });
  const s = await passwordBin(t);
  const attempt = (ip: string, password = 'wrong-password') =>
    request(t.app).post(`/api/snippets/${s.shareId}/unlock`).set('X-Forwarded-For', ip).send({ password });
  await attempt('10.0.0.1').expect(403);
  await attempt('10.0.0.1').expect(403);
  await attempt('10.0.0.1', BIN_PW).expect(429);
  await attempt('10.0.0.2').expect(403);
  await attempt('10.0.0.3', BIN_PW).expect(429);
});
