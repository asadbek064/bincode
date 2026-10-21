import { useCallback, useMemo, useRef, useState } from 'react';
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

  const push = useCallback((entry: { level: ConsoleLevel; text: string }) => {
    const item: ConsoleEntry = { id: nextId.current++, level: entry.level, text: entry.text, time: Date.now() };
    setEntries((prev) => {
      const next = prev.length >= MAX_ENTRIES ? prev.slice(prev.length - MAX_ENTRIES + 1) : prev.slice();
      next.push(item);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries((prev) => (prev.length ? [] : prev));
  }, []);

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
