import { useEffect, useState } from 'react';
import type { CollectionSummary, SnippetSummary } from '../../../shared/api.ts';
import * as api from '../lib/api.ts';
import { copyText } from '../lib/clipboard.ts';
import { relativeTime } from '../lib/time.ts';
import { collectionUrl, shareUrl } from '../lib/url.ts';
import { CollectionForm } from './CollectionForm.tsx';
import { EditIcon, FolderIcon, LinkIcon, LockIcon, PlusIcon, TrashIcon } from './Icons.tsx';
import { Modal } from './Modal.tsx';

interface SnippetsDashboardProps {
  currentShareId: string | null;
  onOpen: (shareId: string) => void;
  onDeleted: (shareId: string) => void;
  onClose: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snippets: SnippetSummary[]; collections: CollectionSummary[] };

/** members of the selected collection; null while loading */
type Selection = { shareId: string; members: Set<string> | null } | null;

/** collections the bin with the open membership panel belongs to; null while loading */
type MembershipPanel = { shareId: string; collections: Set<string> | null } | null;

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function SnippetsDashboard({ currentShareId, onOpen, onDeleted, onClose }: SnippetsDashboardProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = useState<Selection>(null);
  const [editing, setEditing] = useState<{ collection: CollectionSummary | null } | null>(null);
  const [panel, setPanel] = useState<MembershipPanel>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const collections = state.status === 'ready' ? state.collections : [];
  const selectedCollection = selected ? collections.find((c) => c.shareId === selected.shareId) : undefined;

  const updateCollections = (fn: (list: CollectionSummary[]) => CollectionSummary[]) =>
    setState((s) => (s.status === 'ready' ? { ...s, collections: fn(s.collections) } : s));

  const adjustCount = (collectionId: string, delta: number) =>
    updateCollections((list) =>
      list.map((c) => (c.shareId === collectionId ? { ...c, snippetCount: c.snippetCount + delta } : c)),
    );

  const select = async (shareId: string | null) => {
    setPanel(null);
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

  const togglePanel = async (shareId: string) => {
    if (panel?.shareId === shareId) {
      setPanel(null);
      return;
    }
    setPanel({ shareId, collections: null });
    try {
      const snippet = await api.getSnippet(shareId);
      setPanel((cur) => (cur?.shareId === shareId ? { shareId, collections: new Set(snippet.collections ?? []) } : cur));
    } catch (err) {
      setActionError(errorMessage(err, 'Could not load collections.'));
      setPanel(null);
    }
  };

  const toggleMembership = async (snippetId: string, collectionId: string, add: boolean) => {
    const key = `${snippetId}:${collectionId}`;
    setBusy(key);
    setActionError(null);
    try {
      if (add) await api.addToCollection(collectionId, snippetId);
      else await api.removeFromCollection(collectionId, snippetId);
      adjustCount(collectionId, add ? 1 : -1);
      setPanel((cur) => {
        if (cur?.shareId !== snippetId || !cur.collections) return cur;
        const next = new Set(cur.collections);
        if (add) next.add(collectionId);
        else next.delete(collectionId);
        return { ...cur, collections: next };
      });
      setSelected((cur) => {
        if (cur?.shareId !== collectionId || !cur.members) return cur;
        const members = new Set(cur.members);
        if (add) members.add(snippetId);
        else members.delete(snippetId);
        return { ...cur, members };
      });
    } catch (err) {
      setActionError(errorMessage(err, 'Updating the collection failed.'));
    } finally {
      setBusy(null);
    }
  };

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
    <Modal title="My snippets" onClose={onClose} className="modal-wide modal-dashboard">
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
                title={c.description || c.title}
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
                  {selectedCollection.description && <p className="muted">{selectedCollection.description}</p>}
                  <p className="snippet-meta">
                    {selectedCollection.hasPassword ? 'Password protected link' : 'Only you can open it'}
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
              <p className="muted">No bins in this collection yet. Use the folder button on a bin to add it.</p>
            )}

            {visible.length > 0 && (
              <ul className="snippet-list">
                {visible.map((s) => (
                  <li key={s.shareId} className={s.shareId === currentShareId ? 'snippet-item current' : 'snippet-item'}>
                    <div className="snippet-row">
                      <button type="button" className="snippet-open" onClick={() => onOpen(s.shareId)}>
                        <span className="snippet-title">
                          {s.title}
                          {s.visibility === 'private' && (
                            <span className="badge" title="Only you can open it">
                              private
                            </span>
                          )}
                          {s.forkedFrom !== null && <span className="badge">fork</span>}
                          {s.shareId === currentShareId && <span className="badge badge-primary">open</span>}
                        </span>
                        <span className="snippet-meta" title={new Date(s.updatedAt).toLocaleString()}>
                          Updated {relativeTime(s.updatedAt)}
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
                              aria-expanded={panel?.shareId === s.shareId}
                              onClick={() => void togglePanel(s.shareId)}
                              aria-label={`Collections for ${s.title}`}
                              title="Add to collections"
                            >
                              <FolderIcon />
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

                    {panel?.shareId === s.shareId && (
                      <div className="membership" role="group" aria-label={`Collections for ${s.title}`}>
                        {panel.collections === null && <span className="muted">Loading…</span>}
                        {panel.collections && collections.length === 0 && (
                          <span className="muted">No collections yet. Create one in the sidebar.</span>
                        )}
                        {panel.collections &&
                          collections.map((c) => {
                            const member = panel.collections!.has(c.shareId);
                            return (
                              <label key={c.shareId} className="checkbox-field">
                                <input
                                  type="checkbox"
                                  checked={member}
                                  disabled={busy === `${s.shareId}:${c.shareId}`}
                                  onChange={() => void toggleMembership(s.shareId, c.shareId, !member)}
                                />
                                <span>{c.title}</span>
                              </label>
                            );
                          })}
                      </div>
                    )}
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
