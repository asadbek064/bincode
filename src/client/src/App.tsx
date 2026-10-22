import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LockedSnippet, Snippet, SnippetInput, UnlockSnippetResponse } from '../../shared/api.ts';
import { DEFAULT_TITLE } from '../../shared/constants.ts';
import { BinGate } from './components/BinGate.tsx';
import { CollectionView } from './components/CollectionView.tsx';
import { ConsoleDrawer } from './components/ConsoleDrawer.tsx';
import { DraftBanner } from './components/DraftBanner.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { PreviewPane } from './components/PreviewPane.tsx';
import { SnippetsDashboard } from './components/SnippetsDashboard.tsx';
import { SplitPane } from './components/SplitPane.tsx';
import { Toast } from './components/Toast.tsx';
import type { ToastMessage } from './components/Toast.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { useAuth } from './hooks/useAuth.tsx';
import { useColorScheme } from './hooks/useColorScheme.ts';
import { useConsoleLog } from './hooks/useConsoleLog.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { useLocalDraft } from './hooks/useLocalDraft.ts';
import { CODE_FIELDS, toCurrent, useSnippetEditor } from './hooks/useSnippetEditor.ts';
import type { CodeField } from './hooks/useSnippetEditor.ts';
import * as api from './lib/api.ts';
import { ApiError } from './lib/api.ts';
import { insertTag, type CdnLibrary } from './lib/cdnjs.ts';
import { copyText } from './lib/clipboard.ts';
import { DEFAULT_PENDING, pendingToInput, type PendingSettings } from './lib/binSettings.ts';
import { forgetUnlockToken, getUnlockToken, saveUnlockToken } from './lib/unlockTokens.ts';
import { onShareIdChange, pushShareId, readCollectionId, readShareId, replaceShareId, shareUrl } from './lib/url.ts';

// Monaco is ~3MB; loading it lazily lets the toolbar and preview paint first.
const EditorPane = lazy(() => import('./components/EditorPane.tsx'));

type ModalState =
  | { type: 'login' }
  | { type: 'snippets' }
  | { type: 'collection'; shareId: string }
  | null;

/**
 * What the workspace shows. Anything but 'editor' replaces the editor and preview, so a link to a
 * locked, missing or still-loading bin never shows the demo snippet as if it were the bin.
 */
type View = 'editor' | 'blank' | { locked: LockedSnippet } | { unavailable: string };

const NOT_AVAILABLE = "This bin doesn't exist, has expired, or is private.";

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
  // Settings for a bin that hasn't been saved yet. Kept out of the editor state so they never reach drafts.
  const [pending, setPending] = useState<PendingSettings>(DEFAULT_PENDING);
  const consoleLog = useConsoleLog();
  // Bumped to force a fresh preview run (Cmd/Ctrl+Enter), even when the code is unchanged or paused.
  const [runId, setRunId] = useState(0);
  const [view, setView] = useState<View>(() => (readShareId() || readCollectionId() ? 'blank' : 'editor'));

  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const savingRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
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
      setPending(DEFAULT_PENDING);
      dispatch({ type: 'reset', content: content ?? undefined });
      setView('editor');
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
      // Keep the current bin on screen while switching between bins; only an empty screen starts blank.
      if (!stateRef.current.current) setView('blank');
      // Reopens a password bin unlocked earlier in this tab.
      const unlockToken = getUnlockToken('snippet', shareId);
      try {
        let res;
        try {
          res = await api.getSnippet(shareId, unlockToken);
        } catch (err) {
          // A stale token gets us logged out by the 401 handler; retry anonymously.
          if (err instanceof ApiError && err.status === 401) res = await api.getSnippet(shareId, unlockToken);
          else throw err;
        }
        if (seq !== loadSeq.current) return;
        if ('locked' in res) {
          // The token no longer works (password changed or expired); the gate asks again.
          if (unlockToken) forgetUnlockToken('snippet', shareId);
          drafts.dismissOffer();
          setPending(DEFAULT_PENDING);
          dispatch({ type: 'reset' });
          setView({ locked: res });
          return;
        }
        setPending(DEFAULT_PENDING);
        dispatch({ type: 'load', snippet: res });
        drafts.checkLoaded(res);
        setView('editor');
      } catch (err) {
        if (seq !== loadSeq.current) return;
        // The URL stays, so logging in (an owner's private bin) or reloading can retry it.
        drafts.dismissOffer();
        dispatch({ type: 'reset' });
        const missing = err instanceof ApiError && (err.status === 404 || err.status === 400);
        setView({ unavailable: missing ? NOT_AVAILABLE : `Could not load the bin: ${errorMessage(err, 'unknown error')}` });
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [dispatch, drafts, startNew],
  );

  const openRef = useRef(openSnippet);
  openRef.current = openSnippet;
  const flushRef = useRef(drafts.flush);
  flushRef.current = drafts.flush;

  // Initial load and browser back/forward. Mount-only, hence the refs.
  useEffect(() => {
    const showCollection = () => {
      const collectionId = readCollectionId();
      if (collectionId) {
        setModal({ type: 'collection', shareId: collectionId });
        setView('blank');
      }
      else setModal((m) => (m?.type === 'collection' ? null : m));
    };
    void openRef.current(readShareId());
    showCollection();
    return onShareIdChange((shareId) => {
      flushRef.current();
      void openRef.current(shareId);
      showCollection();
    });
  }, []);

  useEffect(() => {
    document.title = `${state.title.trim() || DEFAULT_TITLE} - BinCode`;
  }, [state.title]);

  /**
   * Saves the open bin and resolves to its shareId (null when nothing was saved). `fromShare` means the
   * Share popover copies the link itself; otherwise a newly created bin's link is copied here.
   */
  const save = useCallback(
    async (forceFork = false, fromShare = false): Promise<string | null> => {
      // Nothing to save on a locked, missing or loading bin (and the blank editor must never become a bin).
      if (savingRef.current || viewRef.current !== 'editor') return null;
      if (!api.getAuthToken()) {
        afterLogin.current = () => void save(forceFork, fromShare);
        setModal({ type: 'login' });
        return null;
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
          return snippet.shareId;
        } else {
          // Leave the title out of an unrenamed fork so the server names it "… (fork)".
          const forkInput = current && s.title === current.title ? { html: s.html, css: s.css, js: s.js } : sent;
          const chosen = pendingRef.current;
          const snippet = current
            ? await api.forkSnippet(current.shareId, forkInput, getUnlockToken('snippet', current.shareId))
            : await api.createSnippet({ ...sent, settings: pendingToInput(chosen) });
          dispatch({ type: 'saved', snippet, sent });
          drafts.clear(current ? current.shareId : null);
          pushShareId(snippet.shareId);
          if (!current) {
            setPending(DEFAULT_PENDING);
            const added = await Promise.allSettled(chosen.collections.map((c) => api.addToCollection(c, snippet.shareId)));
            if (added.some((r) => r.status === 'rejected')) notify('error', 'Saved, but adding it to a collection failed.');
          }
          if (!fromShare) {
            const copied = await copyText(shareUrl(snippet.shareId));
            notify('success', copied ? 'Saved. Link copied to clipboard!' : 'Saved.');
          }
          return snippet.shareId;
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
        return null;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [dispatch, drafts, notify],
  );

  // Share's "Save & copy link": its chosen settings must reach save() now, not after the next render.
  const saveAndCopy = useCallback(
    (settings: PendingSettings) => {
      pendingRef.current = settings;
      setPending(settings);
      return save(false, true);
    },
    [save],
  );

  const rerun = useCallback(() => setRunId((n) => n + 1), []);

  const onLoginSuccess = useCallback(async () => {
    setModal(null);
    // Ownership was computed for an anonymous viewer; refresh it before saving.
    const current = stateRef.current.current;
    if (current) {
      try {
        const snippet = await api.getSnippet(current.shareId, getUnlockToken('snippet', current.shareId));
        if (!('locked' in snippet) && stateRef.current.current?.shareId === snippet.shareId) {
          dispatch({ type: 'meta', current: toCurrent(snippet) });
          stateRef.current = { ...stateRef.current, current: toCurrent(snippet) };
        }
      } catch {
        // Keep the stale metadata; saving will surface any real problem.
      }
    } else if (readShareId() && !afterLogin.current) {
      // The link may be the user's own private or locked bin: try again as them.
      void openSnippet(readShareId());
    }
    const retry = afterLogin.current;
    afterLogin.current = null;
    retry?.();
  }, [dispatch, openSnippet]);

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

  const onUnlocked = useCallback(
    (result: UnlockSnippetResponse) => {
      setModal(null);
      const { snippet } = result;
      if (result.burned) {
        // The bin is gone; keep its content as a new, unsaved bin so Save makes a copy instead of failing.
        replaceShareId(null);
        setPending(DEFAULT_PENDING);
        dispatch({ type: 'reset', content: { title: snippet.title, html: snippet.html, css: snippet.css, js: snippet.js } });
        setView('editor');
        notify('success', 'This bin was deleted after viewing. Save to keep a copy.');
        return;
      }
      if (result.token && result.expiresAt) {
        saveUnlockToken('snippet', snippet.shareId, { token: result.token, expiresAt: result.expiresAt });
      }
      dispatch({ type: 'load', snippet });
      drafts.checkLoaded(snippet);
      setView('editor');
    },
    [dispatch, drafts, notify],
  );

  // Settings changed elsewhere (the panel or My bins): refresh the open bin's metadata.
  const onSettingsApplied = useCallback(
    (snippet: Snippet) => {
      if (stateRef.current.current?.shareId === snippet.shareId) dispatch({ type: 'meta', current: toCurrent(snippet) });
    },
    [dispatch],
  );

  const closeCollection = useCallback(() => {
    setModal(null);
    // A collection link starts on an empty workspace; leaving its dialog lands on a new bin.
    setView((v) => (v === 'blank' ? 'editor' : v));
    // Leave the collection link so a reload doesn't reopen the gate.
    if (readCollectionId()) replaceShareId(stateRef.current.current?.shareId ?? null);
  }, []);

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

  // CDNJS libraries always go into the HTML panel, at the top, so they load before the user's code.
  const onInsertLibrary = useCallback(
    (lib: CdnLibrary) => {
      const result = insertTag(stateRef.current.html, lib);
      if (!result.added) {
        notify('success', `${lib.name} is already in the HTML`);
        return;
      }
      dispatch({ type: 'edit', field: 'html', value: result.html });
      notify('success', `Added ${lib.version ? `${lib.name} ${lib.version}` : lib.name} to HTML`);
    },
    [dispatch, notify],
  );

  const selectTab = useCallback((tab: CodeField) => {
    setActiveTab(tab);
    setShowEditor(true);
  }, []);

  useKeyboardShortcuts({
    onSave: () => {
      if (!modal) void save();
    },
    onRun: () => {
      if (viewRef.current === 'editor') rerun();
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
        saved={!!current}
        canFork={!!current?.isOwner}
        locked={view !== 'editor'}
        lockedTitle={typeof view === 'object' && 'locked' in view ? view.locked.title : null}
        consoleCount={consoleLog.counts.all}
        consoleErrors={consoleLog.counts.error}
        share={{
          shareId: current?.shareId ?? null,
          isOwner: !!current?.isOwner,
          visibility: current ? current.visibility : pending.visibility,
          pending,
          onPendingChange: setPending,
          onSaveAndCopy: saveAndCopy,
          onApplied: onSettingsApplied,
          notify,
        }}
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
        {view !== 'editor' && (
          <div className="gate-screen">
            {typeof view === 'object' && 'locked' in view && (
              <BinGate key={view.locked.shareId} locked={view.locked} onUnlocked={onUnlocked} onNew={onNew} />
            )}
            {typeof view === 'object' && 'unavailable' in view && (
              <div className="gate-card" role="alert">
                <p>{view.unavailable}</p>
                <div className="form-actions">
                  {!user && (
                    <button type="button" className="primary" onClick={() => setModal({ type: 'login' })}>
                      Log in
                    </button>
                  )}
                  <button type="button" onClick={onNew}>
                    New bin
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {view === 'editor' && (
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
                    onRun={rerun}
                    onInsertLibrary={onInsertLibrary}
                    dark={dark}
                  />
                </Suspense>
              </EditorErrorBoundary>
            }
            second={
              <PreviewPane
                code={code}
                paused={paused}
                runId={runId}
                onConsole={consoleLog.push}
                onRun={consoleLog.clear}
              />
            }
          />
        )}
      </main>

      {view === 'editor' && showConsole && (
        <ConsoleDrawer
          entries={consoleLog.entries}
          counts={consoleLog.counts}
          onClear={consoleLog.clear}
          onClose={() => setShowConsole(false)}
        />
      )}

      {modal?.type === 'login' && (
        <LoginModal
          onClose={() => {
            afterLogin.current = null;
            setModal(null);
          }}
          onSuccess={() => void onLoginSuccess()}
        />
      )}
      {modal?.type === 'collection' && (
        <CollectionView key={modal.shareId} shareId={modal.shareId} onOpen={navigateTo} onClose={closeCollection} />
      )}
      {modal?.type === 'snippets' && (
        <SnippetsDashboard
          currentShareId={current?.shareId ?? null}
          onOpen={navigateTo}
          onDeleted={onDeleted}
          onSettingsApplied={onSettingsApplied}
          onClose={() => setModal(null)}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
