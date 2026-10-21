import { useEffect, useRef } from 'react';

interface Shortcuts {
  onSave: () => void;
  /** index 0..2 for Ctrl/Cmd+1..3 */
  onTab: (index: number) => void;
  /** Ctrl/Cmd+Enter */
  onRun?: () => void;
}

/** Global shortcuts for when focus is outside Monaco (Monaco registers its own Ctrl+S / Ctrl+Enter). */
export function useKeyboardShortcuts(shortcuts: Shortcuts): void {
  // Ref so the listener is registered once but always calls the latest handlers.
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current.onSave();
        return;
      }
      if (e.key === 'Enter') {
        // Leave Ctrl+Enter alone (e.g. in a form) when nobody handles it.
        if (!ref.current.onRun) return;
        e.preventDefault();
        ref.current.onRun();
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        ref.current.onTab(Number(e.key) - 1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
