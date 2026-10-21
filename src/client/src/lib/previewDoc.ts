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

// The sandboxed frame has an opaque origin, so touching localStorage/sessionStorage
// throws a SecurityError. That breaks Eruda (it keeps settings there) and many user
// snippets, so swap in non-persistent in-memory stores.
// Kept on one line: with the console off it is prefixed to the user's script, and
// sharing that line keeps the user's line numbers in error messages unchanged.
const STORAGE_SHIM =
  '(function(){function mem(){var d=Object.create(null);return{get length(){return Object.keys(d).length},' +
  'key:function(i){var k=Object.keys(d);return i<k.length?k[i]:null},' +
  'getItem:function(k){k=String(k);return k in d?d[k]:null},' +
  'setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},' +
  'clear:function(){d=Object.create(null)}}}' +
  "['localStorage','sessionStorage'].forEach(function(n){try{window[n].length;return}catch(e){}" +
  'try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(e){}})})();';

const ERUDA_INIT = [
  'if (window.eruda) {',
  '  eruda.init({',
  '    useShadowDom: true,',
  '    autoScale: true,',
  // The default Info tool embeds an image from opencollective.com; omit it so the preview stays offline.
  "    tool: ['console', 'elements', 'network', 'resources', 'sources', 'snippets'],",
  "    defaults: { displaySize: 50, transparency: 0.9, theme: 'Monokai Pro' }",
  '  });',
  '  eruda.show();',
  '}',
].join('\n');

/** Builds the full document rendered inside the sandboxed preview frame. Pure: no DOM access. */
export function buildPreviewDocument({ html, css, js, console }: PreviewInput): string {
  // Eruda needs the shim before it loads; otherwise it rides along in the user's script tag.
  const consoleTags = console
    ? `<script>${STORAGE_SHIM}</script><script src="${ERUDA_PATH}"></script><script>${ERUDA_INIT}</script>`
    : '';
  const userScript = (console ? '' : STORAGE_SHIM) + escapeScript(js);
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>${escapeStyle(css)}</style>` +
    consoleTags +
    `</head><body>${html}<script>${userScript}</script></body></html>`
  );
}
