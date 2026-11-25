// SPDX-License-Identifier: AGPL-3.0-or-later

import * as monaco from "monaco-editor";
import React, { useEffect, useRef } from "react";

export interface MonacoHighlightConfig {
  keywords: string[];
  typeKeywords: string[];
  operators: string[];
  lineComment?: string | undefined;
  blockComment?: { open: string; close: string } | undefined;
}

export interface MonacoAnsatzDiagnostic {
  line: number;
  character: number;
  endLine?: number | undefined;
  endCharacter?: number | undefined;
  severity: number;
  code?: string | number | undefined;
  message: string;
}

export interface MonacoAnsatzEditorProps {
  languageId: string;
  fileExtensions: string[];
  value: string;
  documentUri: string;
  colorMode: "dark" | "light";
  highlight: MonacoHighlightConfig;
  diagnostics: MonacoAnsatzDiagnostic[];
  revealRequest?: { line: number; nonce: number } | null | undefined;
  onChange: (nextValue: string) => void;
  lspRequest: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

const SEMANTIC_TOKEN_TYPES = [
  "keyword",
  "type",
  "string",
  "number",
  "comment",
  "operator",
  "variable",
  "property",
  "function",
];

let monacoEnvInitialized = false;
const registeredLanguages = new Set<string>();

function ensureMonacoEnvironment(): void {
  if (monacoEnvInitialized || typeof window === "undefined") return;
  monacoEnvInitialized = true;
  const g = globalThis as unknown as {
    MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker };
  };
  if (!g.MonacoEnvironment) {
    g.MonacoEnvironment = {
      getWorker: () => {
        const blob = new Blob(["self.onmessage = function() {};"], { type: "application/javascript" });
        return new Worker(URL.createObjectURL(blob));
      },
    };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMonarchLanguage(
  languageId: string,
  extensions: string[],
  highlight: MonacoHighlightConfig,
): monaco.languages.IMonarchLanguage {
  const isXml =
    highlight.lineComment === "<!--" ||
    extensions.some((e) =>
      [
        ".xml",
        ".urdf",
        ".sdf",
        ".xacro",
        ".pscx",
        ".pslx",
        ".qif",
        ".reqif",
        ".aml",
        ".ssd",
        ".xodr",
        ".xosc",
        ".arxml",
      ].includes(e.toLowerCase()),
    );
  const isIni =
    languageId === "epanet" ||
    languageId === "swmm" ||
    languageId === "fea" ||
    extensions.some((e) => [".inp", ".ini", ".cfg"].includes(e.toLowerCase()));

  if (isXml) {
    return {
      defaultToken: "",
      tokenPostfix: `.${languageId}`,
      tokenizer: {
        root: [
          [/<!--/, "comment", "@comment"],
          [/<\?[\s\S]*?\?>/, "metatag"],
          [/<\/?[\w:.-]+/, "tag", "@tag"],
          [/[^<]+/, ""],
        ],
        comment: [
          [/-->/, "comment", "@pop"],
          [/[^-]+/, "comment"],
          [/./, "comment"],
        ],
        tag: [
          [/[ \t\r\n]+/, "white"],
          [/[\w:.-]+(?=\s*=)/, "attribute.name"],
          [/=/, "delimiter"],
          [/"[^"]*"/, "attribute.value"],
          [/'[^']*'/, "attribute.value"],
          [/\/?>/, "tag", "@pop"],
        ],
      },
    };
  }

  const lineComment = highlight.lineComment || "//";
  const blockOpen = highlight.blockComment?.open || "/*";
  const blockClose = highlight.blockComment?.close || "*/";

  const whitespaceRules: monaco.languages.IMonarchLanguageRule[] = [[/[ \t\r\n]+/, "white"]];
  if (blockOpen && blockClose) {
    whitespaceRules.push([new RegExp(escapeRegExp(blockOpen)), "comment", "@comment"]);
  }
  if (lineComment && lineComment !== "<!--") {
    whitespaceRules.push([new RegExp(`${escapeRegExp(lineComment)}.*$`), "comment"]);
  }
  if (isIni) {
    whitespaceRules.push([/[;#].*$/, "comment"]);
  } else {
    whitespaceRules.push([/^\s*#.*$/, "comment"]);
  }

  const rootRules: monaco.languages.IMonarchLanguageRule[] = [];
  if (isIni) {
    rootRules.push([/^\s*\[[^\]]+\]/, "tag"]);
    rootRules.push([/^\s*\*[A-Za-z0-9_]+/, "keyword"]);
  }

  rootRules.push(
    [
      /[a-zA-Z_$][\w$-]*/,
      {
        cases: {
          "@typeKeywords": "type",
          "@keywords": "keyword",
          "@default": "identifier",
        },
      },
    ],
    { include: "@whitespace" },
    [/[{}()[\]]/, "@brackets"],
    [/[=><!~?:&|+\-*/^%]+/, { cases: { "@operators": "operator", "@default": "operator" } }],
    [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
    [/0[xX][0-9a-fA-F]+/, "number.hex"],
    [/\d+/, "number"],
    [/[;,.]/, "delimiter"],
    [/"([^"\\]|\\.)*$/, "string.invalid"],
    [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
    [/'([^'\\]|\\.)*'/, "string"],
  );

  return {
    defaultToken: "",
    tokenPostfix: `.${languageId}`,
    keywords: highlight.keywords ?? [],
    typeKeywords: highlight.typeKeywords ?? [],
    operators: highlight.operators ?? [],
    tokenizer: {
      root: rootRules,
      comment: [
        [new RegExp(escapeRegExp(blockClose)), "comment", "@pop"],
        [/./, "comment"],
      ],
      string: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],
      whitespace: whitespaceRules,
    },
  };
}

function toMonacoRange(r: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

export const MonacoAnsatzEditor: React.FC<MonacoAnsatzEditorProps> = ({
  languageId,
  fileExtensions,
  value,
  documentUri,
  colorMode,
  highlight,
  diagnostics,
  revealRequest,
  onChange,
  lspRequest,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const suppressChangeRef = useRef(false);
  const revealDecorationsRef = useRef<string[]>([]);
  const lspRequestRef = useRef(lspRequest);
  const documentUriRef = useRef(documentUri);
  lspRequestRef.current = lspRequest;
  documentUriRef.current = documentUri;

  // Register language, Monarch tokenizer, and Monaco LSP providers once per languageId
  useEffect(() => {
    ensureMonacoEnvironment();
    if (!registeredLanguages.has(languageId)) {
      registeredLanguages.add(languageId);
      monaco.languages.register({
        id: languageId,
        extensions: fileExtensions,
      });
      monaco.languages.setLanguageConfiguration(languageId, {
        comments: {
          lineComment: highlight.lineComment || "//",
          blockComment: highlight.blockComment
            ? [highlight.blockComment.open, highlight.blockComment.close]
            : ["/*", "*/"],
        },
        brackets: [
          ["{", "}"],
          ["[", "]"],
          ["(", ")"],
        ],
        autoClosingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: "(", close: ")" },
          { open: '"', close: '"' },
          { open: "'", close: "'" },
        ],
      });
      monaco.languages.setMonarchTokensProvider(
        languageId,
        buildMonarchLanguage(languageId, fileExtensions, highlight),
      );
    }

    const disposables: monaco.IDisposable[] = [];

    // Semantic tokens provider backed by @modelscript/lsp/core
    disposables.push(
      monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
        getLegend: () => ({ tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: [] }),
        provideDocumentSemanticTokens: async (model) => {
          const res = (await lspRequestRef.current("textDocument/semanticTokens/full", {
            textDocument: { uri: documentUriRef.current, text: model.getValue() },
          })) as { data?: number[] } | null;
          if (!res || !Array.isArray(res.data) || res.data.length === 0) return null;
          return { data: new Uint32Array(res.data) };
        },
        releaseDocumentSemanticTokens: () => {},
      }),
    );

    // Hover provider
    disposables.push(
      monaco.languages.registerHoverProvider(languageId, {
        provideHover: async (model, position) => {
          const res = (await lspRequestRef.current("textDocument/hover", {
            textDocument: { uri: documentUriRef.current, text: model.getValue() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })) as {
            contents?: { value?: string } | string;
            range?: { start: { line: number; character: number }; end: { line: number; character: number } };
          } | null;
          if (!res || !res.contents) return null;
          const valueText = typeof res.contents === "string" ? res.contents : (res.contents.value ?? "");
          if (!valueText) return null;
          return {
            contents: [{ value: valueText }],
            range: res.range ? toMonacoRange(res.range) : undefined,
          };
        },
      }),
    );

    // Completion provider
    disposables.push(
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: [".", ":", "<", " "],
        provideCompletionItems: async (model, position) => {
          const res = (await lspRequestRef.current("textDocument/completion", {
            textDocument: { uri: documentUriRef.current, text: model.getValue() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })) as Array<{
            label: string;
            kind?: number;
            detail?: string;
            documentation?: string;
            insertText?: string;
          }> | null;
          if (!Array.isArray(res) || res.length === 0) return { suggestions: [] };
          const word = model.getWordUntilPosition(position);
          const range: monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: res.map((item) => ({
              label: item.label,
              kind: (item.kind as monaco.languages.CompletionItemKind) ?? monaco.languages.CompletionItemKind.Keyword,
              detail: item.detail,
              documentation: item.documentation,
              insertText: item.insertText ?? item.label,
              range,
            })),
          };
        },
      }),
    );

    // Document symbol (Outline) provider
    disposables.push(
      monaco.languages.registerDocumentSymbolProvider(languageId, {
        provideDocumentSymbols: async (model) => {
          const res = (await lspRequestRef.current("textDocument/documentSymbol", {
            textDocument: { uri: documentUriRef.current, text: model.getValue() },
          })) as Array<{
            name: string;
            detail?: string;
            kind?: number;
            range?: { start: { line: number; character: number }; end: { line: number; character: number } };
            selectionRange?: { start: { line: number; character: number }; end: { line: number; character: number } };
          }> | null;
          if (!Array.isArray(res)) return [];
          return res
            .filter((s) => s && s.name && s.range)
            .map((s) => ({
              name: s.name,
              detail: s.detail ?? "",
              kind: (s.kind as monaco.languages.SymbolKind) ?? monaco.languages.SymbolKind.Object,
              tags: [],
              range: toMonacoRange(s.range!),
              selectionRange: toMonacoRange(s.selectionRange ?? s.range!),
            }));
        },
      }),
    );

    // Folding range provider
    disposables.push(
      monaco.languages.registerFoldingRangeProvider(languageId, {
        provideFoldingRanges: async (model) => {
          const res = (await lspRequestRef.current("textDocument/foldingRange", {
            textDocument: { uri: documentUriRef.current, text: model.getValue() },
          })) as Array<{ startLine: number; endLine: number }> | null;
          if (!Array.isArray(res)) return [];
          return res.map((r) => ({ start: r.startLine + 1, end: r.endLine + 1 }));
        },
      }),
    );

    // Inlay hints provider
    disposables.push(
      monaco.languages.registerInlayHintsProvider(languageId, {
        provideInlayHints: async (model, range) => {
          const res = (await lspRequestRef.current("textDocument/inlayHint", {
            textDocument: { uri: documentUriRef.current, text: model.getValue() },
            range: {
              start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
              end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
            },
          })) as Array<{ position: { line: number; character: number }; label: string }> | null;
          if (!Array.isArray(res)) return { hints: [], dispose: () => {} };
          return {
            hints: res.map((h) => ({
              position: { lineNumber: h.position.line + 1, column: h.position.character + 1 },
              label: typeof h.label === "string" ? h.label : String(h.label),
            })),
            dispose: () => {},
          };
        },
      }),
    );

    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [languageId, fileExtensions, highlight]);

  // Mount Monaco editor instance
  useEffect(() => {
    if (!containerRef.current) return;
    ensureMonacoEnvironment();

    const editor = monaco.editor.create(containerRef.current, {
      value,
      language: languageId,
      theme: colorMode === "dark" ? "vs-dark" : "vs",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      lineHeight: 19,
      tabSize: 2,
      scrollBeyondLastLine: false,
      "semanticHighlighting.enabled": true,
      padding: { top: 8, bottom: 8 },
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return;
      onChange(editor.getValue());
    });

    return () => {
      sub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // Intentionally mount once per languageId; value/theme synced below
  }, [languageId]);

  // Sync external code edits (sample load, stencil insert, panel writeback, tab switch)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== value) {
      suppressChangeRef.current = true;
      editor.setValue(value);
      suppressChangeRef.current = false;
    }
  }, [value]);

  // Sync theme
  useEffect(() => {
    monaco.editor.setTheme(colorMode === "dark" ? "vs-dark" : "vs");
  }, [colorMode]);

  // Sync LSP diagnostics into Monaco inline markers
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model) return;
    const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
      startLineNumber: Math.max(1, d.line),
      startColumn: Math.max(1, d.character),
      endLineNumber: Math.max(1, d.endLine ?? d.line),
      endColumn: Math.max(2, d.endCharacter ?? d.character + 1),
      message: d.message,
      code: d.code !== undefined ? String(d.code) : undefined,
      severity:
        d.severity === 1
          ? monaco.MarkerSeverity.Error
          : d.severity === 2
            ? monaco.MarkerSeverity.Warning
            : d.severity === 3
              ? monaco.MarkerSeverity.Info
              : monaco.MarkerSeverity.Hint,
    }));
    monaco.editor.setModelMarkers(model, `modelscript-lsp-${languageId}`, markers);
  }, [diagnostics, languageId]);

  // Handle host.onRevealLine jumps with transient highlight decoration
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealRequest) return;
    const line = Math.max(1, revealRequest.line);
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
    revealDecorationsRef.current = editor.deltaDecorations(revealDecorationsRef.current, [
      {
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "pg-monaco-reveal-line" },
      },
    ]);
    const timer = window.setTimeout(() => {
      if (editorRef.current) {
        revealDecorationsRef.current = editorRef.current.deltaDecorations(revealDecorationsRef.current, []);
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [revealRequest]);

  return <div ref={containerRef} className="pg-monaco-container" />;
};
