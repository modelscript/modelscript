// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Code editor component that delegates all language intelligence to the
 * LSP server via the Monaco-LSP adapter across all 44 ModelScript languages.
 */

import { Editor, loader, type Theme } from "@monaco-editor/react";
import debounce from "lodash/debounce";
import * as monaco from "monaco-editor";
import { editor, type IDisposable } from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import React, { useCallback, useEffect, useRef } from "react";
import styledImport from "styled-components";
import { useModelingPreferences } from "../../ModelingPreferencesContext";
import { ensureMonacoThemesDefined, getMonacoThemeName } from "../../util/monaco-theme";
import { didChange, didChangeVisibleRanges, didOpen } from "./util/lsp-bridge";
import { getLsp, startLsp } from "./util/lsp-worker";
import { registerAllModelscriptLanguages, setupMonacoLspAdapter } from "./util/monaco-lsp-adapter";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const CodeEditorContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
`;

const EditorSurfaceWrapper = styled.div`
  flex: 1;
  min-height: 0;
  width: 100%;
  position: relative;
`;

const MobileAccessoryBar = styled.div`
  display: none;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  background: var(--surface-panel, rgba(14, 20, 36, 0.96));
  border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  flex-shrink: 0;
  z-index: 5;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (max-width: 767px), (pointer: coarse) {
    display: flex;
  }
`;

const AccessoryKeyButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 32px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.14));
  background: var(--color-bg-elevated, rgba(255, 255, 255, 0.06));
  color: var(--color-text-primary, #f8fafc);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;

  &:active {
    background: var(--color-accent-subtle, rgba(56, 189, 248, 0.18));
    border-color: var(--color-accent-primary, #38bdf8);
    color: var(--color-accent-primary, #38bdf8);
  }
`;

interface QuickSymbol {
  label: string;
  insertText: string;
  cursorOffset?: number;
  title: string;
}

const MOBILE_ENGINEERING_SYMBOLS: QuickSymbol[] = [
  { label: "=", insertText: " = ", title: "Insert equals" },
  { label: ":=", insertText: " := ", title: "Insert assignment (:=)" },
  { label: ";", insertText: ";", title: "Insert semicolon" },
  { label: "der()", insertText: "der()", cursorOffset: -1, title: "Insert time derivative der()" },
  { label: "connect()", insertText: "connect(, )", cursorOffset: -3, title: "Insert connect(a, b)" },
  { label: "( )", insertText: "()", cursorOffset: -1, title: "Insert parentheses" },
  { label: "[ ]", insertText: "[]", cursorOffset: -1, title: "Insert brackets" },
  { label: "{ }", insertText: "{}", cursorOffset: -1, title: "Insert braces" },
  { label: "^", insertText: "^", title: "Insert exponent (^)" },
  { label: "_", insertText: "_", title: "Insert underscore (_)" },
  { label: "param", insertText: "parameter Real ", title: "Insert parameter Real declaration" },
  { label: "equation", insertText: "equation\n  ", title: "Insert equation section" },
];

// ────────────────────────────────────────────────────────────────────
// Monaco environment (editor web worker — NOT the LSP worker)
// ────────────────────────────────────────────────────────────────────

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker: function () {
      return new editorWorker();
    },
  };
  loader.config({ monaco });
}

if (typeof window !== "undefined") {
  (window as any).monaco = monaco;
}

// ────────────────────────────────────────────────────────────────────
// Props & Handle
// ────────────────────────────────────────────────────────────────────

interface CodeEditorProps {
  content: string;
  uri: string;
  languageId?: string | undefined;
  setEditor: (editor: editor.ICodeEditor) => void;
  onChange?: ((value: string) => void) | undefined;
  onProgress?: ((progress: number, message: string) => void) | undefined;
  onParsed?: (() => void) | undefined;
  onDiagnostics?: ((markers: editor.IMarkerData[]) => void) | undefined;
  onStatusChange?: ((state: string, message: string) => void) | undefined;
  theme: Theme;
  embed: boolean;
  readOnly?: boolean | undefined;
  hideMinimap?: boolean | undefined;
  externalErrors?: string[] | undefined;
  externalMarkers?: editor.IMarkerData[] | undefined;
}

export interface CodeEditorHandle {
  /** Trigger the LSP to re-validate the current content. */
  sync: () => Promise<void>;
  /** Scroll to and select the definition of a component. */
  revealComponent: (name: string) => void;
  /** Return the underlying Monaco editor instance. */
  getEditor: () => editor.ICodeEditor | null;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>((props, ref) => {
  const { preferences: modelingPrefs } = useModelingPreferences();
  const editorFontSize = modelingPrefs.editorFontSize ?? modelingPrefs.fontSize ?? 14;
  const editorTabSize = modelingPrefs.editorTabSize ?? modelingPrefs.tabSize ?? 2;
  const editorWordWrap = modelingPrefs.editorWordWrap ?? modelingPrefs.wordWrap ?? "on";
  const editorLineNumbers = modelingPrefs.editorLineNumbers ?? modelingPrefs.lineNumbers ?? "on";
  const editorMinimap = props.hideMinimap
    ? false
    : (modelingPrefs.editorMinimap ?? modelingPrefs.minimapEnabled ?? true);
  const bracketPairColorization = modelingPrefs.bracketPairColorization ?? true;
  const lintOnType = modelingPrefs.lintOnType ?? true;

  const editorRef = useRef<editor.ICodeEditor>(null);
  const adapterDisposableRef = useRef<IDisposable | null>(null);
  const didOpenSentRef = useRef(false);
  const lastValueRef = useRef<string | undefined>(undefined);
  const uriRef = useRef(props.uri);
  const languageIdRef = useRef(props.languageId ?? "modelica");
  const lintOnTypeRef = useRef(lintOnType);
  uriRef.current = props.uri;
  languageIdRef.current = props.languageId ?? "modelica";
  lintOnTypeRef.current = lintOnType;

  // ── Sync Monaco editor options when user preferences change ──
  useEffect(() => {
    if (!editorRef.current || props.embed) return;
    editorRef.current.updateOptions({
      fontSize: editorFontSize,
      wordWrap: editorWordWrap,
      lineNumbers: editorLineNumbers,
      minimap: { enabled: editorMinimap },
      bracketPairColorization: { enabled: bracketPairColorization },
    });
    editorRef.current.getModel()?.updateOptions({ tabSize: editorTabSize });
  }, [
    props.embed,
    editorFontSize,
    editorTabSize,
    editorWordWrap,
    editorLineNumbers,
    editorMinimap,
    bracketPairColorization,
  ]);

  // ── LSP adapter setup (runs once on mount) ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      props.onProgress?.(20, "Initializing modeling & simulation engine…");
      const connection = await startLsp(languageIdRef.current);
      if (cancelled) return;

      props.onProgress?.(40, "Connecting editor to compiler runtime…");

      // Register Monaco providers that proxy to the LSP
      adapterDisposableRef.current = setupMonacoLspAdapter(monaco, connection as any, uriRef.current, {
        onDiagnostics: (_uri, markers) => {
          if (_uri === uriRef.current) {
            props.onDiagnostics?.(markers);
          }
        },
        onStatus: (state, message) => {
          props.onStatusChange?.(state, message);
        },
      });

      props.onProgress?.(100, "Ready");
    })();

    return () => {
      cancelled = true;
      adapterDisposableRef.current?.dispose();
    };
  }, []);

  // ── Re-notify LSP when document URI or languageId changes ──
  useEffect(() => {
    if (!didOpenSentRef.current) return;
    const value = editorRef.current?.getValue() ?? props.content;
    lastValueRef.current = value;
    didOpen(props.uri, value, props.languageId ?? "modelica");
  }, [props.uri, props.languageId]);

  // ── Send external errors / markers as additional markers ──
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;

    const extras: editor.IMarkerData[] = [];
    if (props.externalErrors && props.externalErrors.length > 0) {
      for (const err of props.externalErrors) {
        extras.push({
          message: err,
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
          severity: monaco.MarkerSeverity.Error,
        });
      }
    }
    if (props.externalMarkers && props.externalMarkers.length > 0) {
      extras.push(...props.externalMarkers);
    }
    monaco.editor.setModelMarkers(model, "external", extras);
  }, [props.externalErrors?.join("||"), props.externalMarkers, props.uri]);

  // ── Handler: editor mounted ──
  const handleEditorDidMount = (ed: editor.ICodeEditor) => {
    editorRef.current = ed;
    props.setEditor(ed);

    // Apply initial external markers if any exist at mount time
    const model = ed.getModel();
    if (model && props.externalMarkers && props.externalMarkers.length > 0) {
      monaco.editor.setModelMarkers(model, "external", props.externalMarkers);
    }

    // Send initial didOpen
    if (!didOpenSentRef.current) {
      didOpenSentRef.current = true;
      const value = ed.getValue();
      lastValueRef.current = value;
      didOpen(uriRef.current, value, languageIdRef.current);
    }

    // ── Viewport tracking: send visible line ranges to LSP ──
    const sendVisibleRanges = debounce(() => {
      const visibleRanges = ed.getVisibleRanges();
      if (visibleRanges.length > 0) {
        const ranges = visibleRanges.map((r) => ({
          startLine: r.startLineNumber - 1, // Monaco is 1-indexed, LSP is 0-indexed
          endLine: r.endLineNumber - 1,
        }));
        didChangeVisibleRanges(uriRef.current, ranges);
      }
    }, 150);

    ed.onDidScrollChange(sendVisibleRanges);
    ed.onDidBlurEditorText(() => {
      if (!lintOnTypeRef.current && lastValueRef.current !== undefined) {
        didChange(uriRef.current, lastValueRef.current);
        props.onParsed?.();
      }
    });
    sendVisibleRanges();
  };

  // ── Sync external content changes without wiping undo/redo stack ──
  useEffect(() => {
    const code = props.content;
    const model = editorRef.current?.getModel();
    if (!model || code === undefined || code === model.getValue()) return;
    lastValueRef.current = code;
    if (editorRef.current) {
      editorRef.current.pushUndoStop();
      editorRef.current.executeEdits("morsel-external-sync", [
        {
          range: model.getFullModelRange(),
          text: code,
          forceMoveMarkers: true,
        },
      ]);
      editorRef.current.pushUndoStop();
    } else {
      model.setValue(code);
    }
  }, [props.content]);

  // ── Handler: content changed ──
  const sendDidChange = debounce((value: string) => {
    didChange(uriRef.current, value);
    props.onParsed?.();
  }, 300);

  const handleDidChangeContent = (value: string | undefined) => {
    if (value === undefined) return;
    lastValueRef.current = value;
    props.onChange?.(value);
    if (lintOnTypeRef.current) {
      sendDidChange(value);
    }
  };

  // ── Imperative handle ──
  React.useImperativeHandle(ref, () => ({
    sync: async () => {
      sendDidChange.cancel();
      const value = editorRef.current?.getValue();
      if (value !== undefined) {
        didChange(uriRef.current, value);
      }
    },
    revealComponent: (name: string) => {
      const ed = editorRef.current;
      if (!ed) return;
      const conn = getLsp();
      if (!conn) return;

      conn
        .sendRequest("textDocument/documentSymbol", { textDocument: { uri: uriRef.current } })
        .then((symbols: any) => {
          const findSymbol = (items: any[]): any => {
            for (const sym of items) {
              if (sym.name === name) return sym;
              if (sym.children) {
                const found = findSymbol(sym.children);
                if (found) return found;
              }
            }
            return null;
          };
          const sym = findSymbol(symbols ?? []);
          if (sym?.selectionRange) {
            const range = {
              startLineNumber: sym.selectionRange.start.line + 1,
              startColumn: sym.selectionRange.start.character + 1,
              endLineNumber: sym.selectionRange.end.line + 1,
              endColumn: sym.selectionRange.end.character + 1,
            };
            ed.revealRangeInCenter(range);
            ed.setSelection(range);
          }
        })
        .catch(() => {});
    },
    getEditor: () => editorRef.current,
  }));

  const handleInsertSymbol = useCallback((sym: QuickSymbol) => {
    const ed = editorRef.current;
    if (!ed) return;
    const selection = ed.getSelection();
    if (!selection) return;

    ed.executeEdits("mobile-accessory-bar", [
      {
        range: selection,
        text: sym.insertText,
        forceMoveMarkers: true,
      },
    ]);

    if (sym.cursorOffset) {
      const pos = ed.getPosition();
      if (pos) {
        const nextCol = Math.max(1, pos.column + sym.cursorOffset);
        ed.setPosition({ lineNumber: pos.lineNumber, column: nextCol });
      }
    }
    ed.focus();
  }, []);

  const handleEditorTrigger = useCallback((commandId: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.trigger("mobile-accessory-bar", commandId, null);
    ed.focus();
  }, []);

  const showMobileAccessoryBar = !props.readOnly && !props.embed;

  return (
    <CodeEditorContainer>
      {showMobileAccessoryBar && (
        <MobileAccessoryBar role="toolbar" aria-label="Engineering symbols and shortcuts">
          <AccessoryKeyButton
            type="button"
            title="Indent line (Tab)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              handleInsertSymbol({
                label: "⇥",
                insertText: " ".repeat(editorTabSize || 2),
                title: "Indent",
              })
            }
          >
            ⇥
          </AccessoryKeyButton>
          {MOBILE_ENGINEERING_SYMBOLS.map((sym) => (
            <AccessoryKeyButton
              key={sym.label}
              type="button"
              title={sym.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleInsertSymbol(sym)}
            >
              {sym.label}
            </AccessoryKeyButton>
          ))}
          <AccessoryKeyButton
            type="button"
            title="Undo"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleEditorTrigger("undo")}
          >
            ↶
          </AccessoryKeyButton>
          <AccessoryKeyButton
            type="button"
            title="Redo"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleEditorTrigger("redo")}
          >
            ↷
          </AccessoryKeyButton>
        </MobileAccessoryBar>
      )}
      <EditorSurfaceWrapper>
        <Editor
          theme={getMonacoThemeName(props.theme)}
          defaultValue={props.content}
          language={props.languageId ?? "modelica"}
          path={props.uri}
          beforeMount={(m) => {
            ensureMonacoThemesDefined(m);
            registerAllModelscriptLanguages(m);
          }}
          onChange={handleDidChangeContent}
          onMount={handleEditorDidMount}
          options={
            !props.embed
              ? {
                  automaticLayout: true,
                  autoIndent: "full",
                  fontSize: editorFontSize,
                  tabSize: editorTabSize,
                  wordWrap: editorWordWrap,
                  lineNumbers: editorLineNumbers,
                  minimap: { enabled: editorMinimap },
                  bracketPairColorization: { enabled: bracketPairColorization },
                  insertSpaces: true,
                  guides: {
                    indentation: true,
                  },
                  readOnly: Boolean(props.readOnly),
                  "semanticHighlighting.enabled": true,
                }
              : {
                  automaticLayout: true,
                  codeLens: false,
                  folding: false,
                  glyphMargin: false,
                  lineDecorationsWidth: 0,
                  lineNumbers: "off",
                  lineNumbersMinChars: 0,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 8, bottom: 8 },
                  "semanticHighlighting.enabled": true,
                }
          }
          height="100%"
          width="100%"
        ></Editor>
      </EditorSurfaceWrapper>
    </CodeEditorContainer>
  );
});

export default CodeEditor;
