import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { monaco } from '../lib/monaco.ts';
import type { CodeField } from '../hooks/useSnippetEditor.ts';
import { CssIcon, HtmlIcon, JsIcon } from './Icons.tsx';

export const TABS: { id: CodeField; label: string; path: string; language: string; Icon: typeof HtmlIcon }[] = [
  { id: 'html', label: 'HTML', path: 'index.html', language: 'html', Icon: HtmlIcon },
  { id: 'css', label: 'CSS', path: 'style.css', language: 'css', Icon: CssIcon },
  { id: 'js', label: 'JavaScript', path: 'script.js', language: 'javascript', Icon: JsIcon },
];

const OPTIONS = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  padding: { top: 8 },
} as const;

interface EditorPaneProps {
  activeTab: CodeField;
  onTabChange: (tab: CodeField) => void;
  values: Record<CodeField, string>;
  onChange: (field: CodeField, value: string) => void;
  onSave: () => void;
  dark: boolean;
}

export default function EditorPane({ activeTab, onTabChange, values, onChange, onSave, dark }: EditorPaneProps) {
  // Monaco commands are registered once at mount; refs keep them calling the latest handlers.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onTabRef = useRef(onTabChange);
  onTabRef.current = onTabChange;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0]!;

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
    TABS.forEach((t, i) => {
      editor.addCommand(m.KeyMod.CtrlCmd | (m.KeyCode.Digit1 + i), () => onTabRef.current(t.id));
    });
  };

  useEffect(() => {
    editorRef.current?.focus();
  }, [activeTab]);

  return (
    <div className="editor-pane">
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
            <t.Icon className="tab-icon" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="editor-content" role="tabpanel">
        <Editor
          path={tab.path}
          language={tab.language}
          value={values[tab.id]}
          onChange={(value) => onChange(tab.id, value ?? '')}
          onMount={handleMount}
          theme={dark ? 'vs-dark' : 'vs'}
          options={OPTIONS}
          loading={<div className="editor-loading">Loading editor…</div>}
        />
      </div>
    </div>
  );
}
