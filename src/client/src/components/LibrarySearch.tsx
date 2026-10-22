import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { cachedLibraries, searchLibraries, type CdnLibrary } from '../lib/cdnjs.ts';
import './LibrarySearch.css';

const DEBOUNCE_MS = 250;

interface LibrarySearchProps {
  onInsert: (lib: CdnLibrary) => void;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; results: CdnLibrary[] };

/** Search box + scrollable result list for CDNJS. Rendered inside a Popover by EditorPane. */
export function LibrarySearch({ onInsert }: LibrarySearchProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!debounced) {
      setState({ status: 'idle' });
      return;
    }
    // A repeated query shows its results at once: no "Searching…" flash, no list remount.
    const cached = cachedLibraries(debounced);
    if (cached) {
      setState({ status: 'ready', results: cached });
      setActive(0);
      return;
    }
    // A newer query cancels the one in flight, so results never arrive out of order.
    const controller = new AbortController();
    setState({ status: 'loading' });
    searchLibraries(debounced, controller.signal)
      .then((results) => {
        setState({ status: 'ready', results });
        setActive(0);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [debounced]);

  const results = state.status === 'ready' ? state.results : [];

  // Only keyboard moves scroll the list; a hovered row is already in view.
  const moveTo = (next: number) => {
    setActive(next);
    document.getElementById(`lib-option-${next}`)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveTo((active + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveTo((active - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const lib = results[active];
      if (lib) onInsert(lib);
    }
  };

  return (
    <div className="lib-search">
      <input
        type="search"
        placeholder="Search CDNJS…"
        aria-label="Search CDNJS libraries"
        aria-controls="lib-search-results"
        aria-activedescendant={results.length ? `lib-option-${active}` : undefined}
        value={query}
        maxLength={100}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <p className="form-hint">
        Type a library name to fetch from CDNJS URL - add directly into the HTML panel as a SCRIPT or LINK
      </p>
      {state.status === 'loading' && <p className="muted">Searching…</p>}
      {state.status === 'error' && (
        <p className="form-error" role="alert">
          Could not reach CDNJS.
        </p>
      )}
      {state.status === 'ready' && results.length === 0 && <p className="muted">No libraries found.</p>}
      {results.length > 0 && (
        <ul id="lib-search-results" className="lib-search-results" role="listbox" aria-label="Libraries">
          {results.map((lib, i) => (
            <li
              key={lib.name}
              id={`lib-option-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'lib-option active' : 'lib-option'}
              onMouseEnter={() => setActive(i)}
              // mousedown, not click: keeps focus in the input so the popover doesn't flicker.
              onMouseDown={(e) => {
                e.preventDefault();
                onInsert(lib);
              }}
              title={lib.url}
            >
              <span className="lib-option-head">
                <span className="lib-option-name">{lib.name}</span>
                {lib.version && <span className="badge lib-option-version">{lib.version}</span>}
              </span>
              {lib.description && <span className="lib-option-desc">{lib.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
