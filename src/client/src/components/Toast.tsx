import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  // Errors stay until dismissed; others wait while hovered or focused, so they can be read.
  const [paused, setPaused] = useState(false);
  // A replaced toast never fires pointerleave.
  useEffect(() => setPaused(false), [toast?.id]);
  useEffect(() => {
    if (!toast || toast.kind === 'error' || paused) return;
    const id = window.setTimeout(onDismiss, 2500);
    return () => window.clearTimeout(id);
  }, [toast, onDismiss, paused]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <span>{toast.text}</span>
          <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
