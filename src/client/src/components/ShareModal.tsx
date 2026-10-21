import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard.ts';
import { Modal } from './Modal.tsx';

interface ShareModalProps {
  url: string;
  onClose: () => void;
}

export function ShareModal({ url, onClose }: ShareModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (status === 'idle') return;
    const id = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(id);
  }, [status]);

  const onCopy = async () => {
    const ok = await copyText(url);
    // Leave the text selected so a manual Ctrl+C works if copying was blocked.
    inputRef.current?.select();
    setStatus(ok ? 'copied' : 'failed');
  };

  return (
    <Modal title="Share snippet" onClose={onClose}>
      <p className="muted">Anyone with this link can view and fork your snippet.</p>
      <div className="share-row">
        <input
          ref={inputRef}
          type="text"
          value={url}
          readOnly
          aria-label="Share link"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="primary" onClick={onCopy}>
          {status === 'copied' ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="form-hint" role="status" aria-live="polite">
        {status === 'failed' ? 'Copy failed. Press Ctrl+C to copy the selected link.' : ''}
      </p>
    </Modal>
  );
}
