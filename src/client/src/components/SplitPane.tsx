import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useMediaQuery } from '../hooks/useColorScheme.ts';
import { readItem, writeItem } from '../lib/storage.ts';

interface SplitPaneProps {
  first: ReactNode;
  second: ReactNode;
  showFirst: boolean;
  showSecond: boolean;
}

const STORAGE_KEY = 'bincode:split';
const MIN_PX = 250;
const MIN_PX_STACKED = 120;
const KEY_STEP = 0.02;

function loadRatio(): number {
  const value = Number(readItem(STORAGE_KEY));
  return Number.isFinite(value) && value > 0 && value < 1 ? value : 0.5;
}

function clampRatio(ratio: number, size: number, minPx: number): number {
  if (size <= minPx * 2) return 0.5;
  const min = minPx / size;
  return Math.min(1 - min, Math.max(min, ratio));
}

export function SplitPane({ first, second, showFirst, showSecond }: SplitPaneProps) {
  const stacked = useMediaQuery('(max-width: 768px)');
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(loadRatio);
  const [dragging, setDragging] = useState(false);
  const both = showFirst && showSecond;
  const minPx = stacked ? MIN_PX_STACKED : MIN_PX;

  const ratioAt = (clientX: number, clientY: number): number | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const size = stacked ? rect.height : rect.width;
    const offset = stacked ? clientY - rect.top : clientX - rect.left;
    return clampRatio(offset / size, size, minPx);
  };

  const commit = (next: number) => {
    setRatio(next);
    writeItem(STORAGE_KEY, String(next));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Capture keeps move/up events coming to the handle even over the iframe or outside the window.
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = ratioAt(e.clientX, e.clientY);
    if (next !== null) setRatio(next);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    writeItem(STORAGE_KEY, String(ratio));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const back = stacked ? 'ArrowUp' : 'ArrowLeft';
    const forward = stacked ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== back && e.key !== forward && e.key !== 'Home') return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const size = rect ? (stacked ? rect.height : rect.width) : 0;
    const next = e.key === 'Home' ? 0.5 : ratio + (e.key === forward ? KEY_STEP : -KEY_STEP);
    commit(clampRatio(next, size, minPx));
  };

  const classes = ['split', stacked ? 'split-vertical' : 'split-horizontal'];
  if (dragging) classes.push('dragging');

  return (
    <div ref={containerRef} className={classes.join(' ')}>
      <div
        className="split-pane split-first"
        hidden={!showFirst}
        style={both ? { flexBasis: `${ratio * 100}%` } : undefined}
      >
        {first}
      </div>
      {both && (
        <div
          className="split-handle"
          role="separator"
          aria-orientation={stacked ? 'horizontal' : 'vertical'}
          aria-label="Resize editor and preview"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          onDoubleClick={() => commit(0.5)}
        />
      )}
      {showSecond && <div className="split-pane split-second">{second}</div>}
    </div>
  );
}
