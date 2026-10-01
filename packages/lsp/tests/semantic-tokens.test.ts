// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert";
import path from "node:path";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { legend, registerSemanticTokensProvider } from "../src/providers/semanticTokensProvider.js";

test("LSP Semantic Tokens Test Suite", async (t) => {
  const wasmPath = path.resolve("languages/modelica/dist/parser.wasm");
  const { parser } = await createWasmParser(wasmPath);

  const modelicaSource = `model SimplePendulum "A pendulum"
  parameter Real L = 1.0 "Length";
  Real theta(start = 0.1);
  Real omega;
equation
  der(theta) = omega;
end SimplePendulum;`;

  const docUri = "file:///models/SimplePendulum.mo";
  const document = TextDocument.create(docUri, "modelica", 1, modelicaSource);

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

  await t.test("Generates semantic tokens when getDocumentTree returns raw Tree instance", () => {
    const tree = parser.parse(modelicaSource);

    // Simulate parserService.getDocumentTree returning tree directly
    registerSemanticTokensProvider(
      mockConn,
      mockDocs,
      () => tree,
      () => null,
      () => false,
      () => null,
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    assert.ok(fullHandler, "Semantic tokens full handler should be registered");

    const response = fullHandler({ textDocument: { uri: docUri } });
    assert.ok(response && Array.isArray(response.data), "Response must contain data array");
    assert.ok(response.data.length > 0, "Semantic tokens data must not be empty");

    // LSP semantic tokens are encoded as tuples of 5 unsigned integers:
    // [deltaLine, deltaStartChar, length, tokenTypeIndex, tokenModifierBitmask]
    assert.strictEqual(response.data.length % 5, 0, "Data length must be a multiple of 5");

    const tokens: { line: number; char: number; length: number; type: string; modifier: number }[] = [];
    let currentLine = 0;
    let currentChar = 0;

    for (let i = 0; i < response.data.length; i += 5) {
      const deltaLine = response.data[i];
      const deltaStartChar = response.data[i + 1];
      const length = response.data[i + 2];
      const tokenTypeIndex = response.data[i + 3];
      const modifier = response.data[i + 4];

      currentLine += deltaLine;
      currentChar = deltaLine > 0 ? deltaStartChar : currentChar + deltaStartChar;

      tokens.push({
        line: currentLine,
        char: currentChar,
        length,
        type: legend.tokenTypes[tokenTypeIndex],
        modifier,
      });
    }

    // Verify token ordering: strictly increasing line, or same line strictly increasing char without overlap
    for (let i = 1; i < tokens.length; i++) {
      const prev = tokens[i - 1];
      const curr = tokens[i];
      if (curr.line === prev.line) {
        assert.ok(
          curr.char >= prev.char + prev.length,
          `Tokens on same line must not overlap: prev=${JSON.stringify(prev)}, curr=${JSON.stringify(curr)}`,
        );
      } else {
        assert.ok(curr.line > prev.line, "Lines must be monotonically increasing");
      }
    }

    // Verify specific key tokens were classified properly
    // Line 0: "SimplePendulum" at col 6 -> class
    const classToken = tokens.find((tok) => tok.line === 0 && tok.char === 6);
    assert.ok(classToken, "SimplePendulum class token should be found");
    assert.strictEqual(classToken.type, "class");
    assert.strictEqual(classToken.modifier, 1, "Class declaration should have declaration modifier");

    // Line 1: "Real" at col 12 -> type
    const realTypeToken = tokens.find((tok) => tok.line === 1 && tok.char === 12);
    assert.ok(realTypeToken, "Real type token should be found");
    assert.strictEqual(realTypeToken.type, "type");

    // Line 1: "L" at col 17 -> parameter
    const lToken = tokens.find((tok) => tok.line === 1 && tok.char === 17);
    assert.ok(lToken, "parameter L token should be found");
    assert.strictEqual(lToken.type, "parameter");
    assert.strictEqual(lToken.modifier, 1, "Parameter declaration should have declaration modifier");

    // Line 1: "1.0" at col 21 -> number
    const numToken = tokens.find((tok) => tok.line === 1 && tok.char === 21);
    assert.ok(numToken, "Number literal token should be found");
    assert.strictEqual(numToken.type, "number");

    // Line 1: string at col 25 -> string
    const strToken = tokens.find((tok) => tok.line === 1 && tok.char === 25);
    assert.ok(strToken, "String literal token should be found");
    assert.strictEqual(strToken.type, "string");
  });

  await t.test("Generates semantic tokens when getDocumentTree returns wrapped { tree, text }", () => {
    const tree = parser.parse(modelicaSource);

    registerSemanticTokensProvider(
      mockConn,
      mockDocs,
      () => ({ tree, text: modelicaSource }),
      () => null,
      () => false,
      () => null,
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    const response = fullHandler({ textDocument: { uri: docUri } });
    assert.ok(response && Array.isArray(response.data));
    assert.ok(response.data.length > 0, "Semantic tokens should be generated with tree wrapper");
  });

  await t.test("Falls back to parseFallback if tree is missing or stale", () => {
    let fallbackCalled = false;

    registerSemanticTokensProvider(
      mockConn,
      mockDocs,
      () => null, // no cached tree
      () => null,
      () => false,
      (ext, text) => {
        fallbackCalled = true;
        return parser.parse(text);
      },
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    const response = fullHandler({ textDocument: { uri: docUri } });
    assert.ok(fallbackCalled, "parseFallback should be called when cached tree is null");
    assert.ok(response && response.data.length > 0, "Tokens should be returned from fallback parse");
  });
});
