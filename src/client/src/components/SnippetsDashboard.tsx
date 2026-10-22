import { useEffect, useState } from 'react';
import type { CollectionSummary, Snippet, SnippetSummary } from '../../../shared/api.ts';
import * as api from '../lib/api.ts';
import { copyText } from '../lib/clipboard.ts';
import { relativeTime } from '../lib/time.ts';
import { collectionUrl, shareUrl } from '../lib/url.ts';
import { BinSettings } from './BinSettings.tsx';
import { CollectionForm } from './CollectionForm.tsx';
import { EditIcon, FolderIcon, LinkIcon, LockIcon, PlusIcon, SettingsIcon, TrashIcon } from './Icons.tsx';
import { Modal } from './Modal.tsx';
import { VisibilityIcon } from './Toolbar.tsx';
import { VISIBILITY_LABELS } from '../lib/binSettings.ts';

interface SnippetsDashboardProps {
  currentShareId: string | null;
  onOpen: (shareId: string) => void;
  onDeleted: (shareId: string) => void;
  onSettingsApplied: (snippet: Snippet) => void;
  onClose: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snippets: SnippetSummary[]; collections: CollectionSummary[] };

/** members of the selected collection; null while loading */
type Selection = { shareId: string; members: Set<string> | null } | null;


const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function SnippetsDashboard({ currentShareId, onOpen, onDeleted, onSettingsApplied, onClose }: SnippetsDashboardProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = useState<Selection>(null);
  const [editing, setEditing] = useState<{ collection: CollectionSummary | null } | null>(null);
  /** bin whose settings panel is open */
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reloaded after the settings panel closes, since it can change visibility and memberships.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listSnippets(), api.listCollections()])
      .then(([s, c]) => {
        if (!cancelled) setState({ status: 'ready', snippets: s.snippets, collections: c.collections });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(err, 'Failed to load snippets.') });
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // The selected collection's members may have changed too.
  useEffect(() => {
    if (version > 0 && selected) void select(selected.shareId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const collections = state.status === 'ready' ? state.collections : [];
  const selectedCollection = selected ? collections.find((c) => c.shareId === selected.shareId) : undefined;

  const updateCollections = (fn: (list: CollectionSummary[]) => CollectionSummary[]) =>
    setState((s) => (s.status === 'ready' ? { ...s, collections: fn(s.collections) } : s));

  const select = async (shareId: string | null) => {
    setActionError(null);
    if (!shareId) {
      setSelected(null);
      return;
    }
    setSelected({ shareId, members: null });
    try {
      const res = await api.getCollection(shareId);
      if (res.locked) throw new Error('Could not open the collection.');
      const members = new Set(res.snippets.map((s) => s.shareId));
      setSelected((cur) => (cur?.shareId === shareId ? { shareId, members } : cur));
    } catch (err) {
      setActionError(errorMessage(err, 'Could not load the collection.'));
      setSelected((cur) => (cur?.shareId === shareId ? null : cur));
    }
  };

  const onCopy = async (key: string, url: string) => {
    if (await copyText(url)) setCopied(key);
    else setActionError('Could not copy the link.');
  };

  const onDelete = async (shareId: string) => {
    setBusy(shareId);
    setActionError(null);
    try {
      await api.deleteSnippet(shareId);
      setState((s) =>
        s.status === 'ready' ? { ...s, snippets: s.snippets.filter((x) => x.shareId !== shareId) } : s,
      );
      // The server dropped its memberships; refresh the counts rather than guessing.
      api
        .listCollections()
        .then((res) => updateCollections(() => res.collections))
        .catch(() => undefined);
      setSelected((cur) => {
        if (!cur?.members?.has(shareId)) return cur;
        const members = new Set(cur.members);
        members.delete(shareId);
        return { ...cur, members };
      });
      onDeleted(shareId);
    } catch (err) {
      setActionError(errorMessage(err, 'Delete failed.'));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  if (settingsFor) {
    return (
      <BinSettings
        mode="saved"
        shareId={settingsFor}
        onApplied={onSettingsApplied}
        onClose={() => {
          setSettingsFor(null);
          setVersion((v) => v + 1);
        }}
      />
    );
  }

  if (editing) {
    return (
      <Modal
        title={editing.collection ? 'Collection settings' : 'New collection'}
        onClose={() => setEditing(null)}
        className="modal-narrow"
      >
        <CollectionForm
          collection={editing.collection}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            updateCollections((list) => [saved, ...list.filter((c) => c.shareId !== saved.shareId)]);
            setEditing(null);
          }}
          onDeleted={(shareId) => {
            updateCollections((list) => list.filter((c) => c.shareId !== shareId));
            if (selected?.shareId === shareId) setSelected(null);
            setEditing(null);
          }}
        />
      </Modal>
    );
  }

  const allSnippets = state.status === 'ready' ? state.snippets : [];
  const visible = selected ? allSnippets.filter((s) => selected.members?.has(s.shareId)) : allSnippets;

  return (
    <Modal title="My bins" onClose={onClose} className="modal-wide modal-dashboard">
      {state.status === 'loading' && <p className="muted">Loading…</p>}
      {state.status === 'error' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <div className="dashboard">
          <nav className="collection-nav" aria-label="Collections">
            <button
              type="button"
              className={selected ? 'collection-link' : 'collection-link active'}
              aria-current={selected ? undefined : 'true'}
              onClick={() => void select(null)}
            >
              <span className="collection-name">All bins</span>
              <span className="collection-count">{allSnippets.length}</span>
            </button>
            {collections.map((c) => (
              <button
                key={c.shareId}
                type="button"
                className={selected?.shareId === c.shareId ? 'collection-link active' : 'collection-link'}
                aria-current={selected?.shareId === c.shareId ? 'true' : undefined}
                onClick={() => void select(c.shareId)}
                title={c.title}
              >
                {c.hasPassword ? <LockIcon aria-label="Password protected" /> : <FolderIcon />}
                <span className="collection-name">{c.title}</span>
                <span className="collection-count">{c.snippetCount}</span>
              </button>
            ))}
            <button type="button" className="collection-new" onClick={() => setEditing({ collection: null })}>
              <PlusIcon />
              <span>New collection</span>
            </button>
          </nav>

          <section className="dashboard-main">
            {selectedCollection && (
              <header className="collection-header">
                <div className="collection-header-text">
                  <h3>{selectedCollection.title}</h3>
                  <p className="snippet-meta">
                    {selectedCollection.hasPassword ? 'Shared by link + password' : 'Only you can open it'}
                  </p>
                </div>
                <div className="snippet-actions">
                  {selectedCollection.hasPassword && (
                    <button
                      type="button"
                      onClick={() => onCopy(`c:${selectedCollection.shareId}`, collectionUrl(selectedCollection.shareId))}
                      title="Copy the collection link"
                    >
                      <LinkIcon />
                      <span>{copied === `c:${selectedCollection.shareId}` ? 'Copied!' : 'Copy link'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setEditing({ collection: selectedCollection })}
                    aria-label={`Edit ${selectedCollection.title}`}
                    title="Collection settings"
                  >
                    <EditIcon />
                  </button>
                </div>
              </header>
            )}

            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            {selected && selected.members === null && <p className="muted">Loading…</p>}
            {allSnippets.length === 0 && <p className="muted">No snippets yet. Press Save to create your first one.</p>}
            {selected?.members && visible.length === 0 && allSnippets.length > 0 && (
              <p className="muted">Empty. Add bins from their settings (gear button).</p>
            )}

            {visible.length > 0 && (
              <ul className="snippet-list">
                {visible.map((s) => (
                  <li key={s.shareId} className={s.shareId === currentShareId ? 'snippet-item current' : 'snippet-item'}>
                    <div className="snippet-row">
                      <button type="button" className="snippet-open" onClick={() => onOpen(s.shareId)}>
                        <span className="snippet-title">
                          {s.visibility !== 'unlisted' && (
                            <span className="row-icon" title={VISIBILITY_LABELS[s.visibility].hint}>
                              <VisibilityIcon visibility={s.visibility} />
                            </span>
                          )}
                          {s.title}
                        </span>
                        <span className="snippet-meta" title={new Date(s.updatedAt).toLocaleString()}>
                          Updated {relativeTime(s.updatedAt)}
                          {s.burnAfterRead && ' · deleted after first view'}
                          {s.expiresAt && ` · deleted ${relativeTime(s.expiresAt)}`}
                        </span>
                      </button>
                      <div className="snippet-actions">
                        {confirming === s.shareId ? (
                          <>
                            <span className="muted">Delete?</span>
                            <button
                              type="button"
                              className="danger"
                              disabled={busy === s.shareId}
                              onClick={() => onDelete(s.shareId)}
                            >
                              {busy === s.shareId ? 'Deleting…' : 'Delete'}
                            </button>
                            <button type="button" onClick={() => setConfirming(null)} disabled={busy === s.shareId}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => onCopy(s.shareId, shareUrl(s.shareId))} title="Copy share link">
                              <LinkIcon />
                              <span>{copied === s.shareId ? 'Copied!' : 'Copy link'}</span>
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => setSettingsFor(s.shareId)}
                              aria-label={`Settings for ${s.title}`}
                              title="Visibility, expiry and collections"
                            >
                              <SettingsIcon />
                            </button>
                            <button
                              type="button"
                              className="icon-button danger-text"
                              onClick={() => setConfirming(s.shareId)}
                              aria-label={`Delete ${s.title}`}
                              title="Delete"
                            >
                              <TrashIcon />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
