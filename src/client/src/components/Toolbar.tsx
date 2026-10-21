import type { ReactNode } from 'react';
import { LIMITS } from '../../../shared/constants.ts';
import { VISIBILITY_LABELS } from '../lib/binSettings.ts';
import type { User, Visibility } from '../../../shared/api.ts';
import {
  ConsoleIcon,
  ConsoleOffIcon,
  EyeIcon,
  EyeOffIcon,
  ForkIcon,
  ListIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
} from './Icons.tsx';

interface ToolbarProps {
  user: User | null;
  title: string;
  onTitleChange: (title: string) => void;
  dirty: boolean;
  /** what the main action does for the current snippet */
  saveMode: 'save' | 'update' | 'fork';
  /** show a secondary Fork button (for snippets you own) */
  canFork: boolean;
  /** a locked, missing or loading bin is on screen: nothing to edit, save or toggle */
  locked: boolean;
  /** title of the locked bin, shown read-only */
  lockedTitle: string | null;
  visibility: Visibility;
  /** the settings button is shown for new snippets and ones you own */
  canEditSettings: boolean;
  onOpenSettings: () => void;
  saving: boolean;
  showEditor: boolean;
  showPreview: boolean;
  showConsole: boolean;
  paused: boolean;
  onToggleEditor: () => void;
  onTogglePreview: () => void;
  onToggleConsole: () => void;
  onTogglePaused: () => void;
  onNew: () => void;
  onOpenSnippets: () => void;
  onSave: () => void;
  onFork: () => void;
  onLogin: () => void;
  onLogout: () => void;
}

export function VisibilityIcon({ visibility }: { visibility: Visibility }) {
  if (visibility === 'private') return <LockIcon />;
  if (visibility === 'password') return <KeyIcon />;
  return <LinkIcon />;
}

interface ToggleProps {
  pressed: boolean;
  label: string;
  title: string;
  onClick: () => void;
  on: ReactNode;
  off: ReactNode;
}

function Toggle({ pressed, label, title, onClick, on, off }: ToggleProps) {
  return (
    <button type="button" className="toggle" aria-pressed={pressed} onClick={onClick} title={title}>
      {pressed ? on : off}
      <span className="toggle-label">{label}</span>
    </button>
  );
}

export function Toolbar(props: ToolbarProps) {
  const { user, title, saveMode, saving } = props;
  const saveLabel = saveMode === 'fork' ? 'Fork' : 'Save';
  const saveTitle =
    saveMode === 'fork'
      ? 'Save a copy of this snippet to your account (Ctrl+S)'
      : saveMode === 'update'
        ? 'Save changes to this snippet (Ctrl+S)'
        : 'Save and get a share link (Ctrl+S)';

  return (
    <header className="toolbar">
      <a
        className="brand"
        href="/"
        title="BinCode - new snippet"
        onClick={(e) => {
          e.preventDefault();
          props.onNew();
        }}
      >
        <img src="/logo/favicon.svg" alt="" width="22" height="22" />
        <span className="brand-name">BinCode</span>
      </a>

      <div className="title-area">
        {props.locked ? (
          <span className="title-text" title={props.lockedTitle ?? undefined}>
            {props.lockedTitle ?? ''}
          </span>
        ) : user ? (
          <input
            className="title-input"
            type="text"
            value={title}
            maxLength={LIMITS.titleMax}
            placeholder="Untitled"
            aria-label="Snippet title"
            onChange={(e) => props.onTitleChange(e.target.value)}
          />
        ) : (
          <span className="title-text" title={title || 'Untitled'}>
            {title || 'Untitled'}
          </span>
        )}
        {props.dirty && <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />}
        {props.locked ? null : props.canEditSettings ? (
          <button
            type="button"
            className={`settings-button visibility-${props.visibility}`}
            onClick={props.onOpenSettings}
            title={`${VISIBILITY_LABELS[props.visibility].hint} Click to change.`}
          >
            <VisibilityIcon visibility={props.visibility} />
            <span>{VISIBILITY_LABELS[props.visibility].label}</span>
          </button>
        ) : (
          props.visibility === 'password' && (
            <span className="badge" title="Password-protected bin">
              password
            </span>
          )
        )}
      </div>

      <div className="toggles" role="group" aria-label="View" hidden={props.locked}>
        <Toggle
          pressed={props.showEditor}
          label="Editor"
          title={props.showEditor ? 'Hide editor' : 'Show editor'}
          onClick={props.onToggleEditor}
          on={<EyeIcon />}
          off={<EyeOffIcon />}
        />
        <Toggle
          pressed={props.showPreview}
          label="Preview"
          title={props.showPreview ? 'Hide preview' : 'Show preview'}
          onClick={props.onTogglePreview}
          on={<EyeIcon />}
          off={<EyeOffIcon />}
        />
        <Toggle
          pressed={props.showConsole}
          label="Console"
          title={props.showConsole ? 'Hide console in preview' : 'Show console in preview'}
          onClick={props.onToggleConsole}
          on={<ConsoleIcon />}
          off={<ConsoleOffIcon />}
        />
        <button
          type="button"
          className={props.paused ? 'toggle toggle-paused' : 'toggle'}
          aria-pressed={props.paused}
          onClick={props.onTogglePaused}
          title={props.paused ? 'Resume live preview' : 'Pause live preview'}
        >
          {props.paused ? <PlayIcon /> : <PauseIcon />}
          <span className="toggle-label">{props.paused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>

      <nav className="actions" aria-label="Snippet">
        <button type="button" onClick={props.onNew} title="New snippet">
          <PlusIcon />
          <span className="action-label">New</span>
        </button>
        {user && (
          <button type="button" onClick={props.onOpenSnippets} title="My snippets">
            <ListIcon />
            <span className="action-label">My snippets</span>
          </button>
        )}
        {props.canFork && !props.locked && (
          <button type="button" onClick={props.onFork} disabled={saving} title="Save a copy as a new snippet">
            <ForkIcon />
            <span className="action-label">Fork</span>
          </button>
        )}
        {!props.locked && (
          <button type="button" className="primary" onClick={props.onSave} disabled={saving} title={saveTitle}>
            {saveMode === 'fork' ? <ForkIcon /> : <SaveIcon />}
            <span className="action-label">{saving ? 'Saving…' : saveLabel}</span>
          </button>
        )}
        {user ? (
          <button type="button" onClick={props.onLogout} title={`Log out ${user.email}`}>
            Log out
          </button>
        ) : (
          <button type="button" onClick={props.onLogin}>
            Log in
          </button>
        )}
      </nav>
    </header>
  );
}
