import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { User } from '../../../shared/api.ts';
import { DownloadIcon, ForkIcon, ListIcon, LogoutIcon, PlusIcon, UploadIcon } from './Icons.tsx';
import { Popover } from './Popover.tsx';

export interface AccountMenuProps {
  user: User;
  /** show "Fork" (the Save button already forks bins you don't own) */
  canFork: boolean;
  onOpenSnippets: () => void;
  onNew: () => void;
  onFork: () => void;
  onExport: () => void;
  /** a backup file was picked */
  onImport: (file: File) => void;
  onLogout: () => void;
}

/** The avatar in the navbar and its menu. */
export function AccountMenu({ user, canFork, onOpenSnippets, onNew, onFork, onExport, onImport, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const items = [
    { label: 'My bins', icon: <ListIcon />, run: onOpenSnippets },
    { label: 'New bin', icon: <PlusIcon />, run: onNew },
    ...(canFork ? [{ label: 'Fork', icon: <ForkIcon />, run: onFork }] : []),
    { label: 'Export backup', icon: <DownloadIcon />, run: onExport },
    { label: 'Import backup…', icon: <UploadIcon />, run: () => fileRef.current?.click() },
    { label: 'Sign out', icon: <LogoutIcon />, run: onLogout },
  ];

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A menu is one Tab stop: arrows move inside it, Tab closes it back to the avatar.
    if (e.key === 'Tab') {
      e.preventDefault();
      setOpen(false);
      anchorRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div className="popover-anchor">
      <input
        ref={fileRef}
        type="file"
        accept=".br,.json,application/json,application/octet-stream"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same file again still fires change.
          e.target.value = '';
          if (file) onImport(file);
        }}
      />
      <button
        ref={anchorRef}
        type="button"
        className="nav-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.email}`}
        title={user.email}
        onClick={() => setOpen((o) => !o)}
      >
        {user.email.charAt(0).toUpperCase()}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        align="end"
        label="Account"
        role="none"
        className="account-menu"
      >
        <p className="account-email" title={user.email}>
          {user.email}
        </p>
        <div ref={menuRef} role="menu" aria-label="Account" onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="account-item"
              onClick={() => {
                setOpen(false);
                // Back to the avatar first, so a modal opened by the item returns focus there.
                anchorRef.current?.focus();
                item.run();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
