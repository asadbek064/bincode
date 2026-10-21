import { useState } from 'react';
import type { FormEvent } from 'react';
import type { LockedSnippet, UnlockSnippetResponse } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/constants.ts';
import * as api from '../lib/api.ts';
import { ApiError } from '../lib/api.ts';
import { Modal } from './Modal.tsx';

interface BinGateProps {
  locked: LockedSnippet;
  onUnlocked: (result: UnlockSnippetResponse) => void;
  onClose: () => void;
}

/** Shown instead of a bin that needs a password or burns on reading. Nothing of the bin but its title is loaded yet. */
export function BinGate({ locked, onUnlocked, onClose }: BinGateProps) {
  const needsPassword = locked.reason !== 'burn';
  const burns = locked.reason !== 'password';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await api.unlockSnippet(locked.shareId, needsPassword ? password : undefined));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Wrong password.'
          : err instanceof ApiError && err.status === 404
            ? 'This bin no longer exists. It may have been viewed already.'
            : err instanceof Error
              ? err.message
              : 'Opening the bin failed.',
      );
      setBusy(false);
    }
  };

  return (
    <Modal title={locked.title} onClose={onClose} className="modal-narrow">
      <form className="form" onSubmit={onSubmit}>
        {needsPassword && <p className="muted">This bin is password protected.</p>}
        {burns && (
          <p className="banner banner-warning gate-warning">
            This bin will be deleted as soon as you open it. Copy what you need, or save your own copy.
          </p>
        )}
        {needsPassword && (
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
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Opening…' : burns ? 'Open and delete' : 'Unlock'}
        </button>
      </form>
    </Modal>
  );
}
