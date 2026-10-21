import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CollectionSummary, Snippet, Visibility } from '../../../shared/api.ts';
import { LIMITS, VISIBILITIES } from '../../../shared/constants.ts';
import * as api from '../lib/api.ts';
import {
  LIFETIMES,
  LIFETIME_LABELS,
  VISIBILITY_LABELS,
  lifetimeToInput,
  type Lifetime,
  type PendingSettings,
} from '../lib/binSettings.ts';
import { relativeTime } from '../lib/time.ts';
import { Modal } from './Modal.tsx';

/** A saved bin applies changes at once (code and unsaved edits are untouched); a new one keeps them for its first save. */
type ModeProps =
  | { mode: 'saved'; shareId: string; onApplied: (snippet: Snippet) => void }
  | { mode: 'new'; pending: PendingSettings; onPendingChange: (pending: PendingSettings) => void };

export type BinSettingsFormProps = ModeProps & {
  /** defaults to 'Apply' (saved) / 'Done' (new) */
  submitLabel?: string;
  /** label while submitting; defaults to 'Saving…' */
  busyLabel?: string;
  /**
   * Runs after a successful submit (after onApplied / onPendingChange). The button stays busy while
   * its promise is pending; a rejection is shown as the form error.
   */
  onSubmitted?: () => void | Promise<void>;
  /** focus the password field when it appears (off inside popovers, which focus their first control) */
  autoFocusPassword?: boolean;
};

export type BinSettingsProps = ModeProps & { onClose: () => void };

/** 'keep' leaves a saved bin's current expiry alone. */
type LifetimeChoice = Lifetime | 'keep';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snippet: Snippet | null; collections: CollectionSummary[] };

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** The settings form on its own, for inline use (the Share popover); `BinSettings` wraps it in a modal. */
export function BinSettingsForm(props: BinSettingsFormProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [visibility, setVisibility] = useState<Visibility>(props.mode === 'new' ? props.pending.visibility : 'unlisted');
  const [password, setPassword] = useState(props.mode === 'new' ? props.pending.password : '');
  const [lifetime, setLifetime] = useState<LifetimeChoice>(props.mode === 'new' ? props.pending.lifetime : 'never');
  const [members, setMembers] = useState<Set<string>>(() => new Set(props.mode === 'new' ? props.pending.collections : []));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shareId = props.mode === 'saved' ? props.shareId : null;

  useEffect(() => {
    let cancelled = false;
    // Logged out (a new bin's settings before login-then-save): collections need an account, so skip them.
    const listing = api.getAuthToken() ? api.listCollections() : Promise.resolve({ collections: [] });
    Promise.all([shareId ? api.getOwnSnippet(shareId) : Promise.resolve(null), listing])
      .then(([snippet, list]) => {
        if (cancelled) return;
        if (snippet) {
          setVisibility(snippet.visibility);
          setLifetime(snippet.burnAfterRead ? 'burn' : snippet.expiresAt ? 'keep' : 'never');
          setMembers(new Set(snippet.collections ?? []));
        }
        setLoad({ status: 'ready', snippet, collections: list.collections });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: errorMessage(err, 'Could not load the settings.') });
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const snippet = load.status === 'ready' ? load.snippet : null;
  const collections = load.status === 'ready' ? load.collections : [];
  const storedPassword = snippet?.visibility === 'password';

  // Collections apply immediately for a saved bin; for a new one they are added after its first save.
  const toggleCollection = async (collectionId: string) => {
    const add = !members.has(collectionId);
    const next = new Set(members);
    if (add) next.add(collectionId);
    else next.delete(collectionId);
    if (!shareId) {
      setMembers(next);
      return;
    }
    setBusy(collectionId);
    setError(null);
    try {
      if (add) await api.addToCollection(collectionId, shareId);
      else await api.removeFromCollection(collectionId, shareId);
      setMembers(next);
    } catch (err) {
      setError(errorMessage(err, 'Updating the collection failed.'));
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const needsPassword = visibility === 'password' && !storedPassword;
    if (visibility === 'password' && (password || needsPassword) && password.length < LIMITS.collectionPasswordMin) {
      setError(`Password needs at least ${LIMITS.collectionPasswordMin} characters.`);
      return;
    }
    if (props.mode === 'new') {
      props.onPendingChange({
        visibility,
        password: visibility === 'password' ? password : '',
        lifetime: lifetime === 'keep' ? 'never' : lifetime,
        collections: [...members],
      });
      if (!props.onSubmitted) return;
    }
    setBusy('apply');
    setError(null);
    try {
      if (props.mode === 'saved') {
        const updated = await api.updateSnippetSettings(props.shareId, {
          visibility,
          ...(visibility === 'password' && password ? { password } : {}),
          ...(lifetime === 'keep' ? {} : lifetimeToInput(lifetime)),
        });
        props.onApplied(updated);
      }
      await props.onSubmitted?.();
    } catch (err) {
      setError(errorMessage(err, 'Saving the settings failed.'));
    }
    // The form may have unmounted (popover closed or switched modes); React ignores the update then.
    setBusy(null);
  };

  const submitLabel = props.submitLabel ?? (props.mode === 'saved' ? 'Apply' : 'Done');

  return (
    <>
      {load.status === 'loading' && <p className="muted">Loading…</p>}
      {load.status === 'error' && (
        <p className="form-error" role="alert">
          {load.message}
        </p>
      )}
      {load.status === 'ready' && (
        <form className="form" onSubmit={onSubmit}>
          <div className="field">
            <span>Who can open it</span>
            <div className="segmented" role="radiogroup" aria-label="Who can open it">
              {VISIBILITIES.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={visibility === v}
                  className={visibility === v ? 'segment selected' : 'segment'}
                  onClick={() => setVisibility(v)}
                >
                  {VISIBILITY_LABELS[v].label}
                </button>
              ))}
            </div>
            <span className="form-hint">{VISIBILITY_LABELS[visibility].hint}</span>
          </div>

          {visibility === 'password' && (
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Password"
              value={password}
              maxLength={LIMITS.passwordMax}
              placeholder={storedPassword ? 'New password (empty keeps the current one)' : 'Password'}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={props.autoFocusPassword ?? true}
            />
          )}

          <label className="field">
            <span>Delete</span>
            <select value={lifetime} onChange={(e) => setLifetime(e.target.value as LifetimeChoice)}>
              {snippet?.expiresAt && !snippet.burnAfterRead && (
                <option value="keep">{`Keep (${relativeTime(snippet.expiresAt)})`}</option>
              )}
              {LIFETIMES.map((l) => (
                <option key={l} value={l} disabled={l === 'burn' && visibility === 'private'}>
                  {LIFETIME_LABELS[l]}
                </option>
              ))}
            </select>
          </label>

          {collections.length > 0 && (
            <div className="field">
              <span>Collections</span>
              <div className="membership">
                {collections.map((c) => (
                  <label key={c.shareId} className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={members.has(c.shareId)}
                      disabled={busy === c.shareId}
                      onChange={() => void toggleCollection(c.shareId)}
                    />
                    <span>{c.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary" disabled={!!busy}>
            {busy === 'apply' ? (props.busyLabel ?? 'Saving…') : submitLabel}
          </button>
        </form>
      )}
    </>
  );
}

export function BinSettings(props: BinSettingsProps) {
  const { onClose, ...rest } = props;
  return (
    <Modal title="Bin settings" onClose={onClose} className="modal-settings">
      <BinSettingsForm {...(rest as ModeProps)} onSubmitted={onClose} />
    </Modal>
  );
}
