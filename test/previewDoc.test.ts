import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ERUDA_PATH } from '../src/shared/constants.ts';
import { buildPreviewDocument } from '../src/client/src/lib/previewDoc.ts';

const base = { html: '', css: '', js: '', console: false };

test('places html in the body', () => {
  const doc = buildPreviewDocument({ ...base, html: '<h1 id="x">Hi</h1>' });
  assert.match(doc, /<body>[\s\S]*<h1 id="x">Hi<\/h1>[\s\S]*<\/body>/);
});

test('escapes closing script tags in js', () => {
  const doc = buildPreviewDocument({ ...base, js: 'const s = "</script><b>boom</b>"; const t = "</SCRIPT >";' });
  assert.doesNotMatch(doc.slice(0, doc.lastIndexOf('</script>')), /<\/script/i);
  assert.equal(doc.match(/<\/script>/gi)?.length, 1);
});

test('escapes closing style tags in css', () => {
  const doc = buildPreviewDocument({ ...base, css: 'a{} </style><script>evil()</script> </STYLE>' });
  assert.equal(doc.match(/<\/style/gi)?.length, 1);
});

test('includes eruda only when the console is enabled', () => {
  assert.ok(!buildPreviewDocument(base).includes(ERUDA_PATH));
  assert.ok(buildPreviewDocument({ ...base, console: true }).includes(`src="${ERUDA_PATH}"`));
});
