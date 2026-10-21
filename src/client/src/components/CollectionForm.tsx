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
  const [description, setDescription] = useState(collection?.description ?? '');
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
      description,
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
      <label className="field">
        <span>Description</span>
        <textarea
          value={description}
          maxLength={LIMITS.descriptionMax}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
        <span>Let others open it by link with a password</span>
      </label>
      <p className="form-hint">
        {protect
          ? 'Visitors see only the name until they enter the password. They can then view every bin in it, including private ones, but cannot fork private bins.'
          : 'Only you can open this collection.'}
      </p>
      {protect && (
        <label className="field">
          <span>{hadPassword ? 'New password (leave empty to keep the current one)' : 'Password'}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={LIMITS.collectionPasswordMin}
            maxLength={LIMITS.passwordMax}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
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
