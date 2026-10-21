const SHARE = 'share';
const COLLECTION = 'collection';

const param = (name: string): string | null => new URLSearchParams(window.location.search).get(name) || null;

export function readShareId(): string | null {
  return param(SHARE);
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

function pathFor(shareId: string | null): string {
  return shareId ? `/?${SHARE}=${encodeURIComponent(shareId)}` : '/';
}

function push(next: string): void {
  if (window.location.pathname + window.location.search === next) return;
  window.history.pushState(null, '', next);
}

export function pushShareId(shareId: string | null): void {
  push(pathFor(shareId));
}

export function replaceShareId(shareId: string | null): void {
  window.history.replaceState(null, '', pathFor(shareId));
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
