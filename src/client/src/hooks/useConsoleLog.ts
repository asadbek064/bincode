import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleEntry, ConsoleLevel } from '../lib/consoleTypes.ts';

// The frame caps itself at 1000 messages per run; the drawer only needs the recent tail.
const MAX_ENTRIES = 500;

export interface ConsoleCounts {
  all: number;
  warn: number;
  error: number;
}

export interface ConsoleLog {
  entries: ConsoleEntry[];
  counts: ConsoleCounts;
  push(entry: { level: ConsoleLevel; text: string }): void;
  clear(): void;
}

export function useConsoleLog(): ConsoleLog {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  // Ids keep increasing across clears so React keys never get reused.
  const nextId = useRef(1);
  // Messages are batched per frame: a snippet logging from a loop, a timer or requestAnimationFrame
  // would otherwise re-render the whole app once per message.
  const pending = useRef<ConsoleEntry[]>([]);
  const frame = useRef(0);

  const flush = useCallback(() => {
    frame.current = 0;
    const batch = pending.current;
    pending.current = [];
    setEntries((prev) => {
      const next = prev.concat(batch);
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  const push = useCallback(
    (entry: { level: ConsoleLevel; text: string }) => {
      const queue = pending.current;
      queue.push({ id: nextId.current++, level: entry.level, text: entry.text, time: Date.now() });
      // Frames don't run in background tabs; keep the queue bounded until they do.
      if (queue.length > MAX_ENTRIES) queue.splice(0, queue.length - MAX_ENTRIES);
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const clear = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = [];
    setEntries((prev) => (prev.length ? [] : prev));
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const counts = useMemo<ConsoleCounts>(() => {
    let warn = 0;
    let error = 0;
    for (const e of entries) {
      if (e.level === 'warn') warn++;
      else if (e.level === 'error') error++;
    }
    return { all: entries.length, warn, error };
  }, [entries]);

  return { entries, counts, push, clear };
}
