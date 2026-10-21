import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snippet, SnippetInput } from '../../../shared/api.ts';
import { clearDraft, loadDraft, pruneDrafts, saveDraft } from '../lib/drafts.ts';
import type { Draft } from '../lib/drafts.ts';
import { sameContent } from './useSnippetEditor.ts';
import type { EditorState } from './useSnippetEditor.ts';

const WRITE_DELAY_MS = 1000;

export interface DraftOffer {
  shareId: string;
  draft: Draft;
  /** the snippet changed on the server after this draft was started */
  stale: boolean;
}

function toDraft(state: EditorState): Draft {
  return {
    title: state.title,
    html: state.html,
    css: state.css,
    js: state.js,
    savedAt: Date.now(),
    baseUpdatedAt: state.current?.updatedAt ?? null,
  };
}

function contentOf(d: SnippetInput): SnippetInput {
  return { title: d.title, html: d.html, css: d.css, js: d.js };
}

/**
 * Autosaves unsaved edits to localStorage and decides what to do with a draft
 * when a snippet is opened.
 */
export function useLocalDraft(state: EditorState) {
  const [offer, setOffer] = useState<DraftOffer | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const offerRef = useRef(offer);
  offerRef.current = offer;

  useEffect(() => {
    pruneDrafts();
  }, []);

  // Debounced write of dirty content.
  useEffect(() => {
    if (!state.dirty) return;
    const id = window.setTimeout(() => {
      saveDraft(state.current?.shareId ?? null, toDraft(state));
    }, WRITE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  // Flush immediately on unload so the last second of typing isn't lost.
  useEffect(() => {
    const onBeforeUnload = () => {
      const s = stateRef.current;
      if (s.dirty) saveDraft(s.current?.shareId ?? null, toDraft(s));
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /** For a new snippet: the draft to restore automatically, if any. */
  const takeNewDraft = useCallback((): SnippetInput | null => {
    setOffer(null);
    const draft = loadDraft(null);
    return draft ? contentOf(draft) : null;
  }, []);

  /** For a loaded snippet: offer its draft via the banner when it differs from the server copy. */
  const checkLoaded = useCallback((snippet: Snippet) => {
    const draft = loadDraft(snippet.shareId);
    if (!draft) {
      setOffer(null);
      return;
    }
    if (sameContent(contentOf(draft), contentOf(snippet))) {
      clearDraft(snippet.shareId);
      setOffer(null);
      return;
    }
    const serverTime = Date.parse(snippet.updatedAt);
    const baseTime = draft.baseUpdatedAt ? Date.parse(draft.baseUpdatedAt) : Number.NaN;
    const stale = !Number.isNaN(serverTime) && (Number.isNaN(baseTime) || serverTime > baseTime);
    setOffer({ shareId: snippet.shareId, draft, stale });
  }, []);

  const dismissOffer = useCallback(() => setOffer(null), []);

  const discardOffer = useCallback(() => {
    if (offerRef.current) clearDraft(offerRef.current.shareId);
    setOffer(null);
  }, []);

  const clear = useCallback((shareId: string | null) => {
    clearDraft(shareId);
    if (offerRef.current?.shareId === shareId) setOffer(null);
  }, []);

  return { offer, takeNewDraft, checkLoaded, dismissOffer, discardOffer, clear };
}
