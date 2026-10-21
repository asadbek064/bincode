import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CollectionResponse } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/constants.ts';
import * as api from '../lib/api.ts';
import { ApiError } from '../lib/api.ts';
import { forgetCollectionToken, getCollectionToken, saveCollectionToken } from '../lib/collectionTokens.ts';
import { relativeTime } from '../lib/time.ts';
import { Modal } from './Modal.tsx';

interface CollectionViewProps {
  shareId: string;
  /** shown above the gate, e.g. when a private bin needs the collection unlocked again */
  notice?: string;
  onOpen: (snippetShareId: string, collectionShareId: string) => void;
  onClose: () => void;
}

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CollectionResponse };

export function CollectionView({ shareId, notice, onOpen, onClose }: CollectionViewProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getCollectionToken(shareId);
    try {
      const data = await api.getCollection(shareId, token);
      // A stale token (password changed) or a stale login just means "locked" or anonymous again.
      if (data.locked && token) forgetCollectionToken(shareId);
      setState({ status: 'ready', data });
      return data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const data = await api.getCollection(shareId, token).catch(() => null);
        if (data) {
          setState({ status: 'ready', data });
          return data;
        }
      }
      setState({
        status: 'error',
        message:
          err instanceof ApiError && err.status === 404
            ? 'This collection does not exist, or it is private.'
            : err instanceof Error
              ? err.message
              : 'Could not load the collection.',
      });
      return null;
    }
  }, [shareId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const res = await api.unlockCollection(shareId, password);
      saveCollectionToken(shareId, res);
      setPassword('');
      await load();
    } catch (err) {
      setUnlockError(
        err instanceof ApiError && err.status === 403
          ? 'Wrong password.'
          : err instanceof Error
            ? err.message
            : 'Unlocking failed.',
      );
    } finally {
      setUnlocking(false);
    }
  };

  const title =
    state.status !== 'ready' ? 'Collection' : state.data.locked ? state.data.title : state.data.collection.title;

  return (
    <Modal title={title} onClose={onClose} className="modal-wide">
      {notice && <p className="banner banner-warning collection-notice">{notice}</p>}
      {state.status === 'loading' && <p className="muted">Loading…</p>}
      {state.status === 'error' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && state.data.locked && (
        <form className="form" onSubmit={onUnlock}>
          <p className="muted">This collection is password protected.</p>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={LIMITS.passwordMax}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {unlockError && (
            <p className="form-error" role="alert">
              {unlockError}
            </p>
          )}
          <button type="submit" className="primary" disabled={unlocking}>
            {unlocking ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      )}

      {state.status === 'ready' && !state.data.locked && (
        <>
          {state.data.collection.description && <p className="muted">{state.data.collection.description}</p>}
          {state.data.snippets.length === 0 ? (
            <p className="muted">This collection is empty.</p>
          ) : (
            <ul className="snippet-list">
              {state.data.snippets.map((s) => (
                <li key={s.shareId} className="snippet-item">
                  <div className="snippet-row">
                    <button type="button" className="snippet-open" onClick={() => onOpen(s.shareId, shareId)}>
                      <span className="snippet-title">
                        {s.title}
                        {s.visibility === 'private' && <span className="badge">private</span>}
                      </span>
                      <span className="snippet-meta" title={new Date(s.updatedAt).toLocaleString()}>
                        Updated {relativeTime(s.updatedAt)}
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
