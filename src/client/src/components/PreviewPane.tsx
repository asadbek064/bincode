import { useEffect, useRef, useState } from 'react';
import { PREVIEW_PATH, PREVIEW_READY, PREVIEW_RENDER } from '../../../shared/constants.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { buildPreviewDocument } from '../lib/previewDoc.ts';

export interface PreviewCode {
  html: string;
  css: string;
  js: string;
}

interface PreviewPaneProps {
  /** must be referentially stable between edits, or the debounce never settles */
  code: PreviewCode;
  console: boolean;
  paused: boolean;
}

const DEBOUNCE_MS = 500;

export function PreviewPane({ code, console: showConsole, paused }: PreviewPaneProps) {
  const debounced = useDebouncedValue(code, DEBOUNCE_MS);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frame, setFrame] = useState(() => ({
    key: 0,
    doc: buildPreviewDocument({ ...code, console: showConsole }),
  }));
  const docRef = useRef(frame.doc);
  docRef.current = frame.doc;

  // A fresh iframe per render so timers, listeners and globals from the previous
  // run can't leak into the next one. While paused, the last document stays up.
  useEffect(() => {
    if (paused) return;
    const doc = buildPreviewDocument({ ...debounced, console: showConsole });
    setFrame((f) => (f.doc === doc ? f : { key: f.key + 1, doc }));
  }, [debounced, showConsole, paused]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data: unknown = event.data;
      if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== PREVIEW_READY) return;
      // The frame has an opaque origin, so '*' is the only target that matches it.
      win.postMessage({ type: PREVIEW_RENDER, doc: docRef.current }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="preview-pane">
      {paused && <div className="preview-badge">Paused</div>}
      <iframe
        key={frame.key}
        ref={iframeRef}
        src={PREVIEW_PATH}
        title="Preview"
        // Never add allow-same-origin: the frame would then share our origin and could read the auth token.
        sandbox="allow-scripts allow-modals allow-forms allow-popups"
      />
    </div>
  );
}
