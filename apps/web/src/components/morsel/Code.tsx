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
import React, { useEffect, useRef } from "react";
import { didChange, didChangeVisibleRanges, didOpen } from "./util/lsp-bridge";
import { getLsp, startLsp } from "./util/lsp-worker";
import { registerAllModelscriptLanguages, setupMonacoLspAdapter } from "./util/monaco-lsp-adapter";

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
  externalErrors?: string[] | undefined;
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
  const editorRef = useRef<editor.ICodeEditor>(null);
  const adapterDisposableRef = useRef<IDisposable | null>(null);
  const didOpenSentRef = useRef(false);
  const lastValueRef = useRef<string | undefined>(undefined);
  const uriRef = useRef(props.uri);
  const languageIdRef = useRef(props.languageId ?? "modelica");
  uriRef.current = props.uri;
  languageIdRef.current = props.languageId ?? "modelica";

  // ── LSP adapter setup (runs once on mount) ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      props.onProgress?.(20, "Starting language server…");
      const connection = await startLsp(languageIdRef.current);
      if (cancelled) return;

      props.onProgress?.(40, "Connecting editor to language server…");

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

  // ── Send external errors as additional markers ──
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;

    if (props.externalErrors && props.externalErrors.length > 0) {
      const extras: editor.IMarkerData[] = props.externalErrors.map((err) => ({
        message: err,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
        severity: monaco.MarkerSeverity.Error,
      }));
      monaco.editor.setModelMarkers(model, "external", extras);
    } else {
      monaco.editor.setModelMarkers(model, "external", []);
    }
  }, [props.externalErrors?.join("||")]);

  // ── Handler: editor mounted ──
  const handleEditorDidMount = (ed: editor.ICodeEditor) => {
    editorRef.current = ed;
    props.setEditor(ed);

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
    sendVisibleRanges();
  };

  // ── Handler: content changed ──
  const sendDidChange = debounce((value: string) => {
    didChange(uriRef.current, value);
    props.onParsed?.();
  }, 300);

  const handleDidChangeContent = (value: string | undefined) => {
    if (value === undefined) return;
    lastValueRef.current = value;
    props.onChange?.(value);
    sendDidChange(value);
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

  return (
    <Editor
      theme={props.theme}
      defaultValue={props.content}
      language={props.languageId ?? "modelica"}
      path={props.uri}
      beforeMount={(m) => {
        registerAllModelscriptLanguages(m);
      }}
      onChange={handleDidChangeContent}
      onMount={handleEditorDidMount}
      options={
        !props.embed
          ? {
              automaticLayout: true,
              autoIndent: "full",
              tabSize: 2,
              insertSpaces: true,
              guides: {
                indentation: true,
              },
              readOnly: Boolean(props.readOnly),
              "semanticHighlighting.enabled": true,
            }
          : {
              automaticLayout: true,
              folding: false,
              glyphMargin: false,
              lineDecorationsWidth: 0,
              lineNumbers: "off",
              lineNumbersMinChars: 0,
              minimap: { enabled: false },
              "semanticHighlighting.enabled": true,
            }
      }
      height="100%"
      width="100%"
    ></Editor>
  );
});

export default CodeEditor;
