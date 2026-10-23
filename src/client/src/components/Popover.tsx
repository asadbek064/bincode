import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** the button that toggles the popover; clicks on it don't count as "outside" */
  anchorRef: RefObject<HTMLElement | null>;
  /** which edge of the anchor the panel lines up with */
  align?: 'start' | 'end';
  label: string;
  /** 'none' when the content brings its own popup role (the account menu's role="menu") */
  role?: 'dialog' | 'none';
  className?: string;
  children: ReactNode;
}

/**
 * A small panel anchored under a button. The anchor's parent must be `position: relative`
 * (the `.popover-anchor` class). Closes on outside click and Escape, returning focus to the anchor.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  align = 'start',
  label,
  role = 'dialog',
  className,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Short screens (a landscape phone, an open keyboard) would cut the panel's bottom off, and the
  // page itself doesn't scroll; cap it to the space below the anchor and let it scroll instead.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const fit = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      panel.style.maxHeight = `${Math.max(120, viewport - panel.getBoundingClientRect().top - 8)}px`;
    };
    fit();
    window.visualViewport?.addEventListener('resize', fit);
    window.addEventListener('resize', fit);
    return () => {
      window.visualViewport?.removeEventListener('resize', fit);
      window.removeEventListener('resize', fit);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel?.contains(target) || anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current();
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return (
    <div
      ref={panelRef}
      role={role}
      aria-label={role === 'dialog' ? label : undefined}
      className={`popover popover-${align}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}
