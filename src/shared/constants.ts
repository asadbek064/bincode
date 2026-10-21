export const LIMITS = {
  titleMax: 200,
  /** combined character length of html + css + js */
  codeMax: 500_000,
  emailMax: 254,
  passwordMax: 200,
  newPasswordMin: 8,
} as const;

export const SHARE_ID_LENGTH = 10;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{10}$/;
export const DEFAULT_TITLE = 'Untitled';

export const PREVIEW_PATH = '/preview.html';
export const ERUDA_PATH = '/vendor/eruda.min.js';

/** postMessage protocol between the app and the sandboxed preview frame */
export const PREVIEW_READY = 'bincode:ready';
export const PREVIEW_RENDER = 'bincode:render';
