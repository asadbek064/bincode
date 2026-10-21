import { useEffect, useState } from 'react';
import type { SnippetSummary } from '../../../shared/api.ts';
import * as api from '../lib/api.ts';
import { copyText } from '../lib/clipboard.ts';
import { relativeTime } from '../lib/time.ts';
import { shareUrl } from '../lib/url.ts';
import { LinkIcon, TrashIcon } from './Icons.tsx';
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
  | { status: 'ready'; snippets: SnippetSummary[] };

export function SnippetsDashboard({ currentShareId, onOpen, onDeleted, onClose }: SnippetsDashboardProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listSnippets()
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', snippets: res.snippets });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load snippets.' });
        }
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

  const onCopy = async (shareId: string) => {
    if (await copyText(shareUrl(shareId))) setCopied(shareId);
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
      onDeleted(shareId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  return (
    <Modal title="My snippets" onClose={onClose} className="modal-wide">
      {state.status === 'loading' && <p className="muted">Loading…</p>}
      {state.status === 'error' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && state.snippets.length === 0 && (
        <p className="muted">No snippets yet. Press Save to create your first one.</p>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {state.status === 'ready' && state.snippets.length > 0 && (
        <ul className="snippet-list">
          {state.snippets.map((s) => (
            <li key={s.shareId} className={s.shareId === currentShareId ? 'snippet-item current' : 'snippet-item'}>
              <button type="button" className="snippet-open" onClick={() => onOpen(s.shareId)}>
                <span className="snippet-title">
                  {s.title}
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
                    <button type="button" onClick={() => onCopy(s.shareId)} title="Copy share link">
                      <LinkIcon />
                      <span>{copied === s.shareId ? 'Copied!' : 'Copy link'}</span>
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
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
