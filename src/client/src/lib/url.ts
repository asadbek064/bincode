const PARAM = 'share';

export function readShareId(): string | null {
  const value = new URLSearchParams(window.location.search).get(PARAM);
  return value ? value : null;
}

export function shareUrl(shareId: string): string {
  return `${window.location.origin}/?${PARAM}=${encodeURIComponent(shareId)}`;
}

function pathFor(shareId: string | null): string {
  return shareId ? `/?${PARAM}=${encodeURIComponent(shareId)}` : '/';
}

export function pushShareId(shareId: string | null): void {
  const next = pathFor(shareId);
  if (window.location.pathname + window.location.search === next) return;
  window.history.pushState(null, '', next);
}

export function replaceShareId(shareId: string | null): void {
  window.history.replaceState(null, '', pathFor(shareId));
}

/** Calls back with the shareId in the URL after browser back/forward. */
export function onShareIdChange(callback: (shareId: string | null) => void): () => void {
  const handler = () => callback(readShareId());
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}
