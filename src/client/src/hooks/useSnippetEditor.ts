import { useReducer } from 'react';
import type { Snippet, SnippetInput } from '../../../shared/api.ts';
import { DEFAULT_SNIPPET } from '../lib/template.ts';

export const CODE_FIELDS = ['html', 'css', 'js'] as const;
export type CodeField = (typeof CODE_FIELDS)[number];

export interface CurrentSnippet {
  shareId: string;
  /** title as stored on the server */
  title: string;
  isOwner: boolean;
  forkedFrom: string | null;
  updatedAt: string;
}

export interface EditorState extends SnippetInput {
  current: CurrentSnippet | null;
  /** content differs from what was last loaded or saved */
  dirty: boolean;
}

export type EditorAction =
  | { type: 'edit'; field: CodeField | 'title'; value: string }
  /** load a server snippet; `content` overrides it (e.g. a restored draft) */
  | { type: 'load'; snippet: Snippet; content?: SnippetInput }
  /** replace content in place, keeping the current snippet (restoring a draft) */
  | { type: 'restore'; content: SnippetInput }
  /** start a new snippet, optionally from given content */
  | { type: 'reset'; content?: SnippetInput }
  /** update snippet metadata (e.g. ownership after login/logout) without touching content */
  | { type: 'meta'; current: CurrentSnippet | null }
  /** `sent` is the content that was submitted, to detect edits made meanwhile */
  | { type: 'saved'; snippet: Snippet; sent: SnippetInput };

export function sameContent(a: SnippetInput, b: SnippetInput): boolean {
  return a.title === b.title && a.html === b.html && a.css === b.css && a.js === b.js;
}

export function toCurrent(snippet: Snippet): CurrentSnippet {
  return {
    shareId: snippet.shareId,
    title: snippet.title,
    isOwner: snippet.isOwner,
    forkedFrom: snippet.forkedFrom,
    updatedAt: snippet.updatedAt,
  };
}

function initialState(): EditorState {
  return { ...DEFAULT_SNIPPET, current: null, dirty: false };
}

function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'edit':
      if (state[action.field] === action.value) return state;
      return { ...state, [action.field]: action.value, dirty: true };
    case 'load': {
      const { title, html, css, js } = action.content ?? action.snippet;
      return {
        title,
        html,
        css,
        js,
        current: toCurrent(action.snippet),
        dirty: action.content !== undefined,
      };
    }
    case 'meta':
      return { ...state, current: action.current };
    case 'restore':
      return { ...state, ...action.content, dirty: true };
    case 'reset':
      return action.content
        ? { ...action.content, current: null, dirty: true }
        : initialState();
    case 'saved': {
      const current = toCurrent(action.snippet);
      // The user may have kept typing while the request was in flight; keep those edits.
      if (!sameContent(state, action.sent)) return { ...state, current, dirty: true };
      // Adopt the server's normalized title (trimmed, "Untitled" when empty).
      return { ...state, title: action.snippet.title, current, dirty: false };
    }
  }
}

export function useSnippetEditor() {
  return useReducer(reducer, undefined, initialState);
}
