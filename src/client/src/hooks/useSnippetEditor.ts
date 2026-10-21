import { useReducer } from 'react';
import type { Snippet, SnippetInput, Visibility } from '../../../shared/api.ts';
import { DEFAULT_VISIBILITY } from '../../../shared/constants.ts';
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
  /** visibility as stored on the server */
  visibility: Visibility;
}

export interface EditorState extends SnippetInput {
  visibility: Visibility;
  current: CurrentSnippet | null;
  /** content differs from what was last loaded or saved */
  dirty: boolean;
}

export type EditorAction =
  | { type: 'edit'; field: CodeField | 'title'; value: string }
  | { type: 'visibility'; value: Visibility }
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

const visibilityOf = (v: SnippetInput) => v.visibility ?? DEFAULT_VISIBILITY;

export function sameContent(a: SnippetInput, b: SnippetInput): boolean {
  return (
    a.title === b.title && a.html === b.html && a.css === b.css && a.js === b.js && visibilityOf(a) === visibilityOf(b)
  );
}

export function toCurrent(snippet: Snippet): CurrentSnippet {
  return {
    shareId: snippet.shareId,
    title: snippet.title,
    isOwner: snippet.isOwner,
    forkedFrom: snippet.forkedFrom,
    updatedAt: snippet.updatedAt,
    visibility: snippet.visibility,
  };
}

function initialState(): EditorState {
  return { ...DEFAULT_SNIPPET, visibility: DEFAULT_VISIBILITY, current: null, dirty: false };
}

function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'edit':
      if (state[action.field] === action.value) return state;
      return { ...state, [action.field]: action.value, dirty: true };
    case 'visibility':
      if (state.visibility === action.value) return state;
      return { ...state, visibility: action.value, dirty: true };
    case 'load': {
      const { title, html, css, js } = action.content ?? action.snippet;
      return {
        title,
        html,
        css,
        js,
        visibility: action.content?.visibility ?? action.snippet.visibility,
        current: toCurrent(action.snippet),
        dirty: action.content !== undefined,
      };
    }
    case 'meta':
      return { ...state, current: action.current };
    case 'restore':
      return { ...state, ...action.content, visibility: action.content.visibility ?? state.visibility, dirty: true };
    case 'reset':
      return action.content
        ? { ...action.content, visibility: visibilityOf(action.content), current: null, dirty: true }
        : initialState();
    case 'saved': {
      const current = toCurrent(action.snippet);
      // The user may have kept typing while the request was in flight; keep those edits.
      if (!sameContent(state, action.sent)) return { ...state, current, dirty: true };
      // Adopt the server's normalized title (trimmed, "Untitled" when empty).
      return { ...state, title: action.snippet.title, visibility: action.snippet.visibility, current, dirty: false };
    }
  }
}

export function useSnippetEditor() {
  return useReducer(reducer, undefined, initialState);
}
