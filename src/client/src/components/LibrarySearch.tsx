import { useEffect, useId, useState } from 'react';
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
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;

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
    document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
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
        role="combobox"
        placeholder="Search CDNJS…"
        aria-label="Search CDNJS libraries"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls={results.length ? listId : undefined}
        aria-activedescendant={results.length ? optionId(active) : undefined}
        value={query}
        maxLength={100}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <p className="form-hint">
        Adds a &lt;script&gt; or &lt;link&gt; tag to the HTML panel.
      </p>
      {/* Always mounted, so screen readers announce each change of the search status. */}
      <div role="status" aria-live="polite">
        {state.status === 'loading' && <p className="muted">Searching…</p>}
        {state.status === 'ready' && results.length === 0 && <p className="muted">No libraries found.</p>}
        {results.length > 0 && (
          <span className="visually-hidden">
            {results.length} {results.length === 1 ? 'library' : 'libraries'} found
          </span>
        )}
      </div>
      {state.status === 'error' && (
        <p className="form-error" role="alert">
          Could not reach CDNJS.
        </p>
      )}
      {results.length > 0 && (
        <ul id={listId} className="lib-search-results" role="listbox" aria-label="Libraries">
          {results.map((lib, i) => (
            <li
              key={lib.name}
              id={optionId(i)}
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
