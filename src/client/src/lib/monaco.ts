// Only the editor core plus the three languages we edit; the full 'monaco-editor'
// entry pulls in ~80 grammars and the JSON service we never use.
import 'monaco-editor/esm/vs/editor/edcore.main.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/language/html/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/css/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

// Bundled workers instead of @monaco-editor/react's default CDN loader, so the
// editor works offline and under a `script-src 'self'` CSP.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'css':
        return new CssWorker();
      case 'html':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

loader.config({ monaco });

export const LIGHT_THEME = 'bincode-light';
export const DARK_THEME = 'bincode-dark';

let themesDefined = false;

/**
 * Registers our themes on the bundled monaco instance (the one handed to the loader
 * above, so <Editor> sees them). Runs at module load; the guard makes repeat calls
 * (e.g. from beforeMount) free.
 */
export function defineThemes(): void {
  if (themesDefined) return;
  themesDefined = true;
  // Theme rules match token prefixes, so 'tag' covers 'tag.html' and the CSS
  // selectors ('tag.css'); 'string' covers 'string.js' / 'string.css'. HTML
  // attribute values are 'attribute.value.html' (quotes included), but CSS also
  // uses 'attribute.value.css' for property values, so only the HTML one is green.
  monaco.editor.defineTheme(LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '334155' },
      { token: 'tag', foreground: '1D4ED8' },
      { token: 'metatag', foreground: '1D4ED8' },
      { token: 'metatag.content', foreground: '1D4ED8' },
      { token: 'attribute.name', foreground: '4338CA' },
      { token: 'attribute.value.html', foreground: '047857' },
      { token: 'string', foreground: '047857' },
      { token: 'comment', foreground: '5B6B7F' },
    ],
    // Hex copies of the styles.css tokens (Monaco can't read CSS variables): --bg, --surface, --text-muted.
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#334155',
      'editorLineNumber.foreground': '#8592A6',
      'editorLineNumber.activeForeground': '#334155',
      'editor.lineHighlightBackground': '#F8FAFC',
      'editor.lineHighlightBorder': '#F8FAFC',
      'editorGutter.background': '#FFFFFF',
    },
  });
  // The light theme's hues, lifted for a slate-900 background (all ≥ 6:1).
  monaco.editor.defineTheme(DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'CBD5E1' },
      { token: 'tag', foreground: '93C5FD' },
      { token: 'metatag', foreground: '93C5FD' },
      { token: 'metatag.content', foreground: '93C5FD' },
      { token: 'attribute.name', foreground: 'A5B4FC' },
      { token: 'attribute.value.html', foreground: '6EE7B7' },
      { token: 'string', foreground: '6EE7B7' },
      { token: 'comment', foreground: '94A3B8' },
    ],
    colors: {
      'editor.background': '#0F172A',
      'editor.foreground': '#CBD5E1',
      'editorGutter.background': '#0F172A',
      'editorLineNumber.foreground': '#64748B',
      'editorLineNumber.activeForeground': '#CBD5E1',
      'editor.lineHighlightBackground': '#1E293B',
      'editor.lineHighlightBorder': '#1E293B',
    },
  });
}

defineThemes();

export { monaco };
