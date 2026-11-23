// SPDX-License-Identifier: AGPL-3.0-or-later

import { getAmplSemanticTokens } from "@modelscript/ampl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

describe("AMPL LSP Integration Suite", () => {
  it("registers AMPL plugin with semanticTokens, validate, symbols, hover, and actionHandlers", () => {
    const workspaceManager = new WorkspaceManager();
    registerBuiltinLanguagePlugins({ workspaceManager });

    const plugin = globalLanguageRegistry.getPluginById("ampl");
    assert.ok(plugin, "AMPL plugin should be registered");
    assert.ok(plugin.customHandlers?.validate, "AMPL validate handler should be registered");
    assert.ok(plugin.customHandlers?.symbols, "AMPL symbols handler should be registered");
    assert.ok(plugin.customHandlers?.hover, "AMPL hover handler should be registered");
    assert.ok(plugin.customHandlers?.semanticTokens, "AMPL semanticTokens handler should be registered");
    assert.ok(plugin.actionHandlers?.["ampl_solve"], "AMPL ampl_solve actionHandler should be registered");
  });

  it("produces delta-encoded LSP semantic tokens for AMPL comments, keywords, identifiers, and numbers", () => {
    const src = `# Sample AMPL NLP
param c := 2.5;
var x1 >= -2, <= 11;
minimize obj: x1^2 - c * x1;
`;
    const data = getAmplSemanticTokens(src);
    assert.ok(
      data.length >= 20 && data.length % 5 === 0,
      `Expected non-empty 5-tuple semantic tokens, got ${data.length}`,
    );

    // Decode first token: # Sample AMPL NLP (line 0, char 0, type 9 = comment)
    assert.strictEqual(data[0], 0);
    assert.strictEqual(data[1], 0);
    assert.strictEqual(data[2], "# Sample AMPL NLP".length);
    assert.strictEqual(data[3], 9);

    // Ensure token deltas are non-negative and valid
    for (let i = 0; i < data.length; i += 5) {
      assert.ok(data[i]! >= 0, "deltaLine must be >= 0");
      assert.ok(data[i + 1]! >= 0, "deltaChar must be >= 0");
      assert.ok(data[i + 2]! > 0, "length must be > 0");
    }
  });

  it("publishes syntax and lint diagnostics for AMPL documents via ValidationService", async () => {
    const workspaceManager = new WorkspaceManager();
    registerBuiltinLanguagePlugins({ workspaceManager });

    const published: Array<{ uri: string; diagnostics: any[] }> = [];
    const mockConnection: any = {
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        published.push(params);
      },
      sendNotification: () => {},
      console: { info: () => {}, warn: () => {}, error: () => {}, log: () => {} },
    };

    const brokenAmpl = `var x1 >= 10, <= 5;
foo bar baz;
minimize obj: x1 + missing_var;
`;
    const uri = "file:///workspace/test_broken.ampl";
    const doc = TextDocument.create(uri, "ampl", 1, brokenAmpl);
    const mockDocManager: any = {
      documents: new Map([[uri, doc]]),
      documentTrees: new Map(),
      all: () => [doc],
    };
    const mockParserService: any = {
      ensureLanguageParserLoaded: async () => {},
      getSharedCstTreeWrapper: () => null,
      facade: null,
      sharedContext: null,
    };
    const validationService = new ValidationService(
      mockConnection,
      mockDocManager,
      workspaceManager,
      mockParserService,
    );

    await validationService.validateTextDocument(doc);

    assert.ok(published.length >= 1, "Expected ValidationService to publish diagnostics");
    const last = published[published.length - 1]!;
    assert.strictEqual(last.uri, uri);
    assert.ok(last.diagnostics.length >= 2, `Expected syntax + lint diagnostics, got ${last.diagnostics.length}`);
    assert.ok(
      last.diagnostics.some((d) => String(d.message).includes("Unexpected token") || String(d.code) === "M9501"),
      "Expected syntax error diagnostic",
    );
    assert.ok(
      last.diagnostics.some((d) => String(d.code) === "M9506" || String(d.code) === "M9504"),
      "Expected AMPL lint diagnostic (bounds conflict or undeclared variable)",
    );
  });
});
