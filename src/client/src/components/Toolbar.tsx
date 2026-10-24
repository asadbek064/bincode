import type { ReactNode } from 'react';
import type { User, Visibility } from '../../../shared/api.ts';
import { DEFAULT_TITLE, LIMITS } from '../../../shared/constants.ts';
import { AccountMenu } from './AccountMenu.tsx';
import { CodeIcon, ConsoleIcon, EyeIcon, ForkIcon, KeyIcon, LinkIcon, LockIcon, PauseIcon, PlayIcon, SaveIcon } from './Icons.tsx';
import { SharePopover } from './SharePopover.tsx';
import type { SharePopoverProps } from './SharePopover.tsx';
import './Toolbar.css';

export interface ToolbarProps {
  user: User | null;
  title: string;
  onTitleChange: (title: string) => void;
  /** the editor holds changes that aren't saved */
  dirty: boolean;
  /** the open bin exists on the server (drives the "Saved" status) */
  saved: boolean;
  /** what the main action does for the current snippet */
  saveMode: 'save' | 'update' | 'fork';
  /** offer "Fork" in the account menu (for snippets you own; Save already forks others') */
  canFork: boolean;
  saving: boolean;
  /** a locked, missing or loading bin is on screen: only brand, its title and the account control */
  locked: boolean;
  /** title of the locked bin, shown read-only */
  lockedTitle: string | null;
  showEditor: boolean;
  showPreview: boolean;
  showConsole: boolean;
  paused: boolean;
  /** console entries of the current run (badge on the Console toggle; 0 hides it) */
  consoleCount: number;
  /** errors among them (turns the badge red) */
  consoleErrors: number;
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
  onExport: () => void;
  onImport: (file: File) => void;
  /** the Share button; `user` and `dirty` are filled in from the props above */
  share: Omit<SharePopoverProps, 'user' | 'dirty'>;
}

export function VisibilityIcon({ visibility }: { visibility: Visibility }) {
  if (visibility === 'private') return <LockIcon />;
  if (visibility === 'password') return <KeyIcon />;
  return <LinkIcon />;
}

// Shortcut hints follow the platform; the handlers accept both Ctrl and Cmd.
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

interface ToggleProps {
  pressed: boolean;
  label: string;
  title: string;
  onClick: () => void;
  icon: ReactNode;
  badge?: ReactNode;
}

function Toggle({ pressed, label, title, onClick, icon, badge }: ToggleProps) {
  return (
    <button type="button" className="nav-toggle" aria-pressed={pressed} onClick={onClick} title={title}>
      {icon}
      <span className="nav-label">{label}</span>
      {badge}
    </button>
  );
}

function SaveStatus({ saving, saved, dirty }: { saving: boolean; saved: boolean; dirty: boolean }) {
  const status = saving ? 'saving' : dirty ? 'unsaved' : saved ? 'saved' : null;
  if (!status) return null;
  const label = status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved' : 'Saved';
  return (
    <span className={`nav-status nav-status-${status}`} role="status">
      <span className="nav-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Toolbar(props: ToolbarProps) {
  const { user, title, saveMode, saving, locked } = props;
  const saveLabel = saveMode === 'fork' ? 'Fork' : 'Save';
  const saveTitle =
    saveMode === 'fork'
      ? `Save a copy of this bin to your account (${MOD}S)`
      : saveMode === 'update'
        ? `Save changes to this bin (${MOD}S)`
        : `Save and get a share link (${MOD}S)`;

  return (
    <header className="toolbar navbar">
      <div className="nav-left">
        <a
          className="nav-brand"
          href="/"
          title="New bin"
          onClick={(e) => {
            e.preventDefault();
            props.onNew();
          }}
        >
          <img src="/logo/favicon.svg" alt="" width="28" height="28" />
          <span className="nav-brand-name">BinCode</span>
        </a>

        <div className="nav-title-area">
          {locked ? (
            <span className="nav-title-text" title={props.lockedTitle ?? undefined}>
              {props.lockedTitle ?? ''}
            </span>
          ) : user ? (
            <input
              className="nav-title-input"
              type="text"
              value={title}
              maxLength={LIMITS.titleMax}
              placeholder={DEFAULT_TITLE}
              aria-label="Bin title"
              onChange={(e) => props.onTitleChange(e.target.value)}
            />
          ) : (
            <span className="nav-title-text" title={title || DEFAULT_TITLE}>
              {title || DEFAULT_TITLE}
            </span>
          )}
          {!locked && <SaveStatus saving={saving} saved={props.saved} dirty={props.dirty} />}
        </div>
      </div>

      {!locked && (
        <div className="nav-center" role="group" aria-label="View">
          <Toggle
            pressed={props.showEditor}
            label="Editor"
            title={props.showEditor ? 'Hide editor' : 'Show editor'}
            onClick={props.onToggleEditor}
            icon={<CodeIcon />}
          />
          <Toggle
            pressed={props.showPreview}
            label="Preview"
            title={props.showPreview ? 'Hide preview' : 'Show preview'}
            onClick={props.onTogglePreview}
            icon={<EyeIcon />}
          />
          <Toggle
            pressed={props.showConsole}
            label="Console"
            title={props.showConsole ? 'Hide console' : 'Show console'}
            onClick={props.onToggleConsole}
            icon={<ConsoleIcon />}
            badge={
              props.consoleCount > 0 && (
                <>
                  <span
                    className={props.consoleErrors > 0 ? 'nav-badge nav-badge-error' : 'nav-badge'}
                    aria-hidden="true"
                  >
                    {props.consoleCount > 99 ? '99+' : props.consoleCount}
                  </span>
                  <span className="visually-hidden">
                    {`, ${props.consoleCount} ${props.consoleCount === 1 ? 'entry' : 'entries'}`}
                    {props.consoleErrors > 0 &&
                      `, ${props.consoleErrors} ${props.consoleErrors === 1 ? 'error' : 'errors'}`}
                  </span>
                </>
              )
            }
          />
        </div>
      )}

      <div className="nav-right" role="group" aria-label="Bin actions">
        {!locked && (
          <>
            <button
              type="button"
              className={props.paused ? 'nav-run nav-run-paused' : 'nav-run'}
              onClick={props.onTogglePaused}
              title={props.paused ? `Run and resume live preview (${MOD}Enter)` : 'Pause live preview'}
              aria-label={props.paused ? 'Run' : 'Pause'}
            >
              {props.paused ? <PlayIcon /> : <PauseIcon />}
              <span className="nav-label">{props.paused ? 'Run' : 'Pause'}</span>
              {props.paused && <kbd className="nav-kbd">{MOD}↵</kbd>}
            </button>
            <SharePopover {...props.share} user={user} dirty={props.dirty} />
            <button
              type="button"
              className="primary nav-save"
              onClick={props.onSave}
              disabled={saving}
              title={saveTitle}
              aria-label={saveLabel}
            >
              {saveMode === 'fork' ? <ForkIcon /> : <SaveIcon />}
              <span className="nav-label">{saving ? 'Saving…' : saveLabel}</span>
              <kbd className="nav-kbd">{MOD}S</kbd>
            </button>
          </>
        )}
        {user ? (
          <AccountMenu
            user={user}
            canFork={props.canFork && !locked}
            onOpenSnippets={props.onOpenSnippets}
            onNew={props.onNew}
            onFork={props.onFork}
            onExport={props.onExport}
            onImport={props.onImport}
            onLogout={props.onLogout}
          />
        ) : (
          <button type="button" className="nav-login" onClick={props.onLogin}>
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
