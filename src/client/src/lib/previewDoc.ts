import { ERUDA_PATH } from '../../../shared/constants.ts';

export interface PreviewInput {
  html: string;
  css: string;
  js: string;
  console: boolean;
}

// A literal closing tag inside user code would terminate our wrapper element early.
function escapeStyle(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

function escapeScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

const ERUDA_INIT = [
  'if (window.eruda) {',
  '  eruda.init({',
  '    useShadowDom: true,',
  '    autoScale: true,',
  "    defaults: { displaySize: 50, transparency: 0.9, theme: 'Monokai Pro' }",
  '  });',
  '  eruda.show();',
  '}',
].join('\n');

/** Builds the full document rendered inside the sandboxed preview frame. Pure: no DOM access. */
export function buildPreviewDocument({ html, css, js, console }: PreviewInput): string {
  const consoleTags = console
    ? `<script src="${ERUDA_PATH}"></script><script>${ERUDA_INIT}</script>`
    : '';
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>${escapeStyle(css)}</style>` +
    consoleTags +
    `</head><body>${html}<script>${escapeScript(js)}</script></body></html>`
  );
}
