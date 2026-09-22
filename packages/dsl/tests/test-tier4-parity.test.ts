import { buildParser, choice, field, language, optional, prec, repeat, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import assert from "node:assert";
import { after as afterAll, before as beforeAll, describe, it } from "node:test";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const expect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toBeGreaterThan: (expected: number) => assert.ok(actual > expected, `Expected ${actual} > ${expected}`),
  toBeGreaterThanOrEqual: (expected: number) => assert.ok(actual >= expected, `Expected ${actual} >= ${expected}`),
  toContain: (expected: string) =>
    assert.ok(String(actual).includes(expected), `Expected ${actual} to contain ${expected}`),
  toBeDefined: () => assert.ok(actual !== undefined && actual !== null, `Expected value to be defined`),
  toBeNull: () => assert.strictEqual(actual, null),
  toBeFalse: () => assert.strictEqual(actual, false),
  toBeTrue: () => assert.strictEqual(actual, true),
});

const testGrammar = language({
  name: "Tier4ParityDSL",
  word: ($) => $.Identifier,
  lsp: {
    folding: ["ModelDef"],
    outline: ["ModelDef", "Decl"],
  },
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.Equation)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) =>
      seq(
        field("type", $.Type),
        field("name", $.Identifier),
        repeat(seq(",", field("name", $.Identifier))),
        optional(seq("=", field("value", $.Expr))),
        ";",
      ),
    Type: ($) => choice($.Identifier, "Real", "Integer"),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
});

describe("Tier 4 & Tree-sitter Parity Architecture Suite", () => {
  let activeFacade: any;
  let TreeClass: any;
  let WasmTreeCursorClass: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_tier4_parity");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const destPath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree, WasmTreeCursor };`;
    const getExports = new Function(wrapperSrc);
    const exportsObj = getExports();
    const { LspFacade, Tree, WasmTreeCursor } = exportsObj;
    TreeClass = Tree;
    WasmTreeCursorClass = WasmTreeCursor;

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
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Item 15: Value-Type TreeCursor Re-entrancy & Isolation", () => {
    it("should instantiate independent cursors that traverse without clobbering each other", () => {
      const code = `model M1\n  Real x;\nend M1;\nmodel M2\n  Real y;\nend M2;\n`;
      const astRoot = activeFacade.parse(code);
      expect(astRoot).toBeGreaterThan(0);

      // Create two independent value-type cursors
      const cursor1 = activeFacade.createTreeCursor(astRoot);
      const cursor2 = activeFacade.createTreeCursor(astRoot);

      expect(cursor1.currentNode()).toBe(astRoot);
      expect(cursor2.currentNode()).toBe(astRoot);
      expect(cursor1.depth()).toBe(0);
      expect(cursor2.depth()).toBe(0);

      // Move cursor1 down
      expect(cursor1.gotoFirstChild()).toBeTrue();
      const child1 = cursor1.currentNode();
      expect(cursor1.depth()).toBe(1);

      // Move cursor1 down another level
      expect(cursor1.gotoFirstChild()).toBeTrue();
      const grandChild1 = cursor1.currentNode();
      expect(cursor1.depth()).toBe(2);

      // Grandchild has siblings (e.g. name, body, end)
      expect(cursor1.gotoNextSibling()).toBeTrue();
      const grandChild2 = cursor1.currentNode();
      assert.notStrictEqual(grandChild1, grandChild2);
      expect(cursor1.depth()).toBe(2);

      // Verify cursor2 was completely untouched at root
      expect(cursor2.depth()).toBe(0);
      expect(cursor2.currentNode()).toBe(astRoot);

      // Move cursor2 down one level
      expect(cursor2.gotoFirstChild()).toBeTrue();
      expect(cursor2.currentNode()).toBe(child1);
      expect(cursor2.depth()).toBe(1);

      // Concurrently: cursor1 is at depth 2 (grandChild2), cursor2 is at depth 1 (child1)
      expect(cursor1.depth()).toBe(2);
      expect(cursor2.depth()).toBe(1);

      // Move cursor1 back to parent
      expect(cursor1.gotoParent()).toBeTrue();
      expect(cursor1.depth()).toBe(1);
      expect(cursor1.currentNode()).toBe(child1);

      // Move cursor1 back to root
      expect(cursor1.gotoParent()).toBeTrue();
      expect(cursor1.depth()).toBe(0);
      expect(cursor1.currentNode()).toBe(astRoot);

      // cursor2 is still at depth 1
      expect(cursor2.depth()).toBe(1);
      expect(cursor2.currentNode()).toBe(child1);
    });
  });

  describe("Item 13: Multi-Range Incremental Edits", () => {
    it("should parse text with multiple discontinuous edits and produce exact same AST as fresh parse", () => {
      const codeV1 = `model M1\n  Real a;\nend M1;\nmodel M2\n  Real b;\nend M2;\n`;
      activeFacade.lastAstRoot = 0;
      const astV1 = activeFacade.parse(codeV1);
      expect(astV1).toBeGreaterThan(0);

      // Perform two simultaneous edits:
      // Edit 1: 'a' -> 'alpha' (net +4 characters)
      // Edit 2: 'b' -> 'beta'
      const posA = codeV1.indexOf("Real a;") + "Real ".length;
      const posB = codeV1.indexOf("Real b;") + "Real ".length;

      const codeV2 = `model M1\n  Real alpha;\nend M1;\nmodel M2\n  Real beta;\nend M2;\n`;
      activeFacade.lastAstRoot = 0;
      const freshAst = activeFacade.parse(codeV2);
      const expectedSExpr = activeFacade.getAstSExpr(freshAst);

      // Multi-range edit descriptors (in UTF-16 byte offsets)
      const edits = [
        {
          startByte: posA * 2,
          oldEndByte: (posA + 1) * 2,
          newEndByte: (posA + "alpha".length) * 2,
        },
        {
          startByte: (posB + 4) * 2, // shifted by +4 characters in new document
          oldEndByte: (posB + 4 + 1) * 2,
          newEndByte: (posB + 4 + "beta".length) * 2,
        },
      ];

      activeFacade.lastAstRoot = astV1;
      const incrementalAst = activeFacade.parse(codeV2, edits, 0, 0, undefined, astV1);
      expect(incrementalAst).toBeGreaterThan(0);

      const actualSExpr = activeFacade.getAstSExpr(incrementalAst);
      expect(actualSExpr).toEqual(expectedSExpr);
    });
  });

  describe("Item 14: Changed Ranges Computation (Tree Diffing)", () => {
    it("should return empty array when comparing identical trees", () => {
      const code = `model M\n  Real x;\nend M;\n`;
      activeFacade.lastAstRoot = 0;
      const ast = activeFacade.parse(code);
      const diffs = activeFacade.getChangedRanges(ast, ast);
      expect(diffs.length).toBe(0);
    });

    it("should compute precise changed byte spans for modified subtrees while skipping unchanged ones", () => {
      const codeV1 = `model First\n  Real x;\nend First;\nmodel Second\n  Real y;\nend Second;\n`;
      activeFacade.lastAstRoot = 0;
      const astV1 = activeFacade.parse(codeV1);

      // Incremental parse modifying only 'Second' model
      const codeV2 = `model First\n  Real x;\nend First;\nmodel Second\n  Real z;\nend Second;\n`;
      const posY = codeV1.indexOf("Real y;") + "Real ".length;
      activeFacade.lastAstRoot = astV1;
      const astV2 = activeFacade.parse(codeV2, posY, posY + 1, posY + 1, undefined, astV1);

      const diffs = activeFacade.getChangedRanges(astV1, astV2);
      expect(diffs.length).toBeGreaterThan(0);

      // The changed range should be within the Second model, NOT the First model
      const firstModelEnd = codeV1.indexOf("end First;\n") + "end First;\n".length;
      for (const diff of diffs) {
        // start is in UTF-16 byte offset, so divide by 2 for character position
        const charStart = diff.start / 2;
        expect(charStart).toBeGreaterThanOrEqual(firstModelEnd);
      }
    });
  });

  describe("Item 12: Semantic Tokens Delta Protocol", () => {
    it("should return initial full tokens and then minimal delta edits on change", () => {
      const codeV1 = `model M\n  Real x = 1.0;\nend M;\n`;
      activeFacade.lastAstRoot = 0;
      const astV1 = activeFacade.parse(codeV1);

      // Step 1: Request initial delta with prevResultId = 0
      const initialResp = activeFacade.getSemanticTokensDelta(astV1, 0);
      expect(initialResp.resultId).toBe(1);
      expect(initialResp.fullTokens).toBeDefined();
      expect(initialResp.fullTokens.length).toBeGreaterThan(0);

      // Step 2: Make edit changing variable name from 'x' to 'x_renamed' (different token length & column deltas)
      const codeV2 = `model M\n  Real x_renamed = 1.0;\nend M;\n`;
      activeFacade.lastAstRoot = 0;
      const astV2 = activeFacade.parse(codeV2);

      // Request delta with prevResultId = 1
      const deltaResp = activeFacade.getSemanticTokensDelta(astV2, 1);
      expect(deltaResp.resultId).toBe(2);
      expect(deltaResp.edits).toBeDefined();
      expect(deltaResp.edits.length).toBeGreaterThan(0);

      // Verify that applying delta edits reproduces the new full tokens
      const fullV2 = activeFacade.getSemanticTokens(astV2);
      const reconstructed = Array.from(initialResp.fullTokens);
      for (const edit of deltaResp.edits) {
        reconstructed.splice(edit.start, edit.deleteCount, ...edit.data);
      }
      expect(new Uint32Array(reconstructed)).toEqual(fullV2);
    });
  });

  describe("Item L3: AST Caching for Folding Ranges & Document Symbols", () => {
    it("should return identical folding ranges on repeat calls and hit fast cache path", () => {
      const code = `model M\n  Real x;\n  Real y;\nequation\n  x = 1.0;\nend M;\n`;
      activeFacade.lastAstRoot = 0;
      const ast = activeFacade.parse(code);

      const ranges1 = activeFacade.getFoldingRanges(ast);
      const ranges2 = activeFacade.getFoldingRanges(ast);

      expect(ranges1.length).toBeGreaterThan(0);
      expect(ranges2).toEqual(ranges1);
    });

    it("should return identical document symbols on repeat calls and hit fast cache path", () => {
      const code = `model M\n  Real x;\nend M;\n`;
      activeFacade.lastAstRoot = 0;
      const ast = activeFacade.parse(code);

      const symbols1 = activeFacade.getDocumentSymbols(ast);
      const symbols2 = activeFacade.getDocumentSymbols(ast);

      expect(symbols1.length).toBeGreaterThan(0);
      expect(symbols2).toEqual(symbols1);
    });
  });

  describe("Item L5: Inverted Symbol Index for References", () => {
    it("should query inverted symbol index across registered documents", () => {
      const code = `model M\n  Real x;\nequation\n  x = 10.0;\nend M;\n`;
      activeFacade.lastAstRoot = 0;
      const ast = activeFacade.parse(code);

      // Register document with fileId = 1
      activeFacade.exports.lsp_registerDocument(1, ast);

      // Target 'x' in 'Real x;'
      const xOffset = code.indexOf("Real x;") + "Real ".length;
      const xByteOffset = xOffset * 2;

      const refs = activeFacade.getReferences(ast, xByteOffset);
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs[0].fileId).toBe(1);
    });
  });

  describe("Item B2: Root Padding Assembly", () => {
    it("should preserve root leading whitespace without trivia shift", () => {
      const codeWithTrivia = `   \n  model M\n  Real x;\nend M;\n`;
      activeFacade.lastAstRoot = 0;
      const ast = activeFacade.parse(codeWithTrivia);
      expect(ast).toBeGreaterThan(0);

      const sexpr = activeFacade.getAstSExpr(ast);
      expect(sexpr).toContain("ModelDef");
      expect(sexpr).toContain("Identifier");
      expect(sexpr).toContain("M");
    });
  });
});
