import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { PREVIEW_CONSOLE } from '../src/shared/constants.ts';
import { CONSOLE_BRIDGE, buildPreviewDocument } from '../src/client/src/lib/previewDoc.ts';

const base = { html: '', css: '', js: '' };

test('places html in the body', () => {
  const doc = buildPreviewDocument({ ...base, html: '<h1 id="x">Hi</h1>' });
  assert.match(doc, /<body>[\s\S]*<h1 id="x">Hi<\/h1>[\s\S]*<\/body>/);
});

test('escapes closing script tags in js', () => {
  const doc = buildPreviewDocument({ ...base, js: 'const s = "</script><b>boom</b>"; const t = "</SCRIPT >";' });
  const userScript = doc.slice(doc.indexOf('<body>'));
  assert.doesNotMatch(userScript.slice(0, userScript.lastIndexOf('</script>')), /<\/script/i);
  assert.equal(userScript.match(/<\/script>/gi)?.length, 1);
});

test('escapes closing style tags in css', () => {
  const doc = buildPreviewDocument({ ...base, css: 'a{} </style><script>evil()</script> </STYLE>' });
  assert.equal(doc.match(/<\/style/gi)?.length, 1);
});

test('includes the console bridge, and no eruda', () => {
  const doc = buildPreviewDocument({ ...base, js: 'console.log(1)' });
  assert.ok(doc.includes(CONSOLE_BRIDGE));
  assert.ok(doc.includes(PREVIEW_CONSOLE));
  assert.doesNotMatch(doc, /eruda|\/vendor\//i);
  // The bridge must not close its own script tag early.
  assert.doesNotMatch(CONSOLE_BRIDGE, /<\/script/i);
});

test('adds no lines ahead of the user script, so its line numbers are unchanged', () => {
  const js = 'let a = 1;\nthrow new Error("x");';
  const doc = buildPreviewDocument({ ...base, js });
  assert.ok(!CONSOLE_BRIDGE.includes('\n'));
  // Everything before the user's code is one line, and the user's script tag has no prefix.
  assert.ok(!doc.slice(0, doc.indexOf(js)).includes('\n'));
  assert.ok(doc.includes(`<script>${js}</script>`));
});

/** Runs the bridge in a bare vm context and returns what it posts to the parent. */
function runBridge(code: string) {
  const posted: { type: string; level: string; text: string }[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const originals: unknown[][] = [];
  const noop = (...args: unknown[]) => void originals.push(args);
  const ctx: Record<string, unknown> = {
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop },
    location: { href: 'http://app/preview.html' },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    parent: { postMessage: (msg: { type: string; level: string; text: string }) => posted.push(msg) },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CONSOLE_BRIDGE, ctx);
  vm.runInContext(code, ctx);
  return { posted, listeners, originals };
}

test('bridge formats values safely and still calls the original console', () => {
  const { posted, originals } = runBridge(`
    var o = { a: 1, s: 'x', u: undefined, f: function named() {} }; o.self = o;
    console.log('hi', 42, null, undefined, true, 10n, Symbol('s'));
    console.info(o, [1, [2, [3, [4]]]]);
    var e = new TypeError('bad'); e.stack = 'TypeError: bad\\n    at here';
    console.error(e);
    console.warn('x'.repeat(5000));
    console.debug(function foo() {}, { nodeType: 1, nodeName: 'DIV', id: 'app', className: 'a  b' });
  `);
  assert.deepEqual(
    posted.map((m) => [m.type, m.level]),
    ['log', 'info', 'error', 'warn', 'debug'].map((l) => [PREVIEW_CONSOLE, l]),
  );
  const [plain, objects, error, long, misc] = posted.map((m) => m.text);
  assert.equal(plain, 'hi 42 null undefined true 10 Symbol(s)');
  assert.equal(objects, '{"a":1,"s":"x","u":undefined,"f":ƒ named(),"self":[Circular]} [1,[2,[3,[Array]]]]');
  assert.equal(error, 'TypeError: bad\n    at here');
  assert.equal(long, 'x'.repeat(2000) + '…');
  assert.equal(misc, 'ƒ foo() <div#app.a.b>');
  assert.equal(originals.length, 5);
});

test('bridge reports uncaught errors and rejections', () => {
  const { posted, listeners } = runBridge('');
  listeners.error!({ message: 'Uncaught ReferenceError: x is not defined', filename: 'http://app/preview.html', lineno: 3 });
  listeners.unhandledrejection!({ reason: 'nope' });
  assert.deepEqual(
    posted.map((m) => [m.level, m.text]),
    [
      ['error', 'Uncaught ReferenceError: x is not defined (line 3)'],
      ['error', 'Uncaught (in promise) nope'],
    ],
  );
});

test('bridge survives hostile values and caps its output', () => {
  const { posted } = runBridge(`
    var evil = {}; Object.defineProperty(evil, 'boom', { enumerable: true, get: function () { throw 1; } });
    var loud = { get x() { console.log('again'); return 1; } };
    console.log(evil, loud);
    for (var i = 0; i < 1100; i++) console.log(i);
  `);
  assert.equal(posted.length, 1001);
  assert.equal(posted[0]?.text, '{"boom":[Thrown]} {"x":1}');
  assert.deepEqual([posted[1000]?.level, posted[1000]?.text], ['warn', 'Console output truncated']);
});
