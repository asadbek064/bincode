// Unlock tokens for password-protected collections. sessionStorage keeps them to this tab:
// closing it forgets the unlock, which is the point of a password gate.

const PREFIX = 'bincode:ctok:';

interface StoredToken {
  token: string;
  expiresAt: string;
}

export function getCollectionToken(collectionShareId: string | null): string | null {
  if (!collectionShareId) return null;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + collectionShareId);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof value.token !== 'string' || typeof value.expiresAt !== 'string') return null;
    if (Date.parse(value.expiresAt) <= Date.now()) {
      forgetCollectionToken(collectionShareId);
      return null;
    }
    return value.token;
  } catch {
    return null;
  }
}

export function saveCollectionToken(collectionShareId: string, value: StoredToken): void {
  try {
    window.sessionStorage.setItem(PREFIX + collectionShareId, JSON.stringify(value));
  } catch {
    // Storage unavailable: the unlock still works until the page is reloaded.
  }
}

export function forgetCollectionToken(collectionShareId: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + collectionShareId);
  } catch {
    // ignore
  }
}
