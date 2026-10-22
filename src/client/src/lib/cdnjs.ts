// CDNJS library search (https://api.cdnjs.com, free, no auth) and the tags we insert for a result.
// No DOM imports: it is imported by a server-side test (test/cdnjs.test.ts), so it must stay DOM-free.

const CDNJS_API = 'https://api.cdnjs.com/libraries';
const CDN_ORIGIN = 'https://cdnjs.cloudflare.com/';
const DESCRIPTION_MAX = 200;
const SEARCH_LIMIT = 15;

export interface CdnLibrary {
  name: string;
  version: string;
  description: string;
  /** default file of the latest version on cdnjs.cloudflare.com */
  url: string;
  /** subresource integrity hash for `url`, when CDNJS could compute one */
  sri: string | null;
}

export function searchUrl(query: string): string {
  const params = new URLSearchParams({
    search: query,
    fields: 'version,description,sri',
    limit: String(SEARCH_LIMIT),
  });
  return `${CDNJS_API}?${params}`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Maps the API response defensively: it comes from a third party, so anything malformed is dropped
 * and only files actually served from the CDNJS origin are offered.
 */
export function parseResults(body: unknown): CdnLibrary[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: CdnLibrary[] = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const name = str(rec.name).trim();
    const url = str(rec.latest);
    if (!name || !url.startsWith(CDN_ORIGIN)) continue;
    const description = str(rec.description).replace(/\s+/g, ' ').trim();
    const sri = str(rec.sri);
    out.push({
      name,
      version: str(rec.version),
      description: description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 1)}…` : description,
      url,
      sri: /^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(sri) ? sri : null,
    });
  }
  return out;
}

const cache = new Map<string, CdnLibrary[]>();
const cacheKey = (query: string) => query.toLowerCase();

/** Results of an earlier identical search, if any, so the UI can show them without a loading state. */
export function cachedLibraries(query: string): CdnLibrary[] | undefined {
  return cache.get(cacheKey(query));
}

/** Searches CDNJS (callers pass a trimmed, non-empty query); results are cached per query for the session. */
export async function searchLibraries(query: string, signal?: AbortSignal): Promise<CdnLibrary[]> {
  const q = cacheKey(query);
  const hit = cache.get(q);
  if (hit) return hit;
  const res = await fetch(searchUrl(q), { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CDNJS answered ${res.status}`);
  const libs = parseResults(await res.json());
  cache.set(q, libs);
  return libs;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A `<link>` for stylesheets, a `<script>` for everything else, pinned with SRI when available. */
export function tagFor(lib: Pick<CdnLibrary, 'url' | 'sri'>): string {
  const isCss = new URL(lib.url).pathname.toLowerCase().endsWith('.css');
  const integrity = lib.sri ? ` integrity="${escapeAttr(lib.sri)}"` : '';
  const common = `${integrity} crossorigin="anonymous" referrerpolicy="no-referrer"`;
  const url = escapeAttr(lib.url);
  return isCss ? `<link rel="stylesheet" href="${url}"${common}>` : `<script src="${url}"${common}></script>`;
}

/** Prepends the library's tag to the HTML panel unless its URL is already referenced there. */
export function insertTag(html: string, lib: Pick<CdnLibrary, 'url' | 'sri'>): { html: string; added: boolean } {
  if (html.includes(lib.url) || html.includes(escapeAttr(lib.url))) return { html, added: false };
  return { html: `${tagFor(lib)}\n${html}`, added: true };
}
