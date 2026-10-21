export const LIMITS = {
  titleMax: 200,
  /** combined character length of html + css + js */
  codeMax: 500_000,
  emailMax: 254,
  passwordMax: 200,
  newPasswordMin: 8,
  descriptionMax: 1000,
  collectionPasswordMin: 8,
} as const;

/**
 * Who can read a bin. This alone decides; collections never grant access to a bin.
 * unlisted: anyone with the link. password: the link plus the bin's password. private: only the owner.
 */
export const VISIBILITIES = ['unlisted', 'password', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const DEFAULT_VISIBILITY: Visibility = 'unlisted';

/** Expiration choices offered to users, in milliseconds; 'never' clears the expiry. */
export const EXPIRATIONS = {
  never: 0,
  '10m': 10 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  '1m': 30 * 24 * 60 * 60_000,
} as const;
export type Expiration = keyof typeof EXPIRATIONS;
export const EXPIRATION_KEYS = Object.keys(EXPIRATIONS) as Expiration[];

/** Request header carrying an unlock token for a password-protected bin or collection. */
export const UNLOCK_TOKEN_HEADER = 'X-Unlock-Token';

export const SHARE_ID_LENGTH = 10;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{10}$/;
export const DEFAULT_TITLE = 'Untitled';

export const PREVIEW_PATH = '/preview.html';
export const ERUDA_PATH = '/vendor/eruda.min.js';

/** postMessage protocol between the app and the sandboxed preview frame */
export const PREVIEW_READY = 'bincode:ready';
export const PREVIEW_RENDER = 'bincode:render';
