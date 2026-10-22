import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertTag, parseResults, searchUrl, tagFor } from '../src/client/src/lib/cdnjs.ts';

const SRI = 'sha512-abc+/def==';

test('searchUrl asks CDNJS for the fields we show', () => {
  const url = new URL(searchUrl('xlsx'));
  assert.equal(url.origin + url.pathname, 'https://api.cdnjs.com/libraries');
  assert.equal(url.searchParams.get('search'), 'xlsx');
  assert.equal(url.searchParams.get('fields'), 'version,description,sri');
  assert.equal(url.searchParams.get('limit'), '15');
});

test('parseResults maps the API response and drops anything unsafe or malformed', () => {
  const libs = parseResults({
    results: [
      { name: 'xlsx', latest: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', version: '0.18.5', description: '  Excel\n parser  ', sri: SRI },
      { name: 'no-extras', latest: 'https://cdnjs.cloudflare.com/ajax/libs/x/1.0.0/x.js' },
      { name: 'evil', latest: 'https://evil.example/x.js', version: '1' },
      { name: 'bad-sri', latest: 'https://cdnjs.cloudflare.com/ajax/libs/y/1/y.js', sri: '"><script>' },
      { latest: 'https://cdnjs.cloudflare.com/ajax/libs/z/1/z.js' },
      null,
      'junk',
      { name: 'long', latest: 'https://cdnjs.cloudflare.com/ajax/libs/l/1/l.js', description: 'd'.repeat(500) },
    ],
  });
  assert.deepEqual(libs.map((l) => l.name), ['xlsx', 'no-extras', 'bad-sri', 'long']);
  assert.deepEqual(libs[0], {
    name: 'xlsx',
    version: '0.18.5',
    description: 'Excel parser',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    sri: SRI,
  });
  assert.equal(libs[1]!.description, '');
  assert.equal(libs[1]!.sri, null);
  assert.equal(libs[2]!.sri, null);
  assert.equal(libs[3]!.description.length, 200);
  for (const body of [null, {}, { results: 'x' }, 42]) assert.deepEqual(parseResults(body), []);
});

test('tagFor builds a pinned script for JS and a stylesheet link for CSS', () => {
  assert.equal(
    tagFor({ url: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', sri: SRI }),
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" integrity="${SRI}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
  );
  assert.equal(
    tagFor({ url: 'https://cdnjs.cloudflare.com/ajax/libs/bulma/1.0.0/css/bulma.min.CSS', sri: null }),
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bulma/1.0.0/css/bulma.min.CSS" crossorigin="anonymous" referrerpolicy="no-referrer">',
  );
  // A query string doesn't fool the extension check, and attributes are escaped.
  const tag = tagFor({ url: 'https://cdnjs.cloudflare.com/a.js?x=".css', sri: null });
  assert.match(tag, /^<script src="https:\/\/cdnjs\.cloudflare\.com\/a\.js\?x=&quot;\.css"/);
});

test('insertTag prepends once and never duplicates a library', () => {
  const lib = { url: 'https://cdnjs.cloudflare.com/ajax/libs/x/1/x.js', sri: null };
  const tag = tagFor(lib);
  const first = insertTag('<p>hi</p>', lib);
  assert.equal(first.added, true);
  assert.equal(first.html, `${tag}\n<p>hi</p>`);
  const again = insertTag(first.html, lib);
  assert.equal(again.added, false);
  assert.equal(again.html, first.html);
  assert.deepEqual(insertTag('', lib), { html: `${tag}\n`, added: true });
});
