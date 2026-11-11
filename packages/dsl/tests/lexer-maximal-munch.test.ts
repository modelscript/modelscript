// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "child_process";
import * as fs from "fs";
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import * as path from "path";
import { buildParser, choice, field, language, repeat, seq } from "../src/index.js";

const testDir = typeof __dirname !== "undefined" ? __dirname : path.resolve("packages/dsl/tests");

describe("Lexer Maximal Munch & Lookahead Recovery Suite", () => {
  const tmpDir = path.join(testDir, "scratch_build_maximal_munch");
  let activeFacade: any;
  let TreeClass: any;

  // Language with:
  // - String literals: "=", "==", "-", "->", "."
  // - Regex tokens: ArrowOp /==>/, FloatNumber /\.[0-9]+/, Identifier /[a-zA-Z_][a-zA-Z0-9_]*/
  // - Keyword: "while"
  const munchLang = language({
    name: "MaximalMunchLang",
    externals: ($) => [$.SPECULATIVE_TOKEN],
    rules: {
      SourceFile: ($) => repeat($._Item),
      _Item: ($) =>
        choice(
          $.WhileStmt,
          $.ArrowRule,
          $.AssignStmt,
          $.EquivStmt,
          $.DotAccess,
          $.FloatStmt,
          $.MinusStmt,
          $.SpeculativeStmt,
        ),
      WhileStmt: ($) => seq("while", field("cond", $.Identifier), ";"),
      ArrowRule: ($) => seq(field("lhs", $.Identifier), field("op", /==>/), field("rhs", $.Identifier), ";"),
      AssignStmt: ($) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Identifier), ";"),
      EquivStmt: ($) => seq(field("lhs", $.Identifier), "==", field("rhs", $.Identifier), ";"),
      DotAccess: ($) => seq(field("obj", $.Identifier), ".", field("prop", $.Identifier), ";"),
      FloatStmt: ($) => seq(field("val", /\.[0-9]+/), ";"),
      MinusStmt: ($) => seq(field("op", choice("-", "->")), field("target", $.Identifier), ";"),
      SpeculativeStmt: ($) => seq(field("tag", $.SPECULATIVE_TOKEN), field("name", $.Identifier), ";"),
      Identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,
    },
    extras: ($) => [/\s/],
    scanner: ($, lexer: any, valid: any) => {
      // Test speculative lookahead: if char is '?', peek ahead 2 chars
      // If 3rd char is '!', markEnd at 1 char and return SPECULATIVE_TOKEN
      // If not, advance and return 0 (testing cursor rewind)
      if (lexer.lookahead === 63) {
        // '?'
        lexer.advance();
        if (lexer.lookahead === 33) {
          // '!'
          lexer.markEnd();
          lexer.advance(); // advance past '!' as lookahead
          return $.SPECULATIVE_TOKEN;
        }
        // Failed speculation: return 0 without marking end
        return 0;
      }
      return 0;
    },
  });

  before(async () => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const build = buildParser(munchLang as any);

    for (const file of build.assemblyScriptFiles) {
      const destPath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.content);
    }

    const ascPath =
      [
        path.resolve(testDir, "../../node_modules/.bin/asc"),
        path.resolve(testDir, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";

    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "inherit" },
    );

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      build.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree };`;
    const getExports = new Function(wrapperSrc);
    const exportsObj = getExports();
    const { LspFacade, Tree } = exportsObj;
    TreeClass = Tree;

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });
    const imports = {
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  });

  after(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function parseToTree(code: string) {
    activeFacade.lastAstRoot = 0;
    const astRoot = activeFacade.parse(code);
    return new TreeClass(activeFacade, astRoot, code);
  }

  it("should match regex /==>/ over '=' and '==' via maximal munch", () => {
    const tree = parseToTree("A ==> B;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    assert.strictEqual(root.type, "SourceFile");
    const item = root.firstChild;
    assert.strictEqual(item.type, "ArrowRule");
    assert.strictEqual(item.childForFieldName("lhs").text, "A");
    assert.strictEqual(item.childForFieldName("op").text, "==>");
    assert.strictEqual(item.childForFieldName("rhs").text, "B");
  });

  it("should match '==' over '=' when input has exactly '=='", () => {
    const tree = parseToTree("A == B;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    const item = root.firstChild;
    assert.strictEqual(item.type, "EquivStmt");
    assert.strictEqual(item.childForFieldName("lhs").text, "A");
    assert.strictEqual(item.childForFieldName("rhs").text, "B");
  });

  it("should match '=' when input has '='", () => {
    const tree = parseToTree("A = B;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    const item = root.firstChild;
    assert.strictEqual(item.type, "AssignStmt");
    assert.strictEqual(item.childForFieldName("lhs").text, "A");
    assert.strictEqual(item.childForFieldName("rhs").text, "B");
  });

  it("should match float regex /\\.[0-9]+/ over member access '.'", () => {
    const tree = parseToTree(".123;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    const item = root.firstChild;
    assert.strictEqual(item.type, "FloatStmt");
    assert.strictEqual(item.childForFieldName("val").text, ".123");
  });

  it("should match member access '.' when not followed by digits", () => {
    const tree = parseToTree("foo.bar;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    const item = root.firstChild;
    assert.strictEqual(item.type, "DotAccess");
    assert.strictEqual(item.childForFieldName("obj").text, "foo");
    assert.strictEqual(item.childForFieldName("prop").text, "bar");
  });

  it("should match '->' over '-' via maximal munch", () => {
    const tree = parseToTree("-> target;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    const item = root.firstChild;
    assert.strictEqual(item.type, "MinusStmt");
    assert.strictEqual(item.childForFieldName("op").text, "->");
    assert.strictEqual(item.childForFieldName("target").text, "target");
  });

  it("should match keyword 'while' when input is 'while'", () => {
    const tree = parseToTree("while condition;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    const item = root.firstChild;
    assert.strictEqual(item.type, "WhileStmt");
    assert.strictEqual(item.childForFieldName("cond").text, "condition");
  });

  it("should match identifier when input starts with keyword prefix but is longer ('while1')", () => {
    const tree = parseToTree("while1 = B;");
    const diags = activeFacade.getDiagnostics();
    assert.strictEqual(diags.length, 0, `Diagnostics: ${JSON.stringify(diags)}`);
    const root = tree.rootNode;
    const item = root.firstChild;
    assert.strictEqual(item.type, "AssignStmt");
    assert.strictEqual(item.childForFieldName("lhs").text, "while1");
  });

  it("should correctly handle external scanner markEnd lookahead and cursor rewind", () => {
    // Input "?! name;" triggers markEnd after '?' (length 1), lookahead advances past '!',
    // but parser should record SPECULATIVE_TOKEN length 1, so '!' remains in input stream (or next token)
    const tree = parseToTree("?! name;");
    const root = tree.rootNode;
    assert.strictEqual(root.type, "SourceFile");
    const item = root.firstChild;
    assert.strictEqual(item.type, "SpeculativeStmt");
    assert.strictEqual(item.childForFieldName("tag").text, "?");
  });
});
