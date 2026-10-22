import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { User } from '../../../shared/api.ts';
import { ForkIcon, ListIcon, LogoutIcon, PlusIcon } from './Icons.tsx';
import { Popover } from './Popover.tsx';

export interface AccountMenuProps {
  user: User;
  /** show "Fork" (the Save button already forks bins you don't own) */
  canFork: boolean;
  onOpenSnippets: () => void;
  onNew: () => void;
  onFork: () => void;
  onLogout: () => void;
}

/** The avatar in the navbar and its menu. */
export function AccountMenu({ user, canFork, onOpenSnippets, onNew, onFork, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = [
    { label: 'My bins', icon: <ListIcon />, run: onOpenSnippets },
    { label: 'New bin', icon: <PlusIcon />, run: onNew },
    ...(canFork ? [{ label: 'Fork', icon: <ForkIcon />, run: onFork }] : []),
    { label: 'Sign out', icon: <LogoutIcon />, run: onLogout },
  ];

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
              className="account-item"
              onClick={() => {
                setOpen(false);
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
