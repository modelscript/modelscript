// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as Monaco from "monaco-editor";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setActiveEditorLspTransport } from "../src/transport.js";
import {
  registerAllModelscriptLanguages,
  registerModelicaLanguage,
  registerMonacoLspProviders,
  setupMonacoLspAdapter,
} from "../src/workbench/util/monaco-lsp-adapter.js";

interface MockUri {
  toString(): string;
}

interface MockDisposable {
  disposed: boolean;
  dispose(): void;
}

interface MockModel {
  uri: MockUri;
  getValue(): string;
  getLanguageId(): string;
  getLineCount(): number;
  getLineLength(lineNumber: number): number;
  getWordUntilPosition(position: { lineNumber: number; column: number }): {
    word: string;
    startColumn: number;
    endColumn: number;
  };
  getValueInRange(range: Monaco.IRange): string;
}

function createMockModel(uriStr: string, lines: string[], languageId = "modelica"): MockModel {
  const text = lines.join("\n");
  return {
    uri: { toString: () => uriStr },
    getValue: () => text,
    getLanguageId: () => languageId,
    getLineCount: () => lines.length,
    getLineLength: (lineNumber: number) => lines[lineNumber - 1]?.length ?? 0,
    getWordUntilPosition: (pos) => ({
      word: "foo",
      startColumn: Math.max(1, pos.column - 3),
      endColumn: pos.column,
    }),
    getValueInRange: (range) => {
      const line = lines[range.startLineNumber - 1] ?? "";
      return line.slice(range.startColumn - 1, range.endColumn - 1);
    },
  };
}

class MockEmitter<T> {
  disposed = false;
  fired: T[] = [];
  private readonly listeners = new Set<(e: T) => void>();

  event = (listener: (e: T) => void): Monaco.IDisposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    this.fired.push(value);
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

interface RecordedProviders {
  completion?: Monaco.languages.CompletionItemProvider;
  hover?: Monaco.languages.HoverProvider;
  semanticTokens?: Monaco.languages.DocumentSemanticTokensProvider;
  formatting?: Monaco.languages.DocumentFormattingEditProvider;
  rangeFormatting?: Monaco.languages.DocumentRangeFormattingEditProvider;
  color?: Monaco.languages.DocumentColorProvider;
  signatureHelp?: Monaco.languages.SignatureHelpProvider;
  documentSymbol?: Monaco.languages.DocumentSymbolProvider;
  documentHighlight?: Monaco.languages.DocumentHighlightProvider;
  definition?: Monaco.languages.DefinitionProvider;
  typeDefinition?: Monaco.languages.TypeDefinitionProvider;
  reference?: Monaco.languages.ReferenceProvider;
  rename?: Monaco.languages.RenameProvider;
  codeAction?: Monaco.languages.CodeActionProvider;
  codeLens?: Monaco.languages.CodeLensProvider;
  inlayHints?: Monaco.languages.InlayHintsProvider;
  foldingRange?: Monaco.languages.FoldingRangeProvider;
  selectionRange?: Monaco.languages.SelectionRangeProvider;
}

function createMockMonaco(models: MockModel[] = []) {
  const registeredLanguages: Array<{ id: string; extensions?: string[]; aliases?: string[] }> = [];
  const monarchProviders = new Map<string, Monaco.languages.IMonarchLanguage>();
  const languageConfigs = new Map<string, Monaco.languages.LanguageConfiguration>();
  const providers: RecordedProviders = {};
  const disposables: MockDisposable[] = [];
  const markersByModel = new Map<MockModel, Array<{ owner: string; markers: Monaco.editor.IMarkerData[] }>>();
  const registeredCommands = new Map<string, (_accessor: unknown, ...args: unknown[]) => unknown>();

  const trackDisposable = (): MockDisposable => {
    const d: MockDisposable = {
      disposed: false,
      dispose() {
        this.disposed = true;
      },
    };
    disposables.push(d);
    return d;
  };

  const mockMonaco = {
    MarkerSeverity: {
      Hint: 1,
      Info: 2,
      Warning: 4,
      Error: 8,
    },
    Uri: {
      parse: (value: string): MockUri => ({ toString: () => value }),
    },
    Emitter: MockEmitter,
    editor: {
      getModels: () => models,
      setModelMarkers: (model: MockModel, owner: string, markers: Monaco.editor.IMarkerData[]) => {
        const list = markersByModel.get(model) ?? [];
        list.push({ owner, markers });
        markersByModel.set(model, list);
      },
      registerCommand: (id: string, handler: (_accessor: unknown, ...args: unknown[]) => unknown) => {
        registeredCommands.set(id, handler);
        return trackDisposable();
      },
    },
    languages: {
      CompletionItemKind: {
        Method: 0,
        Function: 1,
        Constructor: 2,
        Field: 3,
        Variable: 4,
        Class: 5,
        Struct: 6,
        Interface: 7,
        Module: 8,
        Property: 9,
        Event: 10,
        Operator: 11,
        Unit: 12,
        Value: 13,
        Constant: 14,
        Enum: 15,
        EnumMember: 16,
        Keyword: 17,
        Text: 18,
        Color: 19,
        File: 20,
        Reference: 21,
        Folder: 23,
        TypeParameter: 24,
        Snippet: 27,
      },
      CompletionItemInsertTextRule: {
        InsertAsSnippet: 4,
      },
      InlayHintKind: {
        Type: 1,
        Parameter: 2,
      },
      FoldingRangeKind: {
        Comment: { value: "comment" },
        Imports: { value: "imports" },
        Region: { value: "region" },
      },
      getLanguages: () => registeredLanguages.map((l) => ({ id: l.id })),
      register: (lang: { id: string; extensions?: string[]; aliases?: string[] }) => {
        registeredLanguages.push(lang);
      },
      setMonarchTokensProvider: (id: string, provider: Monaco.languages.IMonarchLanguage) => {
        monarchProviders.set(id, provider);
      },
      setLanguageConfiguration: (id: string, cfg: Monaco.languages.LanguageConfiguration) => {
        languageConfigs.set(id, cfg);
      },
      registerCompletionItemProvider: (_sel: unknown, p: Monaco.languages.CompletionItemProvider) => {
        providers.completion = p;
        return trackDisposable();
      },
      registerHoverProvider: (_sel: unknown, p: Monaco.languages.HoverProvider) => {
        providers.hover = p;
        return trackDisposable();
      },
      registerDocumentSemanticTokensProvider: (_sel: unknown, p: Monaco.languages.DocumentSemanticTokensProvider) => {
        providers.semanticTokens = p;
        return trackDisposable();
      },
      registerDocumentFormattingEditProvider: (_sel: unknown, p: Monaco.languages.DocumentFormattingEditProvider) => {
        providers.formatting = p;
        return trackDisposable();
      },
      registerDocumentRangeFormattingEditProvider: (
        _sel: unknown,
        p: Monaco.languages.DocumentRangeFormattingEditProvider,
      ) => {
        providers.rangeFormatting = p;
        return trackDisposable();
      },
      registerColorProvider: (_sel: unknown, p: Monaco.languages.DocumentColorProvider) => {
        providers.color = p;
        return trackDisposable();
      },
      registerSignatureHelpProvider: (_sel: unknown, p: Monaco.languages.SignatureHelpProvider) => {
        providers.signatureHelp = p;
        return trackDisposable();
      },
      registerDocumentSymbolProvider: (_sel: unknown, p: Monaco.languages.DocumentSymbolProvider) => {
        providers.documentSymbol = p;
        return trackDisposable();
      },
      registerDocumentHighlightProvider: (_sel: unknown, p: Monaco.languages.DocumentHighlightProvider) => {
        providers.documentHighlight = p;
        return trackDisposable();
      },
      registerDefinitionProvider: (_sel: unknown, p: Monaco.languages.DefinitionProvider) => {
        providers.definition = p;
        return trackDisposable();
      },
      registerTypeDefinitionProvider: (_sel: unknown, p: Monaco.languages.TypeDefinitionProvider) => {
        providers.typeDefinition = p;
        return trackDisposable();
      },
      registerReferenceProvider: (_sel: unknown, p: Monaco.languages.ReferenceProvider) => {
        providers.reference = p;
        return trackDisposable();
      },
      registerRenameProvider: (_sel: unknown, p: Monaco.languages.RenameProvider) => {
        providers.rename = p;
        return trackDisposable();
      },
      registerCodeActionProvider: (_sel: unknown, p: Monaco.languages.CodeActionProvider) => {
        providers.codeAction = p;
        return trackDisposable();
      },
      registerCodeLensProvider: (_sel: unknown, p: Monaco.languages.CodeLensProvider) => {
        providers.codeLens = p;
        return trackDisposable();
      },
      registerInlayHintsProvider: (_sel: unknown, p: Monaco.languages.InlayHintsProvider) => {
        providers.inlayHints = p;
        return trackDisposable();
      },
      registerFoldingRangeProvider: (_sel: unknown, p: Monaco.languages.FoldingRangeProvider) => {
        providers.foldingRange = p;
        return trackDisposable();
      },
      registerSelectionRangeProvider: (_sel: unknown, p: Monaco.languages.SelectionRangeProvider) => {
        providers.selectionRange = p;
        return trackDisposable();
      },
    },
  };

  return {
    monaco: mockMonaco as unknown as typeof Monaco,
    registeredLanguages,
    monarchProviders,
    languageConfigs,
    providers,
    disposables,
    markersByModel,
    registeredCommands,
  };
}

function createMockConnection(requestHandler?: (method: string, params?: unknown) => Promise<unknown> | unknown) {
  const notifications = new Map<string, (params: unknown) => void>();
  const serverRequests = new Map<string, (params: unknown) => unknown>();
  const sentRequests: Array<{ method: string; params: unknown }> = [];
  const connDisposables: MockDisposable[] = [];

  const trackConnDisposable = (): MockDisposable => {
    const d: MockDisposable = {
      disposed: false,
      dispose() {
        this.disposed = true;
      },
    };
    connDisposables.push(d);
    return d;
  };

  const connection = {
    onNotification<P = unknown>(method: string, handler: (params: P) => void): Monaco.IDisposable {
      notifications.set(method, handler as (params: unknown) => void);
      return trackConnDisposable();
    },
    async sendRequest<R = unknown>(method: string, params?: unknown): Promise<R> {
      sentRequests.push({ method, params });
      if (requestHandler) {
        return (await requestHandler(method, params)) as R;
      }
      return null as R;
    },
    onRequest<P = unknown, R = unknown>(method: string, handler: (params: P) => R): Monaco.IDisposable {
      serverRequests.set(method, handler as (params: unknown) => unknown);
      return trackConnDisposable();
    },
  };

  return { connection, notifications, serverRequests, sentRequests, connDisposables };
}

const dummyToken = {} as Monaco.CancellationToken;

afterEach(() => {
  setActiveEditorLspTransport(null);
});

describe("registerAllModelscriptLanguages", () => {
  it("registers ModelScript languages, Monarch tokenizers, and language configs once", () => {
    const env = createMockMonaco();
    registerAllModelscriptLanguages(env.monaco);
    const countAfterFirst = env.registeredLanguages.length;
    assert.ok(countAfterFirst > 10, `expected >10 registered languages, got ${countAfterFirst}`);
    assert.ok(env.monarchProviders.has("modelica"));
    assert.ok(env.monarchProviders.has("modelscript"));
    assert.ok(env.monarchProviders.has("sysml"));
    assert.ok(env.languageConfigs.has("modelica"));

    // Second call (and legacy alias) are idempotent no-ops
    registerModelicaLanguage(env.monaco);
    assert.equal(env.registeredLanguages.length, countAfterFirst);
  });
});

describe("setupMonacoLspAdapter lifecycle & diagnostics", () => {
  it("registers all providers and disposes every tracked disposable on dispose()", () => {
    const env = createMockMonaco();
    const { connection, connDisposables } = createMockConnection();

    const statusEvents: Array<{ state: string; message: string }> = [];
    const adapter = setupMonacoLspAdapter(env.monaco, connection, "file:///model.mo", {
      onStatus: (state, message) => statusEvents.push({ state, message }),
    });

    assert.ok(env.providers.completion);
    assert.ok(env.providers.hover);
    assert.ok(env.providers.semanticTokens);
    assert.ok(env.providers.formatting);
    assert.ok(env.providers.rangeFormatting);
    assert.ok(env.providers.color);
    assert.ok(env.providers.signatureHelp);
    assert.ok(env.providers.documentSymbol);
    assert.ok(env.providers.documentHighlight);
    assert.ok(env.providers.definition);
    assert.ok(env.providers.typeDefinition);
    assert.ok(env.providers.reference);
    assert.ok(env.providers.rename);
    assert.ok(env.providers.codeAction);
    assert.ok(env.providers.codeLens);
    assert.ok(env.providers.inlayHints);
    assert.ok(env.providers.foldingRange);
    assert.ok(env.providers.selectionRange);

    assert.equal(env.disposables.length, 18);
    assert.equal(connDisposables.length, 5); // status + diagnostics + semanticTokens/refresh + codeLens/refresh (req + notif)
    assert.ok(env.disposables.every((d) => !d.disposed));
    assert.ok(connDisposables.every((d) => !d.disposed));

    adapter.dispose();
    assert.ok(env.disposables.every((d) => d.disposed));
    assert.ok(connDisposables.every((d) => d.disposed));
    assert.equal(statusEvents.length, 0);
  });

  it("maps LSP diagnostic severities, ranges, codes, and invokes callbacks + setModelMarkers", () => {
    const model = createMockModel("file:///demo.mo", ["model Demo", "  Real x;", "end Demo;"]);
    const env = createMockMonaco([model]);
    const { connection, notifications } = createMockConnection();

    const received: Array<{ uri: string; markers: Monaco.editor.IMarkerData[] }> = [];
    const statuses: Array<[string, string]> = [];
    const adapter = setupMonacoLspAdapter(env.monaco, connection, "file:///demo.mo", {
      onDiagnostics: (uri, markers) => received.push({ uri, markers }),
      onStatus: (state, message) => statuses.push([state, message]),
    });

    notifications.get("modelscript/status")?.({ state: "ready", message: "LSP ready" });
    assert.deepEqual(statuses, [["ready", "LSP ready"]]);

    notifications.get("textDocument/publishDiagnostics")?.({
      uri: "file:///demo.mo",
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          message: "Error msg",
          code: 2001,
          source: "omc",
        },
        {
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
          severity: 2,
          message: "Warn msg",
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
          severity: 3,
          message: "Info msg",
        },
        {
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
          severity: 4,
          message: "Hint msg",
        },
        {
          range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
          message: "Default error msg",
        },
      ],
    });

    assert.equal(received.length, 1);
    const markers = received[0]!.markers;
    assert.equal(markers.length, 5);
    assert.deepEqual(markers[0], {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 6,
      severity: 8,
      message: "Error msg",
      source: "omc",
      code: "2001",
    });
    assert.equal(markers[1]?.severity, 4);
    assert.equal(markers[1]?.source, "modelscript");
    assert.equal(markers[2]?.severity, 2);
    assert.equal(markers[3]?.severity, 1);
    assert.equal(markers[4]?.severity, 8);

    const modelMarkers = env.markersByModel.get(model);
    assert.equal(modelMarkers?.length, 1);
    assert.equal(modelMarkers?.[0]?.owner, "modelscript");

    // Publishing diagnostics for an unknown URI still triggers callback but does not touch existing models
    notifications.get("textDocument/publishDiagnostics")?.({
      uri: "file:///other.mo",
      diagnostics: [],
    });
    assert.equal(received.length, 2);
    assert.equal(env.markersByModel.get(model)?.length, 1);

    adapter.dispose();
  });
});

describe("setupMonacoLspAdapter language feature providers", () => {
  it("converts completions, snippets, textEdits, and handles errors gracefully", async () => {
    const model = createMockModel("file:///comp.mo", ["model Comp", "  Real x;", "end Comp;"]);
    const env = createMockMonaco([model]);
    let shouldFail = false;
    const { connection } = createMockConnection(async (method) => {
      if (method === "textDocument/completion") {
        if (shouldFail) throw new Error("boom");
        return {
          items: [
            {
              label: "sin",
              kind: 3, // Function
              detail: "Real -> Real",
              insertText: "sin($1)",
              insertTextFormat: 2,
              commitCharacters: ["("],
              additionalTextEdits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "import Modelica.Math.sin;\n",
                },
              ],
            },
            {
              label: "plain",
              kind: 999, // fallback to Text
              textEdit: {
                range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
                newText: "Real",
              },
            },
          ],
        };
      }
      return null;
    });

    const adapter = setupMonacoLspAdapter(env.monaco, connection);
    const res = await env.providers.completion!.provideCompletionItems(
      model as unknown as Monaco.editor.ITextModel,
      { lineNumber: 2, column: 6 } as Monaco.Position,
      { triggerKind: 1, triggerCharacter: "." } as Monaco.languages.CompletionContext,
      dummyToken,
    );

    assert.equal(res?.suggestions.length, 2);
    assert.equal(res?.suggestions[0]?.kind, env.monaco.languages.CompletionItemKind.Function);
    assert.equal(
      res?.suggestions[0]?.insertTextRules,
      env.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    );
    assert.deepEqual(res?.suggestions[0]?.commitCharacters, ["("]);
    assert.equal(res?.suggestions[0]?.additionalTextEdits?.length, 1);
    assert.equal(res?.suggestions[1]?.kind, env.monaco.languages.CompletionItemKind.Text);
    assert.deepEqual(res?.suggestions[1]?.range, {
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 7,
    });

    shouldFail = true;
    const fallback = await env.providers.completion!.provideCompletionItems(
      model as unknown as Monaco.editor.ITextModel,
      { lineNumber: 2, column: 6 } as Monaco.Position,
      { triggerKind: 0 } as Monaco.languages.CompletionContext,
      dummyToken,
    );
    assert.deepEqual(fallback, { suggestions: [] });
    adapter.dispose();
  });

  it("converts hover, definition, typeDefinition, references, and document symbols", async () => {
    const model = createMockModel("file:///sym.mo", ["model Sym", "  Real x;", "end Sym;"]);
    const env = createMockMonaco([model]);
    const { connection } = createMockConnection(async (method) => {
      switch (method) {
        case "textDocument/hover":
          return {
            contents: ["line1", { value: "**bold**" }],
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
          };
        case "textDocument/definition":
          return {
            targetUri: "file:///target.mo",
            targetRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } },
            targetSelectionRange: { start: { line: 3, character: 2 }, end: { line: 3, character: 5 } },
          };
        case "textDocument/typeDefinition":
          return [
            {
              uri: "file:///types.mo",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
          ];
        case "textDocument/references":
          return [
            { uri: "file:///sym.mo", range: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } } },
            null,
          ];
        case "textDocument/documentSymbol":
          return [
            {
              name: "Sym",
              kind: 4,
              range: { start: { line: 0, character: 0 }, end: { line: 2, character: 8 } },
              selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
              children: [
                {
                  name: "x",
                  kind: 12,
                  location: { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 9 } } },
                },
              ],
            },
          ];
        default:
          return null;
      }
    });

    const adapter = setupMonacoLspAdapter(env.monaco, connection);
    const pos = { lineNumber: 2, column: 8 } as Monaco.Position;
    const textModel = model as unknown as Monaco.editor.ITextModel;

    const hover = await env.providers.hover!.provideHover(textModel, pos, dummyToken);
    assert.deepEqual(hover?.contents, [{ value: "line1" }, { value: "**bold**" }]);
    assert.deepEqual(hover?.range, { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7 });

    const def = (await env.providers.definition!.provideDefinition(
      textModel,
      pos,
      dummyToken,
    )) as Monaco.languages.Location[];
    assert.equal(def.length, 1);
    assert.equal(def[0]?.uri.toString(), "file:///target.mo");
    assert.deepEqual(def[0]?.range, { startLineNumber: 4, startColumn: 3, endLineNumber: 4, endColumn: 6 });

    const typeDef = (await env.providers.typeDefinition!.provideTypeDefinition(
      textModel,
      pos,
      dummyToken,
    )) as Monaco.languages.Location[];
    assert.equal(typeDef[0]?.uri.toString(), "file:///types.mo");

    const refs = await env.providers.reference!.provideReferences(
      textModel,
      pos,
      { includeDeclaration: true },
      dummyToken,
    );
    assert.equal(refs?.length, 1);

    const syms = await env.providers.documentSymbol!.provideDocumentSymbols(textModel, dummyToken);
    assert.equal(syms?.length, 1);
    assert.equal(syms?.[0]?.name, "Sym");
    assert.equal(syms?.[0]?.children?.[0]?.name, "x");
    assert.deepEqual(syms?.[0]?.children?.[0]?.range, {
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 10,
    });

    adapter.dispose();
  });

  it("sanitizes Modelica semantic tokens, caches last valid result, and supports refresh", async () => {
    const model = createMockModel("file:///tok.mo", ["model Foo", "  Real x;"], "modelica");
    const env = createMockMonaco([model]);
    let returnNull = false;
    const { connection, serverRequests } = createMockConnection(async (method) => {
      if (method === "textDocument/semanticTokens/full") {
        if (returnNull) return null;
        return {
          // Token 1: line 0, col 0, len 5, type 0 (keyword -> skipped for modelica)
          // Token 2: line 0, col 6, len 10 (clamped to 3), type 2 (class), mod 1
          // Token 3: line 1, col 2, len 4, type 1 (type), mod 0
          data: [0, 0, 5, 0, 0, 0, 6, 10, 2, 1, 1, 2, 4, 1, 0],
        };
      }
      return null;
    });

    const adapter = setupMonacoLspAdapter(env.monaco, connection);
    const provider = env.providers.semanticTokens!;
    assert.equal(provider.getLegend().tokenTypes[0], "keyword");

    let refreshCount = 0;
    provider.onDidChange?.(() => {
      refreshCount += 1;
    });
    serverRequests.get("workspace/semanticTokens/refresh")?.(undefined);
    assert.equal(refreshCount, 1);

    const tokens = await provider.provideDocumentSemanticTokens(
      model as unknown as Monaco.editor.ITextModel,
      null,
      dummyToken,
    );
    assert.deepEqual(Array.from(tokens?.data ?? []), [0, 6, 3, 2, 1, 1, 2, 4, 1, 0]);

    // When server returns null, cached tokens are returned
    returnNull = true;
    const cached = await provider.provideDocumentSemanticTokens(
      model as unknown as Monaco.editor.ITextModel,
      null,
      dummyToken,
    );
    assert.deepEqual(Array.from(cached?.data ?? []), [0, 6, 3, 2, 1, 1, 2, 4, 1, 0]);

    adapter.dispose();
  });

  it("handles rename, codeAction command registration/dispatch, codeLens, inlayHints, folding, and selectionRange", async () => {
    const model = createMockModel("file:///act.mo", ["model Act", "  Real x;", "end Act;"]);
    const env = createMockMonaco([model]);
    const { connection, sentRequests } = createMockConnection(async (method) => {
      switch (method) {
        case "textDocument/rename":
          return {
            changes: {
              "file:///act.mo": [
                { range: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } }, newText: "y" },
              ],
            },
            documentChanges: [
              {
                textDocument: { uri: "file:///other.mo" },
                edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "y" }],
              },
            ],
          };
        case "textDocument/prepareRename":
          return { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } };
        case "textDocument/codeAction":
          return [
            {
              title: "Simulate model",
              kind: "quickfix",
              isPreferred: true,
              command: { command: "modelscript.modelica.simulate", title: "Simulate", arguments: ["file:///act.mo"] },
            },
          ];
        case "textDocument/codeLens":
          return [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
              data: "lens-1",
            },
          ];
        case "codeLens/resolve":
          return {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
            command: { command: "modelscript.action.run", title: "Run" },
          };
        case "textDocument/inlayHint":
          return [{ position: { line: 1, character: 8 }, label: [{ value: ": " }, { value: "Real" }], kind: 1 }];
        case "textDocument/foldingRange":
          return [{ startLine: 0, endLine: 2, kind: "comment" }];
        case "textDocument/selectionRange":
          return [
            {
              range: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } },
              parent: { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 9 } } },
            },
          ];
        default:
          return null;
      }
    });

    const adapter = setupMonacoLspAdapter(env.monaco, connection, "file:///act.mo");
    const textModel = model as unknown as Monaco.editor.ITextModel;
    const pos = { lineNumber: 2, column: 8 } as Monaco.Position;
    const range: Monaco.IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 9 };

    // Rename + prepareRename
    const renameLoc = await env.providers.rename!.resolveRenameLocation!(textModel, pos, dummyToken);
    assert.equal(renameLoc?.text, "x");
    const renameEdit = await env.providers.rename!.provideRenameEdits(textModel, pos, "y", dummyToken);
    assert.equal(renameEdit?.edits.length, 2);

    // Code actions + command execution fallback to modelscript/executeAction
    const caList = await env.providers.codeAction!.provideCodeActions(
      textModel,
      range as Monaco.Range,
      { markers: [], only: "quickfix", trigger: 1 } as Monaco.languages.CodeActionContext,
      dummyToken,
    );
    assert.equal(caList?.actions.length, 1);
    assert.ok(env.registeredCommands.has("modelscript.modelica.simulate"));
    await env.registeredCommands.get("modelscript.modelica.simulate")!(null, "file:///act.mo");
    const execReq = sentRequests.find((r) => r.method === "modelscript/executeAction");
    assert.deepEqual(execReq?.params, {
      actionId: "simulate",
      languageId: "modelica",
      uri: "file:///act.mo",
      inputs: { documentText: "model Act\n  Real x;\nend Act;" },
    });

    // CodeLens provide + resolve
    const lenses = await env.providers.codeLens!.provideCodeLenses(textModel, dummyToken);
    assert.equal(lenses?.lenses.length, 1);
    const resolved = await env.providers.codeLens!.resolveCodeLens!(textModel, lenses!.lenses[0]!, dummyToken);
    assert.equal(resolved?.command?.id, "modelscript.action.run");

    // Inlay hints, folding, selection ranges
    const hints = await env.providers.inlayHints!.provideInlayHints(textModel, range as Monaco.Range, dummyToken);
    assert.equal(hints?.hints[0]?.label, ": Real");
    assert.equal(hints?.hints[0]?.kind, env.monaco.languages.InlayHintKind.Type);

    const folds = await env.providers.foldingRange!.provideFoldingRanges(textModel, {}, dummyToken);
    assert.deepEqual(folds, [{ start: 1, end: 3, kind: { value: "comment" } }]);

    const selections = await env.providers.selectionRange!.provideSelectionRanges(textModel, [pos], dummyToken);
    assert.equal(selections?.[0]?.length, 2);

    adapter.dispose();
  });

  it("wires registerMonacoLspProviders through active custom EditorLspTransport", async () => {
    const env = createMockMonaco();
    setActiveEditorLspTransport({
      sendRequest: async () => null as never,
      sendNotification: () => {},
      onNotification: () => ({ dispose: () => {} }),
    });

    const disposable = await registerMonacoLspProviders(env.monaco, "modelica");
    assert.ok(env.providers.completion);
    disposable.dispose();
    assert.ok(env.disposables.every((d) => d.disposed));
  });
});
