// SPDX-License-Identifier: AGPL-3.0-or-later

import { getScadParser } from "@modelscript/scad";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { legend, registerSemanticTokensProvider } from "../src/providers/semanticTokensProvider.js";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";
import { ValidationService } from "../src/services/validation-service.js";

describe("SCAD LSP Integration Suite", () => {
  it("emits syntax error diagnostics for invalid SCAD code via ValidationService", async () => {
    const parser = await getScadParser();
    let sentDiagnostics: any[] = [];
    const mockConnection: any = {
      console: { info: () => {}, warn: () => {}, error: () => {} },
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        sentDiagnostics = params.diagnostics;
      },
      sendNotification: () => {},
    };

    const docManager: any = {
      documents: { get: () => null },
      documentTrees: new Map(),
    };
    const wsIndexes = new Map<string, any>();
    const wsManager: any = {
      getWorkspaceIndex: (id: string) => wsIndexes.get(id) ?? null,
      setWorkspaceIndex: (id: string, ws: any) => wsIndexes.set(id, ws),
      unifiedWorkspace: { registerWorkspace: () => {} },
    };
    const parserService: any = {
      getParser: (id: string) => (id === "scad" ? parser : null),
      getFacade: () => null,
      registerParser: () => {},
      ensureLanguageParserLoaded: async () => {},
      sendProjectTreeChanged: () => {},
    };

    registerBuiltinLanguagePlugins({
      workspaceManager: wsManager,
      parserService,
      connection: mockConnection,
    });
    const plugin = globalLanguageRegistry.getPluginById("scad");
    assert.ok(plugin, "scad plugin should be registered");
    assert.equal(plugin.customHandlers?.validate, undefined, "scad should use ValidationService.validateScadDocument");

    const validationService = new ValidationService(mockConnection, docManager, wsManager, parserService);
    const scadSource = [
      "// Parametric Aerospace Flanged Drive Hub",
      "$fn = 48;",
      "flange_radius = 42;",
      "difference() {",
      "  cylinder(h = 8, r = flange_radius, center = false);",
      "}",
      "} ERROR",
    ].join("\n");

    const doc = TextDocument.create("file:///document.scad", "scad", 1, scadSource);
    await validationService.validateTextDocument(doc);

    assert.ok(sentDiagnostics.length > 0, "Expected syntax error diagnostics for '} ERROR'");
    assert.ok(
      sentDiagnostics.some((d) => d.range.start.line === 6 && d.severity === 1),
      `Expected error diagnostic on line 7 (0-indexed 6), got: ${JSON.stringify(sentDiagnostics)}`,
    );
  });

  it("produces semantic tokens for SCAD and awaits lazy parser loading when tree is not yet cached", async () => {
    const parser = await getScadParser();
    const scadSource = [
      "// Parametric Aerospace Flanged Drive Hub",
      "$fn = 48;",
      "flange_radius = 42;",
      "difference() {",
      "  cylinder(h = 8, r = flange_radius, center = false);",
      "}",
    ].join("\n");

    const docUri = "file:///document.scad";
    const document = TextDocument.create(docUri, "scad", 1, scadSource);

    const handlers = new Map<string, (params: any) => any>();
    const mockConn: any = {
      onRequest: (method: string, handler: (params: any) => any) => {
        handlers.set(method, handler);
      },
    };
    const mockDocs: any = {
      get: (uri: string) => (uri === docUri ? document : null),
      onDidClose: () => {},
    };

    let loaded = false;
    registerSemanticTokensProvider(
      mockConn,
      mockDocs,
      () => null,
      () => null,
      () => false,
      (_ext, text) => (loaded ? parser.parse(text) : null),
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        loaded = true;
      },
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    assert.ok(fullHandler, "Semantic tokens full handler should be registered");

    const response = await fullHandler({ textDocument: { uri: docUri } });
    assert.ok(response && Array.isArray(response.data), "Response must contain data array");
    assert.ok(response.data.length > 0, "SCAD semantic tokens must not be empty after lazy load");
    assert.strictEqual(response.data.length % 5, 0, "Data length must be a multiple of 5");

    const tokenTypes: string[] = [];
    for (let i = 0; i < response.data.length; i += 5) {
      tokenTypes.push(legend.tokenTypes[response.data[i + 3]] ?? "unknown");
    }
    assert.ok(tokenTypes.includes("comment"), "Expected comment token");
    assert.ok(tokenTypes.includes("number"), "Expected number token");
    assert.ok(tokenTypes.includes("variable"), "Expected variable token");
    assert.ok(tokenTypes.includes("parameter"), "Expected parameter token for named arguments");
    assert.ok(tokenTypes.includes("function"), "Expected function token for cylinder/difference");
  });
});
