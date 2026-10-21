import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SnippetInput } from '../../shared/api.ts';
import { DEFAULT_TITLE } from '../../shared/constants.ts';
import { DraftBanner } from './components/DraftBanner.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { PreviewPane } from './components/PreviewPane.tsx';
import { ShareModal } from './components/ShareModal.tsx';
import { SnippetsDashboard } from './components/SnippetsDashboard.tsx';
import { SplitPane } from './components/SplitPane.tsx';
import { Toast } from './components/Toast.tsx';
import type { ToastMessage } from './components/Toast.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { useAuth } from './hooks/useAuth.tsx';
import { useColorScheme } from './hooks/useColorScheme.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { useLocalDraft } from './hooks/useLocalDraft.ts';
import { CODE_FIELDS, toCurrent, useSnippetEditor } from './hooks/useSnippetEditor.ts';
import type { CodeField } from './hooks/useSnippetEditor.ts';
import * as api from './lib/api.ts';
import { ApiError } from './lib/api.ts';
import { onShareIdChange, pushShareId, readShareId, replaceShareId, shareUrl } from './lib/url.ts';

// Monaco is ~3MB; loading it lazily lets the toolbar and preview paint first.
const EditorPane = lazy(() => import('./components/EditorPane.tsx'));

type ModalState = { type: 'login' } | { type: 'share'; url: string } | { type: 'snippets' } | null;

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

class EditorErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div className="editor-loading">The editor failed to load. Reload the page to try again.</div>;
    }
    return this.props.children;
  }
}

export function App() {
  const { user, logout } = useAuth();
  const [state, dispatch] = useSnippetEditor();
  const drafts = useLocalDraft(state);
  const dark = useColorScheme() === 'dark';

  const [activeTab, setActiveTab] = useState<CodeField>('html');
  const [showEditor, setShowEditor] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showConsole, setShowConsole] = useState(false);
  const [paused, setPaused] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const savingRef = useRef(false);
  const loadSeq = useRef(0);
  const afterLogin = useRef<(() => void) | null>(null);

  const notify = useCallback((kind: ToastMessage['kind'], text: string) => {
    setToast({ id: Date.now(), kind, text });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const startNew = useCallback(
    (restoreDraft: boolean) => {
      loadSeq.current++;
      setLoading(false);
      const content = restoreDraft ? drafts.takeNewDraft() : null;
      if (!restoreDraft) drafts.dismissOffer();
      dispatch({ type: 'reset', content: content ?? undefined });
    },
    [dispatch, drafts],
  );

  const openSnippet = useCallback(
    async (shareId: string | null) => {
      if (!shareId) {
        startNew(true);
        return;
      }
      const seq = ++loadSeq.current;
      setLoading(true);
      try {
        let snippet;
        try {
          snippet = await api.getSnippet(shareId);
        } catch (err) {
          // A stale token gets us logged out by the 401 handler; retry anonymously.
          if (err instanceof ApiError && err.status === 401) snippet = await api.getSnippet(shareId);
          else throw err;
        }
        if (seq !== loadSeq.current) return;
        dispatch({ type: 'load', snippet });
        drafts.checkLoaded(snippet);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
          notify('error', 'That snippet does not exist or was deleted.');
          replaceShareId(null);
          startNew(true);
        } else {
          notify('error', `Could not load the snippet: ${errorMessage(err, 'unknown error')}`);
        }
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [dispatch, drafts, notify, startNew],
  );

  const openRef = useRef(openSnippet);
  openRef.current = openSnippet;
  const flushRef = useRef(drafts.flush);
  flushRef.current = drafts.flush;

  // Initial load and browser back/forward. Mount-only, hence the refs.
  useEffect(() => {
    void openRef.current(readShareId());
    return onShareIdChange((shareId) => {
      flushRef.current();
      void openRef.current(shareId);
    });
  }, []);

  useEffect(() => {
    document.title = `${state.title.trim() || DEFAULT_TITLE} - BinCode`;
  }, [state.title]);

  const save = useCallback(
    async (forceFork = false) => {
      if (savingRef.current) return;
      if (!api.getAuthToken()) {
        afterLogin.current = () => void save(forceFork);
        setModal({ type: 'login' });
        return;
      }
      const s = stateRef.current;
      const sent: SnippetInput = { title: s.title, html: s.html, css: s.css, js: s.js };
      const current = s.current;
      savingRef.current = true;
      setSaving(true);
      try {
        if (current && current.isOwner && !forceFork) {
          const snippet = await api.updateSnippet(current.shareId, sent);
          dispatch({ type: 'saved', snippet, sent });
          drafts.clear(current.shareId);
          notify('success', 'Saved');
        } else {
          // Leave the title out of an unrenamed fork so the server names it "… (fork)".
          const forkInput = current && s.title === current.title ? { html: s.html, css: s.css, js: s.js } : sent;
          const snippet = current
            ? await api.forkSnippet(current.shareId, forkInput)
            : await api.createSnippet(sent);
          dispatch({ type: 'saved', snippet, sent });
          drafts.clear(current ? current.shareId : null);
          pushShareId(snippet.shareId);
          setModal({ type: 'share', url: shareUrl(snippet.shareId) });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          afterLogin.current = () => void save(forceFork);
          setModal({ type: 'login' });
          notify('error', 'Your session expired. Please log in again.');
        } else if (err instanceof ApiError && err.status === 404 && current) {
          notify('error', 'This snippet no longer exists. Save again to create a new one.');
          dispatch({ type: 'meta', current: null });
          replaceShareId(null);
        } else {
          notify('error', `Save failed: ${errorMessage(err, 'unknown error')}`);
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [dispatch, drafts, notify],
  );

  const onLoginSuccess = useCallback(async () => {
    setModal(null);
    // Ownership was computed for an anonymous viewer; refresh it before saving.
    const current = stateRef.current.current;
    if (current) {
      try {
        const snippet = await api.getSnippet(current.shareId);
        if (stateRef.current.current?.shareId === snippet.shareId) {
          dispatch({ type: 'meta', current: toCurrent(snippet) });
          stateRef.current = { ...stateRef.current, current: toCurrent(snippet) };
        }
      } catch {
        // Keep the stale metadata; saving will surface any real problem.
      }
    }
    const pending = afterLogin.current;
    afterLogin.current = null;
    pending?.();
  }, [dispatch]);

  const onLogout = useCallback(() => {
    logout();
    const current = stateRef.current.current;
    if (current) dispatch({ type: 'meta', current: { ...current, isOwner: false } });
    setModal(null);
  }, [dispatch, logout]);

  const onNew = useCallback(() => {
    const s = stateRef.current;
    if (!s.current && s.dirty && !window.confirm('Discard your unsaved snippet and start a new one?')) return;
    if (s.current) drafts.flush();
    else drafts.clear(null);
    pushShareId(null);
    startNew(false);
  }, [drafts, startNew]);

  const navigateTo = useCallback(
    (shareId: string) => {
      setModal(null);
      if (stateRef.current.current?.shareId === shareId) return;
      drafts.flush();
      pushShareId(shareId);
      void openSnippet(shareId);
    },
    [drafts, openSnippet],
  );

  const onDeleted = useCallback(
    (shareId: string) => {
      drafts.clear(shareId);
      if (stateRef.current.current?.shareId === shareId) {
        replaceShareId(null);
        startNew(false);
      }
      notify('success', 'Snippet deleted');
    },
    [drafts, notify, startNew],
  );

  const onEdit = useCallback(
    (field: CodeField | 'title', value: string) => dispatch({ type: 'edit', field, value }),
    [dispatch],
  );

  const selectTab = useCallback((tab: CodeField) => {
    setActiveTab(tab);
    setShowEditor(true);
  }, []);

  useKeyboardShortcuts({
    onSave: () => {
      if (!modal) void save();
    },
    onTab: (index) => {
      const tab = CODE_FIELDS[index];
      if (tab && !modal) selectTab(tab);
    },
  });

  const code = useMemo(
    () => ({ html: state.html, css: state.css, js: state.js }),
    [state.html, state.css, state.js],
  );

  const current = state.current;
  const saveMode = !current ? 'save' : current.isOwner ? 'update' : 'fork';

  return (
    <div className="app">
      <Toolbar
        user={user}
        title={state.title}
        onTitleChange={(title) => onEdit('title', title)}
        dirty={state.dirty}
        saveMode={saveMode}
        canFork={!!current?.isOwner}
        saving={saving}
        showEditor={showEditor}
        showPreview={showPreview}
        showConsole={showConsole}
        paused={paused}
        onToggleEditor={() => setShowEditor((v) => !v || !showPreview)}
        onTogglePreview={() => setShowPreview((v) => !v || !showEditor)}
        onToggleConsole={() => setShowConsole((v) => !v)}
        onTogglePaused={() => setPaused((v) => !v)}
        onNew={onNew}
        onOpenSnippets={() => setModal({ type: 'snippets' })}
        onSave={() => void save()}
        onFork={() => void save(true)}
        onLogin={() => setModal({ type: 'login' })}
        onLogout={onLogout}
      />

      {loading && <div className="loading-bar" role="progressbar" aria-label="Loading snippet" />}

      {drafts.offer && (
        <DraftBanner
          offer={drafts.offer}
          onRestore={() => {
            const { title, html, css, js } = drafts.offer!.draft;
            dispatch({ type: 'restore', content: { title, html, css, js } });
            drafts.dismissOffer();
          }}
          onDiscard={drafts.discardOffer}
        />
      )}

      <main className="workspace">
        <SplitPane
          showFirst={showEditor}
          showSecond={showPreview}
          first={
            <EditorErrorBoundary>
              <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
                <EditorPane
                  activeTab={activeTab}
                  onTabChange={selectTab}
                  values={code}
                  onChange={onEdit}
                  onSave={() => void save()}
                  dark={dark}
                />
              </Suspense>
            </EditorErrorBoundary>
          }
          second={<PreviewPane code={code} console={showConsole} paused={paused} />}
        />
      </main>

      {modal?.type === 'login' && (
        <LoginModal
          onClose={() => {
            afterLogin.current = null;
            setModal(null);
          }}
          onSuccess={() => void onLoginSuccess()}
        />
      )}
      {modal?.type === 'share' && <ShareModal url={modal.url} onClose={() => setModal(null)} />}
      {modal?.type === 'snippets' && (
        <SnippetsDashboard
          currentShareId={current?.shareId ?? null}
          onOpen={navigateTo}
          onDeleted={onDeleted}
          onClose={() => setModal(null)}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
