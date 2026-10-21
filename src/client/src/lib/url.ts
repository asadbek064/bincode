const SHARE = 'share';
/** collection a snippet was opened from, so its unlock token is sent along */
const VIA = 'c';
const COLLECTION = 'collection';

const param = (name: string): string | null => new URLSearchParams(window.location.search).get(name) || null;

export function readShareId(): string | null {
  return param(SHARE);
}

export function readViaCollection(): string | null {
  return param(SHARE) ? param(VIA) : null;
}

/** shareId of a collection link (`/?collection=…`), when no snippet is open. */
export function readCollectionId(): string | null {
  return param(SHARE) ? null : param(COLLECTION);
}

export function shareUrl(shareId: string): string {
  return `${window.location.origin}/?${SHARE}=${encodeURIComponent(shareId)}`;
}

export function collectionUrl(shareId: string): string {
  return `${window.location.origin}/?${COLLECTION}=${encodeURIComponent(shareId)}`;
}

function pathFor(shareId: string | null, via?: string | null): string {
  if (!shareId) return '/';
  const viaPart = via ? `&${VIA}=${encodeURIComponent(via)}` : '';
  return `/?${SHARE}=${encodeURIComponent(shareId)}${viaPart}`;
}

function push(next: string): void {
  if (window.location.pathname + window.location.search === next) return;
  window.history.pushState(null, '', next);
}

export function pushShareId(shareId: string | null, via?: string | null): void {
  push(pathFor(shareId, via));
}

export function replaceShareId(shareId: string | null, via?: string | null): void {
  window.history.replaceState(null, '', pathFor(shareId, via));
}

export function pushCollectionId(shareId: string): void {
  push(`/?${COLLECTION}=${encodeURIComponent(shareId)}`);
}

/** Calls back with the shareId in the URL after browser back/forward. */
export function onShareIdChange(callback: (shareId: string | null) => void): () => void {
  const handler = () => callback(readShareId());
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}
