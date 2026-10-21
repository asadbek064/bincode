import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { DARK_THEME, LIGHT_THEME, defineThemes, monaco } from '../lib/monaco.ts';
import { readJson, writeJson } from '../lib/storage.ts';
import type { CodeField } from '../hooks/useSnippetEditor.ts';
import { FormatIcon, SettingsIcon } from './Icons.tsx';
import { Popover } from './Popover.tsx';
import './EditorPane.css';

export const TABS: { id: CodeField; label: string; path: string; language: string }[] = [
  { id: 'html', label: 'HTML', path: 'index.html', language: 'html' },
  { id: 'css', label: 'CSS', path: 'style.css', language: 'css' },
  { id: 'js', label: 'JavaScript', path: 'script.js', language: 'javascript' },
];

const OPTIONS = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
  tabSize: 2,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  padding: { top: 8 },
} as const;

const FORMAT_ACTION = 'editor.action.formatDocument';

const FONT_SIZES = [12, 14, 16] as const;
type FontSize = (typeof FONT_SIZES)[number];

interface EditorPrefs {
  fontSize: FontSize;
  wordWrap: boolean;
}

const PREFS_KEY = 'bincode:editor';
const DEFAULT_PREFS: EditorPrefs = { fontSize: 14, wordWrap: true };

/** localStorage is user-editable, so take only well-formed fields and default the rest. */
function loadPrefs(): EditorPrefs {
  const raw = readJson<unknown>(PREFS_KEY);
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const { fontSize, wordWrap } = raw as Record<string, unknown>;
  return {
    fontSize: FONT_SIZES.includes(fontSize as FontSize) ? (fontSize as FontSize) : DEFAULT_PREFS.fontSize,
    wordWrap: typeof wordWrap === 'boolean' ? wordWrap : DEFAULT_PREFS.wordWrap,
  };
}

interface EditorPaneProps {
  activeTab: CodeField;
  onTabChange: (tab: CodeField) => void;
  values: Record<CodeField, string>;
  onChange: (field: CodeField, value: string) => void;
  onSave: () => void;
  /** Ctrl/Cmd+Enter inside the editor */
  onRun?: () => void;
  dark: boolean;
}

export default function EditorPane({ activeTab, onTabChange, values, onChange, onSave, onRun, dark }: EditorPaneProps) {
  // Monaco commands are registered once at mount; refs keep them calling the latest handlers.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onTabRef = useRef(onTabChange);
  onTabRef.current = onTabChange;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [mounted, setMounted] = useState(false);

  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0]!;

  const [prefs, setPrefs] = useState(loadPrefs);
  const updatePrefs = (patch: Partial<EditorPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeJson(PREFS_KEY, next);
      return next;
    });
  };
  const options = useMemo(
    () => ({ ...OPTIONS, fontSize: prefs.fontSize, wordWrap: prefs.wordWrap ? 'on' : 'off' }) as const,
    [prefs],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLButtonElement>(null);

  // The <Editor> only syncs `value` into the visible model. Models for the other
  // tabs keep stale text after a load/reset, so push changes into them directly.
  const synced = useRef<Partial<Record<CodeField, string>>>({});
  useEffect(() => {
    for (const t of TABS) {
      const value = values[t.id];
      if (synced.current[t.id] === value) continue;
      synced.current[t.id] = value;
      if (t.id === activeTab) continue;
      const model = monaco.editor.getModel(monaco.Uri.parse(t.path));
      if (model && model.getValue() !== value) model.setValue(value);
    }
  }, [values, activeTab]);

  const handleMount: OnMount = (editor, m) => {
    editorRef.current = editor;
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => onSaveRef.current());
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => onRunRef.current?.());
    TABS.forEach((t, i) => {
      editor.addCommand(m.KeyMod.CtrlCmd | (m.KeyCode.Digit1 + i), () => onTabRef.current(t.id));
    });
    setMounted(true);
  };

  useEffect(() => {
    editorRef.current?.focus();
  }, [activeTab]);

  // Language services register their formatters lazily (after the first model of that
  // language appears, via a dynamic import), so a check right after a tab switch can
  // say "unsupported" for a moment; retry briefly before settling on disabled.
  const [canFormat, setCanFormat] = useState(false);
  const checkFormat = useCallback(() => {
    const supported = editorRef.current?.getAction(FORMAT_ACTION)?.isSupported() ?? false;
    setCanFormat(supported);
    return supported;
  }, []);
  useEffect(() => {
    if (!mounted) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (checkFormat() || ++tries >= 20) return;
      timer = setTimeout(attempt, 250);
    };
    // Wait a frame so <Editor> has swapped to this tab's model.
    timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [activeTab, mounted, checkFormat]);

  const format = () => {
    const editor = editorRef.current;
    const action = editor?.getAction(FORMAT_ACTION);
    if (!editor || !action?.isSupported()) return;
    editor.focus();
    void action.run();
  };

  return (
    <div className="editor-pane">
      <div className="editor-header">
        <div className="tab-bar" role="tablist" aria-label="Code">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === activeTab}
              className={t.id === activeTab ? 'tab active' : 'tab'}
              onClick={() => onTabChange(t.id)}
              title={`${t.label} (Ctrl+${i + 1})`}
            >
              <span className={`tab-dot tab-dot-${t.id}`} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Format code"
            title="Format code (Shift+Alt+F)"
            disabled={!canFormat}
            onClick={format}
          >
            <FormatIcon />
          </button>
          <div className="popover-anchor">
            <button
              ref={settingsRef}
              type="button"
              className={settingsOpen ? 'icon-button open' : 'icon-button'}
              aria-label="Editor settings"
              title="Editor settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <SettingsIcon />
            </button>
            <Popover
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              anchorRef={settingsRef}
              align="end"
              label="Editor settings"
              className="editor-settings"
            >
              <div className="editor-setting">
                <span id="editor-font-size">Font size</span>
                <div className="segmented" role="group" aria-labelledby="editor-font-size">
                  {FONT_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={prefs.fontSize === size ? 'segment selected' : 'segment'}
                      aria-pressed={prefs.fontSize === size}
                      onClick={() => updatePrefs({ fontSize: size })}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="editor-setting">
                <span id="editor-word-wrap">Word wrap</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.wordWrap}
                  aria-labelledby="editor-word-wrap"
                  className={prefs.wordWrap ? 'switch on' : 'switch'}
                  onClick={() => updatePrefs({ wordWrap: !prefs.wordWrap })}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            </Popover>
          </div>
        </div>
      </div>
      <div className="editor-content" role="tabpanel">
        <Editor
          path={tab.path}
          language={tab.language}
          value={values[tab.id]}
          onChange={(value) => onChange(tab.id, value ?? '')}
          beforeMount={defineThemes}
          onMount={handleMount}
          theme={dark ? DARK_THEME : LIGHT_THEME}
          options={options}
          loading={<div className="editor-loading">Loading editor…</div>}
        />
      </div>
    </div>
  );
}
