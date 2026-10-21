import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { auth, makeApp, PASSWORD } from './helpers.ts';

test('login succeeds and returns token and user', async () => {
  const t = makeApp();
  const res = await request(t.app).post('/api/auth/login').send({ email: 'alice@example.com', password: PASSWORD }).expect(200);
  assert.equal(typeof res.body.token, 'string');
  assert.deepEqual(res.body.user, { id: t.seeded.alice.id, email: 'alice@example.com' });

  const me = await request(t.app).get('/api/auth/me').set(...auth(res.body.token)).expect(200);
  assert.deepEqual(me.body, { user: { id: t.seeded.alice.id, email: 'alice@example.com' } });
});

test('unknown email and wrong password give the same 401', async () => {
  const t = makeApp();
  const unknown = await request(t.app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD }).expect(401);
  const wrong = await request(t.app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'nope-nope' }).expect(401);
  assert.deepEqual(unknown.body, { error: 'Invalid email or password' });
  assert.deepEqual(wrong.body, unknown.body);
});

test('login validation errors are 400', async () => {
  const t = makeApp();
  for (const body of [{}, { email: 'not-an-email', password: 'x' }, { email: 'alice@example.com' }, { email: 'alice@example.com', password: 123 }]) {
    const res = await request(t.app).post('/api/auth/login').send(body).expect(400);
    assert.equal(res.body.error, 'Validation failed');
    assert.ok(Array.isArray(res.body.details) && res.body.details.length > 0);
  }
});

test('email case and surrounding whitespace are ignored', async () => {
  const t = makeApp();
  await request(t.app).post('/api/auth/login').send({ email: '  ALICE@Example.COM ', password: PASSWORD }).expect(200);
});

test('gmail-style dots are not normalized away', async () => {
  const t = makeApp();
  t.users.create('first.last@gmail.com', t.users.findByEmail('alice@example.com')!.passwordHash);
  await request(t.app).post('/api/auth/login').send({ email: 'first.last@gmail.com', password: PASSWORD }).expect(200);
  await request(t.app).post('/api/auth/login').send({ email: 'firstlast@gmail.com', password: PASSWORD }).expect(401);
});

test('/me rejects missing, malformed and invalid tokens', async (s) => {
  const t = makeApp();
  const userId = t.seeded.alice.id;
  const secret = t.config.JWT_SECRET;

  await s.test('missing', async () => {
    await request(t.app).get('/api/auth/me').expect(401);
  });
  await s.test('malformed header', async () => {
    for (const header of ['Basic abc', 'Bearer', 'Bearer a b', `bearer ${t.tokenFor('alice@example.com')}`]) {
      const res = await request(t.app).get('/api/auth/me').set('Authorization', header).expect(401);
      assert.equal(typeof res.body.error, 'string');
    }
  });
  await s.test('garbage token', async () => {
    await request(t.app).get('/api/auth/me').set(...auth('not.a.jwt')).expect(401);
  });
  await s.test('expired', async () => {
    const token = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 60 }, secret, { algorithm: 'HS256', subject: userId });
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
  });
  await s.test('wrong secret', async () => {
    const token = jwt.sign({}, 'some-other-secret-that-is-also-long-enough', { algorithm: 'HS256', subject: userId });
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
  });
  await s.test('alg none', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId, iat: Math.floor(Date.now() / 1000) })}.`;
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
  });
  await s.test('HS512 with the right secret', async () => {
    const token = jwt.sign({}, secret, { algorithm: 'HS512', subject: userId });
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
  });
  await s.test('no subject', async () => {
    const token = jwt.sign({}, secret, { algorithm: 'HS256' });
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
  });
  await s.test('deleted user', async () => {
    const token = t.tokenFor('bob@example.com');
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(200);
    t.users.delete(t.seeded.bob.id);
    await request(t.app).get('/api/auth/me').set(...auth(token)).expect(401);
  });
});

test('429 after 10 failed logins, successful logins are not counted', async () => {
  const t = makeApp({ limits: { login: 10 } });
  for (let i = 0; i < 5; i++) {
    await request(t.app).post('/api/auth/login').send({ email: 'alice@example.com', password: PASSWORD }).expect(200);
  }
  for (let i = 0; i < 10; i++) {
    await request(t.app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong-pass' }).expect(401);
  }
  const res = await request(t.app).post('/api/auth/login').send({ email: 'alice@example.com', password: PASSWORD }).expect(429);
  assert.deepEqual(res.body, { error: 'Too many requests, please try again later.' });
  assert.ok(res.headers['ratelimit-policy']);
});

test('api limiter applies across /api', async () => {
  const t = makeApp({ limits: { api: 3 } });
  for (let i = 0; i < 3; i++) await request(t.app).get('/api/auth/me').expect(401);
  await request(t.app).get('/api/auth/me').expect(429);
});
