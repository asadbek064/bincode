import { useEffect, useRef, useState } from 'react';
import { PREVIEW_CONSOLE, PREVIEW_PATH, PREVIEW_READY, PREVIEW_RENDER } from '../../../shared/constants.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { CONSOLE_LEVELS, type ConsoleLevel } from '../lib/consoleTypes.ts';
import { buildPreviewDocument } from '../lib/previewDoc.ts';

export interface PreviewCode {
  html: string;
  css: string;
  js: string;
}

export interface PreviewPaneProps {
  /** must be referentially stable between edits, or the debounce never settles */
  code: PreviewCode;
  paused: boolean;
  /** bump to re-run the current code now, even if unchanged or paused */
  runId: number;
  /** a console message from the running snippet; `text` is untrusted */
  onConsole: (entry: { level: ConsoleLevel; text: string }) => void;
  /** a fresh run started (new iframe), so earlier console output is stale */
  onRun: () => void;
}

const DEBOUNCE_MS = 500;
// The frame already truncates each argument; this bounds a message from a frame that doesn't.
const MAX_TEXT = 10_000;

function isConsoleLevel(value: unknown): value is ConsoleLevel {
  return typeof value === 'string' && (CONSOLE_LEVELS as readonly string[]).includes(value);
}

export function PreviewPane({ code, paused, runId, onConsole, onRun }: PreviewPaneProps) {
  const debounced = useDebouncedValue(code, DEBOUNCE_MS);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frame, setFrame] = useState(() => ({ key: 0, doc: buildPreviewDocument(code) }));

  // Refs keep the message listener current without re-subscribing on every render.
  const docRef = useRef(frame.doc);
  docRef.current = frame.doc;
  const codeRef = useRef(code);
  codeRef.current = code;
  const onConsoleRef = useRef(onConsole);
  onConsoleRef.current = onConsole;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  // A fresh iframe per render so timers, listeners and globals from the previous
  // run can't leak into the next one. While paused, the last document stays up.
  useEffect(() => {
    if (paused) return;
    const doc = buildPreviewDocument(debounced);
    setFrame((f) => (f.doc === doc ? f : { key: f.key + 1, doc }));
  }, [debounced, paused]);

  // An explicit run uses the latest (not debounced) code and always remounts.
  const lastRunId = useRef(runId);
  useEffect(() => {
    if (lastRunId.current === runId) return;
    lastRunId.current = runId;
    setFrame((f) => ({ key: f.key + 1, doc: buildPreviewDocument(codeRef.current) }));
  }, [runId]);

  useEffect(() => {
    onRunRef.current();
  }, [frame.key]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only the current frame counts: a replaced one may still be posting.
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data: unknown = event.data;
      if (!data || typeof data !== 'object') return;
      const msg = data as { type?: unknown; level?: unknown; text?: unknown };
      if (msg.type === PREVIEW_READY) {
        // The frame has an opaque origin, so '*' is the only target that matches it.
        win.postMessage({ type: PREVIEW_RENDER, doc: docRef.current }, '*');
      } else if (msg.type === PREVIEW_CONSOLE && isConsoleLevel(msg.level) && typeof msg.text === 'string') {
        onConsoleRef.current({ level: msg.level, text: msg.text.slice(0, MAX_TEXT) });
      }
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
