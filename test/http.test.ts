import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { loadConfig } from '../src/server/config.ts';
import { makeApp } from './helpers.ts';

test('health check', async () => {
  const t = makeApp();
  const res = await request(t.app).get('/api/health').expect(200);
  assert.deepEqual(res.body, { ok: true });
});

test('unknown /api routes give JSON 404', async () => {
  const t = makeApp();
  for (const path of ['/api', '/api/nope', '/api/snippets/AAAAAAAAAA/nope']) {
    const res = await request(t.app).get(path).expect(404).expect('Content-Type', /json/);
    assert.equal(typeof res.body.error, 'string');
  }
});

test('malformed JSON gives JSON 400', async () => {
  const t = makeApp();
  const res = await request(t.app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email":')
    .expect(400)
    .expect('Content-Type', /json/);
  assert.equal(typeof res.body.error, 'string');
});

test('no x-powered-by header', async () => {
  const t = makeApp();
  const res = await request(t.app).get('/api/health');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('app pages get the strict CSP and SPA fallback', async () => {
  const t = makeApp();
  for (const path of ['/', '/some/deep/link']) {
    const res = await request(t.app).get(path).expect(200).expect('Content-Type', /html/);
    assert.match(res.text, /BinCode test/);
    assert.equal(res.headers['cache-control'], 'no-cache');
    const csp = String(res.headers['content-security-policy']);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /worker-src 'self' blob:/);
    assert.doesNotMatch(csp, /unsafe-eval/);
  }
  // Files that don't exist must not fall back to index.html.
  await request(t.app).get('/missing.js').expect(404);
});

test('preview page gets the permissive CSP', async () => {
  const t = makeApp();
  const res = await request(t.app).get('/preview.html').expect(200);
  const csp = String(res.headers['content-security-policy']);
  assert.match(csp, /default-src \* data: blob: 'unsafe-inline' 'unsafe-eval'/);
  assert.match(csp, /frame-ancestors 'self'/);
});

test('vendor files are loadable cross-origin', async () => {
  const t = makeApp();
  const res = await request(t.app).get('/vendor/eruda.min.js').expect(200);
  assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
  const index = await request(t.app).get('/');
  assert.equal(index.headers['cross-origin-resource-policy'], 'same-origin');
});

test('fingerprinted assets are cached immutably', async () => {
  const t = makeApp();
  const res = await request(t.app).get('/assets/app-abc123.js').expect(200);
  assert.match(String(res.headers['cache-control']), /immutable/);
  assert.match(String(res.headers['cache-control']), /max-age=31536000/);
});

test('missing client build gives a helpful 404', async () => {
  const { createApp } = await import('../src/server/app.ts');
  const t = makeApp();
  const app = createApp({ db: t.db, config: t.config, clientDir: '/nonexistent-bincode-client' });
  const res = await request(app).get('/').expect(404);
  assert.equal(res.text, 'Client not built. Run pnpm build.');
});

test('config requires a long JWT secret in production', () => {
  assert.throws(() => loadConfig({}), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }), /32 characters/);
  const c = loadConfig({ JWT_SECRET: 'x', TRUST_PROXY: 'loopback', PORT: '8080' });
  assert.equal(c.TRUST_PROXY, 'loopback');
  assert.equal(c.PORT, 8080);
  assert.equal(loadConfig({ JWT_SECRET: 'x', TRUST_PROXY: '1' }).TRUST_PROXY, 1);
  assert.equal(loadConfig({ JWT_SECRET: 'x' }).TRUST_PROXY, false);
});
