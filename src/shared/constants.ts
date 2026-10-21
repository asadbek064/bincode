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

/** unlisted: anyone with the link can view. private: only the owner (or via an unlocked collection). */
export const VISIBILITIES = ['unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const DEFAULT_VISIBILITY: Visibility = 'unlisted';

/** Request header carrying a collection unlock token (separate from the user's Bearer token). */
export const COLLECTION_TOKEN_HEADER = 'X-Collection-Token';

export const SHARE_ID_LENGTH = 10;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{10}$/;
export const DEFAULT_TITLE = 'Untitled';

export const PREVIEW_PATH = '/preview.html';
export const ERUDA_PATH = '/vendor/eruda.min.js';

/** postMessage protocol between the app and the sandboxed preview frame */
export const PREVIEW_READY = 'bincode:ready';
export const PREVIEW_RENDER = 'bincode:render';
