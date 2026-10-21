import { useRef, useState } from 'react';
import type { Snippet, User, Visibility } from '../../../shared/api.ts';
import type { PendingSettings } from '../lib/binSettings.ts';
import { copyText } from '../lib/clipboard.ts';
import { shareUrl } from '../lib/url.ts';
import { BinSettingsForm } from './BinSettings.tsx';
import { CopyIcon, ShareIcon } from './Icons.tsx';
import { Popover } from './Popover.tsx';

export interface SharePopoverProps {
  /** the open bin's shareId; null for a new bin that hasn't been saved yet */
  shareId: string | null;
  /** the viewer owns the open bin (shows its settings form) */
  isOwner: boolean;
  /** the open bin's visibility (pending.visibility for a new bin) */
  visibility: Visibility;
  /** unsaved edits: the link shows the last saved version */
  dirty: boolean;
  user: User | null;
  /** settings for the new bin's first save (App state; never stored in drafts) */
  pending: PendingSettings;
  onPendingChange: (pending: PendingSettings) => void;
  /**
   * Saves the new bin with `settings` (POST) and resolves to its shareId, or null when it failed or
   * needs a login first. `settings` is also passed to onPendingChange just before, but App state
   * hasn't re-rendered yet, so the save must use the argument.
   */
  onSaveAndCopy: (settings: PendingSettings) => Promise<string | null>;
  /** settings of the saved bin were changed (PATCH) */
  onApplied: (snippet: Snippet) => void;
  notify: (kind: 'success' | 'error', text: string) => void;
}

/** The Share button: copies the link at once (when there is one) and opens the link + settings panel. */
export function SharePopover(props: SharePopoverProps) {
  const { shareId, isOwner, visibility, notify } = props;
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The form reports its choice through onPendingChange right before onSubmitted.
  const chosenRef = useRef<PendingSettings>(props.pending);

  const copy = async (id: string, vis: Visibility) => {
    const ok = await copyText(shareUrl(id));
    if (!ok) notify('error', 'Could not copy the link.');
    else notify('success', vis === 'private' ? 'Link copied — only you can open it' : 'Snippet link copied to clipboard!');
  };

  const onButton = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (shareId) void copy(shareId, visibility);
  };

  // Pending settings are passed along explicitly: App's state update hasn't landed when the save starts.
  const saveAndCopy = async (settings: PendingSettings) => {
    const id = await props.onSaveAndCopy(settings);
    if (!id) {
      setOpen(false);
      return;
    }
    // The popover stays open and re-renders as the saved bin's panel once App passes the new shareId.
    await copy(id, settings.visibility);
  };

  return (
    <div className="popover-anchor">
      <button
        ref={anchorRef}
        type="button"
        className="nav-share"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onButton}
        title={shareId ? 'Copy the link and share settings' : 'Share settings'}
        aria-label="Share"
      >
        <ShareIcon />
        <span className="nav-label">Share</span>
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        align="end"
        label="Share"
        className="share-popover"
      >
        {shareId ? (
          <>
            <div className="share-row">
              <input
                ref={inputRef}
                type="text"
                value={shareUrl(shareId)}
                readOnly
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                title="Copy link"
                onClick={() => {
                  inputRef.current?.select();
                  void copy(shareId, visibility);
                }}
              >
                <CopyIcon />
                Copy
              </button>
            </div>
            {props.dirty && <p className="share-note">Unsaved changes aren&apos;t in the link.</p>}
            {isOwner && (
              <>
                <hr className="share-divider" />
                <BinSettingsForm
                  key={shareId}
                  mode="saved"
                  shareId={shareId}
                  autoFocusPassword={false}
                  onApplied={(snippet) => {
                    props.onApplied(snippet);
                    notify('success', 'Settings saved');
                  }}
                  onSubmitted={() => setOpen(false)}
                />
              </>
            )}
          </>
        ) : (
          <BinSettingsForm
            key="new"
            mode="new"
            pending={props.pending}
            autoFocusPassword={false}
            submitLabel={props.user ? 'Save & copy link' : 'Log in & save'}
            onPendingChange={(p) => {
              chosenRef.current = p;
              props.onPendingChange(p);
            }}
            onSubmitted={() => saveAndCopy(chosenRef.current)}
          />
        )}
      </Popover>
    </div>
  );
}
