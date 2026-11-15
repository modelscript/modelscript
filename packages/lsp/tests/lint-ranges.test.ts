// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { ValidationService } from "../src/services/validation-service.js";

describe("LSP ValidationService Diagnostic Range Normalization", () => {
  it("skips leading whitespace and clamps EOL when normalizing plugin diagnostics", async () => {
    const sent: any[] = [];
    const fakeConnection = {
      sendDiagnostics: (params: any) => {
        sent.push(params);
      },
      console: {
        info: () => {},
        warn: () => {},
        error: () => {},
        log: () => {},
      },
    } as any;
    const fakeDocumentManager = {
      documentTrees: new Map(),
      get: () => undefined,
      all: () => [],
    } as any;
    const fakeWorkspaceService = {
      workspaceIndex: undefined,
      syncDocumentLibraryVersions: async () => {},
    } as any;

    const testLangId = "range-norm-test";
    const testExt = ".rntest";
    const sampleText = "  TOKEN_A   extra  \n    SECOND_LINE\n";

    globalLanguageRegistry.register({
      id: testLangId,
      name: "RangeNormTest",
      extensions: [testExt],
      languageDef: { id: testLangId, extensions: [testExt], lexer: {}, grammar: {} } as any,
      customHandlers: {
        validate: () => [
          {
            line: 1,
            message: "Omitted column should skip leading spaces and highlight TOKEN_A",
            severity: 1,
            code: "T001",
          },
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 999 } },
            message: "Explicit range at col 0 with trailing spaces/oversized end should clamp",
            severity: 2,
            code: "T002",
          },
        ],
      },
    });

    const service = new ValidationService(fakeConnection, fakeDocumentManager, fakeWorkspaceService);
    const doc = TextDocument.create("file:///test/sample.rntest", testLangId, 1, sampleText);
    await service.validateTextDocument(doc);

    assert.ok(sent.length > 0, "Expected diagnostics sent");
    const diags = sent[sent.length - 1].diagnostics;
    assert.strictEqual(diags.length, 2);

    // T001: "  TOKEN_A   extra  " -> starts at 2, ends at 9 ("TOKEN_A")
    assert.deepStrictEqual(diags[0].range, {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 9 },
    });

    // T002: "    SECOND_LINE" -> starts at 4, clamped to line length 15 ("SECOND_LINE")
    assert.deepStrictEqual(diags[1].range, {
      start: { line: 1, character: 4 },
      end: { line: 1, character: 15 },
    });
  });
});
