import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleCounts } from '../hooks/useConsoleLog.ts';
import type { ConsoleEntry, ConsoleLevel } from '../lib/consoleTypes.ts';
import { CloseIcon } from './Icons.tsx';
import './ConsoleDrawer.css';

export interface ConsoleDrawerProps {
  entries: ConsoleEntry[];
  counts: ConsoleCounts;
  onClear: () => void;
  onClose: () => void;
}

type Filter = 'all' | 'warn' | 'error';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

// Within this many px of the bottom counts as "following" the output.
const STICK_PX = 8;

// Warnings and errors also differ by colour; the mark keeps them apart without it.
const LEVEL_MARKS: Partial<Record<ConsoleLevel, { glyph: string; label: string }>> = {
  warn: { glyph: '▲', label: 'Warning' },
  error: { glyph: '✕', label: 'Error' },
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Entries are immutable, so a row only renders once even as the log keeps growing.
const ConsoleRow = memo(function ConsoleRow({ entry }: { entry: ConsoleEntry }) {
  const mark = LEVEL_MARKS[entry.level];
  return (
    <div className={`console-row console-${entry.level}`}>
      <time className="console-time">{formatTime(entry.time)}</time>
      <span className="console-mark" aria-hidden="true">
        {mark?.glyph}
      </span>
      <span className="console-text">
        {mark && <span className="visually-hidden">{mark.label}: </span>}
        {entry.text}
      </span>
    </div>
  );
});

// Memoised: App re-renders on every keystroke, the drawer only needs to when the log changes.
export const ConsoleDrawer = memo(function ConsoleDrawer({ entries, counts, onClear, onClose }: ConsoleDrawerProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const visible = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.level === filter)),
    [entries, filter],
  );
  const lastId = visible.at(-1)?.id ?? 0;

  // Follow new output unless the user scrolled up to read something.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lastId, visible.length]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  };

  const clear = () => {
    stickRef.current = true;
    onClear();
  };

  return (
    <section className="console-drawer" aria-label="Console">
      <div className="console-header">
        <span className="console-title">Console</span>
        <div className="segmented console-filter" role="group" aria-label="Filter console">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`segment${filter === value ? ' selected' : ''}`}
              aria-pressed={filter === value}
              onClick={() => {
                stickRef.current = true;
                setFilter(value);
              }}
            >
              {label}
              {counts[value] > 0 && <span className="console-count">{counts[value]}</span>}
            </button>
          ))}
        </div>
        <span className="console-spacer" />
        <button type="button" className="console-clear" onClick={clear} disabled={entries.length === 0}>
          Clear
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close console" title="Close console">
          <CloseIcon />
        </button>
      </div>
      <div className="console-body" ref={bodyRef} onScroll={onScroll} role="log" aria-live="polite">
        {visible.length === 0 ? (
          <div className="console-empty">No console output</div>
        ) : (
          // Text comes from untrusted snippet code: rendered as React text, never as HTML.
          visible.map((e) => <ConsoleRow key={e.id} entry={e} />)
        )}
      </div>
    </section>
  );
});
