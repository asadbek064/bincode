// Unlock tokens for password-protected bins and collections. sessionStorage keeps them to this tab:
// closing it forgets the unlock, which is the point of a password gate.

export type UnlockKind = 'snippet' | 'collection';

interface StoredToken {
  token: string;
  expiresAt: string;
}

const key = (kind: UnlockKind, shareId: string) => `bincode:unlock:${kind}:${shareId}`;

export function getUnlockToken(kind: UnlockKind, shareId: string | null): string | null {
  if (!shareId) return null;
  try {
    const raw = window.sessionStorage.getItem(key(kind, shareId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof value.token !== 'string' || typeof value.expiresAt !== 'string') return null;
    if (Date.parse(value.expiresAt) <= Date.now()) {
      forgetUnlockToken(kind, shareId);
      return null;
    }
    return value.token;
  } catch {
    return null;
  }
}

export function saveUnlockToken(kind: UnlockKind, shareId: string, value: StoredToken): void {
  try {
    window.sessionStorage.setItem(key(kind, shareId), JSON.stringify(value));
  } catch {
    // Storage unavailable: the unlock still works until the page is reloaded.
  }
}

export function forgetUnlockToken(kind: UnlockKind, shareId: string): void {
  try {
    window.sessionStorage.removeItem(key(kind, shareId));
  } catch {
    // ignore
  }
}
