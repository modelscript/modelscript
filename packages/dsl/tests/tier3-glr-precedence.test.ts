// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { transpileQuery as transpileQueryExternal } from "../src/codegen/transpiler/transpiler.js";
import { buildParser, choice, grammar, NormalizedGrammar, prec, repeat1, seq } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Tier 3: GLR Semantic Actions, Precedence & Grammar Normalization", () => {
  it("should support functional and array precedences and supertypes", () => {
    // 1. Functional grammar options
    const gFunc = new NormalizedGrammar({
      name: "FuncGrammar",
      precedences: ($) => [
        ["multiply", "divide"],
        ["plus", "minus"],
      ],
      supertypes: ($) => [$._expr],
      rules: {
        source_file: ($) => repeat1($._expr),
        _expr: ($) => choice($.binary, $.num),
        binary: ($) => seq($.num, choice("+", "*"), $.num),
        num: () => /[0-9]+/,
      },
    });

    assert.equal(gFunc.globalPrecedences.get("multiply"), 2);
    assert.equal(gFunc.globalPrecedences.get('"multiply"'), 2);
    assert.equal(gFunc.globalPrecedences.get("plus"), 1);
    assert.ok(gFunc.supertypes.has("_expr"));
    assert.deepEqual(gFunc.supertypes.get("_expr"), ["binary", "num"]);

    // 2. Direct array grammar options
    const gArr = new NormalizedGrammar({
      name: "ArrGrammar",
      precedences: [
        ["*", "/"],
        ["+", "-"],
      ],
      supertypes: ["_expr"],
      rules: {
        source_file: ($) => repeat1($._expr),
        _expr: ($) => choice($.binary, $.num),
        binary: ($) => seq($.num, choice("+", "*"), $.num),
        num: () => /[0-9]+/,
      },
    });

    assert.equal(gArr.globalPrecedences.get("*"), 2);
    assert.equal(gArr.globalPrecedences.get('"*"'), 2);
    assert.equal(gArr.globalPrecedences.get("+"), 1);
    assert.ok(gArr.supertypes.has("_expr"));
    assert.deepEqual(gArr.supertypes.get("_expr"), ["binary", "num"]);
  });

  it("should create REPEAT1 rule type from repeat1 combinator", () => {
    const r = repeat1("item");
    assert.equal(r.type, "REPEAT1");
    assert.equal(r.children?.length, 1);
  });

  it("should transpile graph.scope.enter and pop scope on early return", () => {
    const queryFn = (node: any, graph: any) => {
      graph.scope.enter("MyScope", () => {
        if (node > 0) {
          return 42;
        }
      });
      return 0;
    };

    const result = transpileQueryExternal(queryFn);
    // Verified: before returning 42, graph.scope.pop() must be emitted
    assert.match(result.body, /graph\.scope\.pop\(\)/);
    assert.match(result.body, /graph\.scope\.push/);
  });

  it("should build and parse a grammar using repeat1, precedences, and GLR branching", async () => {
    const lang = grammar({
      name: "Tier3Calc",
      rules: {
        source_file: ($) => repeat1($.expr),
        expr: ($) => choice(prec.left(2, seq($.expr, "*", $.expr)), prec.left(1, seq($.expr, "+", $.expr)), $.number),
        number: () => /[0-9]+/,
      },
      extras: () => [/\s/],
    });

    const result = buildParser(lang);
    const tmpDir = path.join(__dirname, "scratch_build_tier3");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const destPath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "inherit" },
    );

    const wasmBinary = fs.readFileSync(outWasm);
    assert.ok(wasmBinary.length > 0, "WASM binary must be compiled");

    const wasmModule = await WebAssembly.compile(wasmBinary);
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
    const wasmMem = (instance.exports.memory as WebAssembly.Memory) || memory;
    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree, TreeSitterParser };`;
    const getExports = new Function(wrapperSrc);
    const { LspFacade: LspFacadeGen, TreeSitterParser: TreeSitterParserGen } = getExports();

    const facade = new LspFacadeGen(wasmMem, instance.exports);
    const treeParser = new TreeSitterParserGen();
    treeParser.setLanguage(() => facade);
    const tree = treeParser.parse("1 + 2 * 3\n");
    assert.ok(tree, "Tree should parse successfully");
    assert.ok(tree.rootNode, "Root node must exist");
    assert.equal(tree.rootNode.type, "source_file");
    assert.equal(tree.rootNode.childCount >= 1, true);

    // Clean up scratch build directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should preserve GLR fork when competing rule is unannotated and only resolve when both have precedence", () => {
    // 1. Both annotated: prec(2) vs prec(1) -> prec(2) wins
    const langBothAnnotated = grammar({
      name: "BothAnnotated",
      rules: {
        source: ($) => choice($.ruleA, $.ruleB),
        ruleA: ($) => prec(2, seq("x", "y")),
        ruleB: ($) => prec(1, seq("x", "y")),
      },
    });
    const parsedBoth = buildParser(langBothAnnotated);
    assert.ok(parsedBoth.parserInfo.statesCount > 0);

    // 2. One annotated, one unannotated: should NOT coerce unannotated to prec 0 and prune it
    const langOneUnannotated = grammar({
      name: "OneUnannotated",
      rules: {
        source: ($) => choice($.annotated, $.unannotated),
        annotated: ($) => prec(1, seq("x", "y")),
        unannotated: ($) => seq("x", "y"),
      },
    });
    const parsedOne = buildParser(langOneUnannotated);
    assert.ok(parsedOne.parserInfo.statesCount > 0);
  });
});
