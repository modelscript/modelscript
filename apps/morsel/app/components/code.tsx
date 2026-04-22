// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Code editor component that delegates all language intelligence to the
 * LSP server via the Monaco-LSP adapter.
 *
 * The editor no longer:
 *   - parses via tree-sitter
 *   - lints via ModelicaLinter
 *   - registers ad-hoc completion/hover/semantic-token providers
 *
 * Instead it:
 *   - sends didOpen/didChange to the LSP
 *   - receives diagnostics via publishDiagnostics notification
 *   - proxies completion/hover/formatting/semantic tokens via the adapter
 */

import { Editor, loader, type Theme } from "@monaco-editor/react";
import debounce from "lodash/debounce";
import * as monaco from "monaco-editor";
import { editor, type IDisposable } from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import React, { useEffect, useRef } from "react";
import { didChange, didOpen } from "~/util/lsp-bridge";
import { getLsp, startLsp } from "~/util/lsp-worker";
import { setupMonacoLspAdapter } from "~/util/monaco-lsp-adapter";

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

// ────────────────────────────────────────────────────────────────────
// Props & Handle
// ────────────────────────────────────────────────────────────────────

interface CodeEditorProps {
  content: string;
  uri: string;
  setEditor: (editor: editor.ICodeEditor) => void;
  onProgress?: (progress: number, message: string) => void;
  onParsed?: () => void;
  onDiagnostics?: (markers: editor.IMarkerData[]) => void;
  onStatusChange?: (state: string, message: string) => void;
  theme: Theme;
  embed: boolean;
  readOnly?: boolean;
  externalErrors?: string[];
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

  // ── LSP adapter setup (runs once on mount) ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      props.onProgress?.(20, "Starting language server…");
      const connection = await startLsp();
      if (cancelled) return;

      props.onProgress?.(40, "Connecting editor to language server…");

      // Register Monaco providers that proxy to the LSP
      adapterDisposableRef.current = setupMonacoLspAdapter(monaco, connection, props.uri, {
        onDiagnostics: (_uri, markers) => {
          if (_uri === props.uri) {
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
      const existing = monaco.editor.getModelMarkers({ resource: model.uri, owner: "lsp" });
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
      didOpen(props.uri, value);
    }
  };

  // ── Handler: content changed ──
  const sendDidChange = debounce((value: string) => {
    didChange(props.uri, value);
    props.onParsed?.();
  }, 300);

  const handleDidChangeContent = (value: string | undefined) => {
    if (value === undefined) return;
    lastValueRef.current = value;
    sendDidChange(value);
  };

  // ── Imperative handle ──
  React.useImperativeHandle(ref, () => ({
    sync: async () => {
      sendDidChange.cancel();
      const value = editorRef.current?.getValue();
      if (value !== undefined) {
        didChange(props.uri, value);
      }
    },
    revealComponent: (name: string) => {
      // Use document symbols to find the component
      const ed = editorRef.current;
      if (!ed) return;
      const conn = getLsp();
      if (!conn) return;

      conn
        .sendRequest("textDocument/documentSymbol", { textDocument: { uri: props.uri } })
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
      defaultLanguage="modelica"
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
              readOnly: props.readOnly,
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
