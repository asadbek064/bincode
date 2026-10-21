import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CollectionInput, CollectionSummary } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/constants.ts';
import * as api from '../lib/api.ts';

interface CollectionFormProps {
  /** null creates a new collection */
  collection: CollectionSummary | null;
  onSaved: (collection: CollectionSummary) => void;
  onDeleted: (shareId: string) => void;
  onCancel: () => void;
}

export function CollectionForm({ collection, onSaved, onDeleted, onCancel }: CollectionFormProps) {
  const [title, setTitle] = useState(collection?.title ?? '');
  const [protect, setProtect] = useState(collection?.hasPassword ?? false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hadPassword = collection?.hasPassword ?? false;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (protect && !hadPassword && !password) {
      setError('Choose a password, or turn off password protection.');
      return;
    }
    // undefined keeps the stored password; null removes it.
    const input: CollectionInput = {
      title,
      password: !protect ? (hadPassword ? null : undefined) : password || undefined,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = collection
        ? await api.updateCollection(collection.shareId, input)
        : await api.createCollection(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the collection failed.');
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!collection || busy) return;
    if (!window.confirm(`Delete the collection "${collection.title}"? Its bins are kept.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteCollection(collection.shareId);
      onDeleted(collection.shareId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={title}
          maxLength={LIMITS.titleMax}
          placeholder="Untitled"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
        <span>Share by link with a password</span>
      </label>
      {protect && (
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Password"
          value={password}
          minLength={LIMITS.collectionPasswordMin}
          maxLength={LIMITS.passwordMax}
          placeholder={hadPassword ? 'New password (empty keeps the current one)' : 'Password'}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      {protect && <p className="form-hint">Visitors see the list of your Link and Password bins. Only-me bins stay hidden.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {collection && (
          <button type="button" className="danger-text" onClick={onDelete} disabled={busy}>
            Delete collection
          </button>
        )}
        <span className="spacer" />
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : collection ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}
