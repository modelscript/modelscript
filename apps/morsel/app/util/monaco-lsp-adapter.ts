// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bridges LSP protocol messages to Monaco editor APIs.
 *
 * Registers Monaco language providers that proxy requests to the LSP server
 * via the protocol connection. Also subscribes to LSP notifications
 * (diagnostics, status) and translates them to Monaco APIs.
 *
 * This replaces the need for the full `monaco-languageclient` package.
 */

import type * as monacoTypes from "monaco-editor";
import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";

// ────────────────────────────────────────────────────────────────────
// The Monarch language definition for fallback syntax highlighting
// ────────────────────────────────────────────────────────────────────

export const modelicaMonarch: monacoTypes.languages.IMonarchLanguage = {
  keywords: [
    "algorithm",
    "and",
    "annotation",
    "block",
    "break",
    "class",
    "connect",
    "connector",
    "constant",
    "constrainedby",
    "der",
    "discrete",
    "each",
    "else",
    "elseif",
    "elsewhen",
    "encapsulated",
    "end",
    "enumeration",
    "equation",
    "expandable",
    "extends",
    "external",
    "false",
    "final",
    "flow",
    "for",
    "function",
    "if",
    "import",
    "impure",
    "initial",
    "inner",
    "input",
    "loop",
    "model",
    "not",
    "operator",
    "or",
    "outer",
    "output",
    "package",
    "parameter",
    "partial",
    "protected",
    "public",
    "pure",
    "record",
    "redeclare",
    "replaceable",
    "return",
    "stream",
    "then",
    "true",
    "type",
    "when",
    "while",
    "within",
  ],
  typeKeywords: ["Boolean", "Integer", "Real", "String"],
  operators: ["=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "+", "-", "*", "/", "^"],
  tokenizer: {
    root: [
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@typeKeywords": "type", "@default": "identifier" } }],
      [/[{}()[\]]/, "@brackets"],
      [/[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/, "number"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string"],
      { include: "@whitespace" },
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\/\*/, "comment", "@push"],
      ["\\*/", "comment", "@pop"],
      [/[\\/*]/, "comment"],
    ],
    whitespace: [
      [/[ \t\r\n]+/, "white"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],
  },
};

// ────────────────────────────────────────────────────────────────────
// LSP → Monaco conversion helpers
// ────────────────────────────────────────────────────────────────────

function lspRangeToMonaco(range: any): monacoTypes.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function monacoPositionToLsp(position: monacoTypes.Position) {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function lspSeverityToMonaco(severity: number | undefined, monaco: typeof monacoTypes): monacoTypes.MarkerSeverity {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function lspCompletionKindToMonaco(kind: number | undefined, monaco: typeof monacoTypes) {
  const map: Record<number, monacoTypes.languages.CompletionItemKind> = {
    1: monaco.languages.CompletionItemKind.Text,
    2: monaco.languages.CompletionItemKind.Method,
    3: monaco.languages.CompletionItemKind.Function,
    4: monaco.languages.CompletionItemKind.Constructor,
    5: monaco.languages.CompletionItemKind.Field,
    6: monaco.languages.CompletionItemKind.Variable,
    7: monaco.languages.CompletionItemKind.Class,
    8: monaco.languages.CompletionItemKind.Interface,
    9: monaco.languages.CompletionItemKind.Module,
    10: monaco.languages.CompletionItemKind.Property,
    11: monaco.languages.CompletionItemKind.Unit,
    12: monaco.languages.CompletionItemKind.Value,
    13: monaco.languages.CompletionItemKind.Enum,
    14: monaco.languages.CompletionItemKind.Keyword,
    15: monaco.languages.CompletionItemKind.Snippet,
    16: monaco.languages.CompletionItemKind.Color,
    17: monaco.languages.CompletionItemKind.File,
    18: monaco.languages.CompletionItemKind.Reference,
    19: monaco.languages.CompletionItemKind.Folder,
    20: monaco.languages.CompletionItemKind.EnumMember,
    21: monaco.languages.CompletionItemKind.Constant,
    22: monaco.languages.CompletionItemKind.Struct,
    23: monaco.languages.CompletionItemKind.Event,
    24: monaco.languages.CompletionItemKind.Operator,
    25: monaco.languages.CompletionItemKind.TypeParameter,
  };
  return map[kind ?? 1] ?? monaco.languages.CompletionItemKind.Text;
}

// ────────────────────────────────────────────────────────────────────
// Semantic tokens legend (must match the LSP server's legend exactly)
// ────────────────────────────────────────────────────────────────────

const TOKEN_TYPES = [
  "keyword",
  "type",
  "class",
  "variable",
  "parameter",
  "function",
  "string",
  "number",
  "operator",
  "comment",
];

const TOKEN_MODIFIERS = ["declaration", "readonly"];

// ────────────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────────────

/**
 * Register Monaco language providers that proxy to the LSP, and subscribe
 * to diagnostics notifications.
 *
 * Returns a disposable that tears down all registrations.
 */
export function setupMonacoLspAdapter(
  monaco: typeof monacoTypes,
  connection: ProtocolConnection,
  uri: string,
  callbacks?: {
    onDiagnostics?: (uri: string, markers: monacoTypes.editor.IMarkerData[]) => void;
    onStatus?: (state: string, message: string) => void;
  },
): monacoTypes.IDisposable {
  const disposables: monacoTypes.IDisposable[] = [];

  // ── Register the Modelica language if needed ──
  if (!monaco.languages.getLanguages().some((l) => l.id === "modelica")) {
    monaco.languages.register({ id: "modelica" });
  }

  // ── Monarch fallback syntax highlighting ──
  disposables.push(monaco.languages.setMonarchTokensProvider("modelica", modelicaMonarch));

  // ── Language configuration (indentation, comments, brackets) ──
  disposables.push(
    monaco.languages.setLanguageConfiguration("modelica", {
      indentationRules: {
        increaseIndentPattern:
          /^\s*(model|class|record|block|connector|type|package|function|if|for|while|when|else|elseif|equation|algorithm|public|protected|initial equation|initial algorithm|enumeration)\b/,
        decreaseIndentPattern:
          /^\s*(end|else|elseif|equation|algorithm|public|protected|initial equation|initial algorithm)\b/,
      },
      onEnterRules: [
        {
          beforeText: /^\s*\/\//,
          action: { indentAction: monaco.languages.IndentAction.None, appendText: "// " },
        },
      ],
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["(", ")"],
        ["{", "}"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "(", close: ")" },
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
      ],
    }),
  );

  // ── Diagnostics ──
  connection.onNotification("textDocument/publishDiagnostics", (params: any) => {
    const markers: monacoTypes.editor.IMarkerData[] = (params.diagnostics ?? []).map((d: any) => ({
      message: d.message,
      severity: lspSeverityToMonaco(d.severity, monaco),
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      code: d.code?.toString(),
      source: d.source,
    }));

    // Set markers on the matching model
    for (const model of monaco.editor.getModels()) {
      const modelUri = model.uri.toString();
      const modelPath = model.uri.path;
      if (modelUri === params.uri || modelPath === params.uri || modelPath === "/" + params.uri) {
        monaco.editor.setModelMarkers(model, "lsp", markers);
        break;
      }
    }

    callbacks?.onDiagnostics?.(params.uri, markers);
  });

  // ── Server status notifications ──
  connection.onNotification("modelscript/status", (params: any) => {
    callbacks?.onStatus?.(params.state, params.message);
  });

  // ── Completion ──
  disposables.push(
    monaco.languages.registerCompletionItemProvider("modelica", {
      triggerCharacters: ["."],
      provideCompletionItems: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/completion", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });

          const items = Array.isArray(result) ? result : (result?.items ?? []);
          return {
            suggestions: items.map((item: any) => ({
              label: item.label,
              kind: lspCompletionKindToMonaco(item.kind, monaco),
              insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
              range: item.textEdit ? lspRangeToMonaco(item.textEdit.range) : undefined,
              detail: item.detail,
              documentation: item.documentation
                ? typeof item.documentation === "string"
                  ? item.documentation
                  : { value: item.documentation.value }
                : undefined,
              sortText: item.sortText,
              filterText: item.filterText,
            })),
          };
        } catch {
          return { suggestions: [] };
        }
      },
    }),
  );

  // ── Hover ──
  disposables.push(
    monaco.languages.registerHoverProvider("modelica", {
      provideHover: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          if (!result) return null;
          const contents = Array.isArray(result.contents)
            ? result.contents.map((c: any) => (typeof c === "string" ? { value: c } : { value: c.value }))
            : [typeof result.contents === "string" ? { value: result.contents } : { value: result.contents.value }];
          return {
            range: result.range ? lspRangeToMonaco(result.range) : undefined,
            contents,
          };
        } catch {
          return null;
        }
      },
    }),
  );

  // ── Semantic Tokens ──
  disposables.push(
    monaco.languages.registerDocumentSemanticTokensProvider("modelica", {
      getLegend: () => ({
        tokenTypes: TOKEN_TYPES,
        tokenModifiers: TOKEN_MODIFIERS,
      }),
      provideDocumentSemanticTokens: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/semanticTokens/full", {
            textDocument: { uri: model.uri.toString() },
          });
          return { data: new Uint32Array(result?.data ?? []) };
        } catch {
          return { data: new Uint32Array(0) };
        }
      },
      releaseDocumentSemanticTokens: () => {},
    }),
  );

  // ── Formatting ──
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider("modelica", {
      provideDocumentFormattingEdits: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/formatting", {
            textDocument: { uri: model.uri.toString() },
            options: { tabSize: 2, insertSpaces: true },
          });
          return (result ?? []).map((edit: any) => ({
            range: lspRangeToMonaco(edit.range),
            text: edit.newText,
          }));
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Color Provider ──
  disposables.push(
    monaco.languages.registerColorProvider("modelica", {
      provideDocumentColors: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/documentColor", {
            textDocument: { uri: model.uri.toString() },
          });
          return (result ?? []).map((ci: any) => ({
            range: lspRangeToMonaco(ci.range),
            color: ci.color,
          }));
        } catch {
          return [];
        }
      },
      provideColorPresentations: async (_model, colorInfo) => {
        try {
          const result: any = await connection.sendRequest("textDocument/colorPresentation", {
            textDocument: { uri: _model.uri.toString() },
            color: colorInfo.color,
            range: {
              start: { line: colorInfo.range.startLineNumber - 1, character: colorInfo.range.startColumn - 1 },
              end: { line: colorInfo.range.endLineNumber - 1, character: colorInfo.range.endColumn - 1 },
            },
          });
          return (result ?? []).map((cp: any) => ({
            label: cp.label,
            textEdit: cp.textEdit
              ? { range: lspRangeToMonaco(cp.textEdit.range), text: cp.textEdit.newText }
              : undefined,
          }));
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Signature Help ──
  disposables.push(
    monaco.languages.registerSignatureHelpProvider("modelica", {
      signatureHelpTriggerCharacters: ["(", ","],
      provideSignatureHelp: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/signatureHelp", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          if (!result) return null;
          return {
            value: {
              signatures: result.signatures.map((s: any) => ({
                label: s.label,
                documentation: s.documentation,
                parameters: s.parameters?.map((p: any) => ({
                  label: p.label,
                  documentation: p.documentation,
                })),
              })),
              activeSignature: result.activeSignature ?? 0,
              activeParameter: result.activeParameter ?? 0,
            },
            dispose: () => {},
          };
        } catch {
          return null;
        }
      },
    }),
  );

  // ── Document Symbols ──
  disposables.push(
    monaco.languages.registerDocumentSymbolProvider("modelica", {
      provideDocumentSymbols: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/documentSymbol", {
            textDocument: { uri: model.uri.toString() },
          });
          // Recursively convert LSP DocumentSymbol to Monaco DocumentSymbol
          const convertSymbol = (s: any): any => ({
            name: s.name,
            detail: s.detail ?? "",
            kind: s.kind,
            range: lspRangeToMonaco(s.range),
            selectionRange: lspRangeToMonaco(s.selectionRange),
            children: s.children?.map(convertSymbol),
          });
          return (result ?? []).map(convertSymbol);
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Document Highlights ──
  disposables.push(
    monaco.languages.registerDocumentHighlightProvider("modelica", {
      provideDocumentHighlights: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/documentHighlight", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          return (result ?? []).map((h: any) => ({
            range: lspRangeToMonaco(h.range),
            kind: h.kind,
          }));
        } catch {
          return [];
        }
      },
    }),
  );

  return {
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
