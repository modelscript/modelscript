// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, choice, field, language, optional, prec, repeat, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import assert from "node:assert";
import { after as afterAll, before as beforeAll, describe, it } from "node:test";

const expect = (actual: any) => ({
  toBeGreaterThan: (expected: number) => assert.ok(actual > expected, `Expected ${actual} > ${expected}`),
  toContain: (expected: string) =>
    assert.ok(String(actual).includes(expected), `Expected ${actual} to contain ${expected}`),
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toHaveLength: (expected: number) => assert.strictEqual(actual?.length, expected),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelicaLikeGrammar = language({
  name: "ModelicaLikeGrammar",
  word: ($) => $.Identifier,
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.EquationSection)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) =>
      seq(
        optional(semanticToken("keyword", "parameter")),
        field("type", $.Type),
        field("name", $.Identifier),
        repeat(seq(",", field("name", $.Identifier))),
        optional(seq("=", field("value", $.Expr))),
        ";",
      ),
    Type: ($) => choice($.Identifier, "Real", "Integer", "Pin"),
    EquationSection: ($) => seq("equation", repeat($.Equation)),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.DotExpr, $.Identifier, $.Number),
    DotExpr: ($) => prec.left(3, seq(field("left", $.Expr), ".", field("right", $.Identifier))),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
});

describe("Incremental Repair Cleanliness Test", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_repair_cleanliness");
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

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "pipe" },
    );

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade, Tree } = getFacade();
    (activeFacade as any) = null;
    (global as any).TestTree = Tree;

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });

    let logDebug = false;
    (global as any).setLogDebug = (val: boolean) => {
      logDebug = val;
    };
    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
        logNode: () => {},
        debugLog: (id: number, p1: number, p2: number, p3: number) => {
          if (logDebug) console.log(`DEBUG: id=${id} p1=${p1} p2=${p2} p3=${p3}`);
        },
      },
      JavaScript: {
        debugLog: (id: number, p1: number, p2: number, p3: number) => {
          if (logDebug) console.log(`JS DEBUG: id=${id} p1=${p1} p2=${p2} p3=${p3}`);
        },
        logNode: () => {},
      },
      engine: {
        debugLog: (id: number, p1: number, p2: number, p3: number) => {
          if (logDebug) console.log(`ENG DEBUG: id=${id} p1=${p1} p2=${p2} p3=${p3}`);
        },
      },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
    activeFacade.syntaxNames = result.syntaxNames;
  }, 40000);

  afterAll(() => {
    // Keep tmpDir for inspection
  });

  it("should completely clear diagnostics when an error on Line 2 is repaired incrementally", () => {
    const baseCode = `model ElectricalCircuit
  Pin p, n;
  parameter Real R = 100.0;
  parameter Real L = 0.001;
  Real v, i;
equation
  v = p - n;
  0 = p + n;
  i = p;
  v = R * i;
end ElectricalCircuit;
`;

    // 1. Initial clean parse
    activeFacade.lastAstRoot = 0;
    const ast0 = activeFacade.parseIncremental(baseCode, 0, 0, baseCode.length);
    expect(ast0).toBeGreaterThan(0);
    const diags0 = activeFacade.getDiagnostics(ast0);
    expect(diags0).toHaveLength(0);

    // 2. Introduce error on Line 2: replace 'Pin p, n;' with 'Pin p n;' (delete comma)
    const commaOffset = baseCode.indexOf(",");
    expect(commaOffset).toBeGreaterThan(0);

    // Delete the comma
    const brokenAst = activeFacade.parseIncremental("", commaOffset, 1, baseCode.length - 1);
    expect(brokenAst).toBeGreaterThan(0);
    const brokenDiags = activeFacade.getDiagnostics(brokenAst);
    expect(brokenDiags.length).toBeGreaterThan(0);
    expect(brokenDiags[0].range.start.line).toBe(1);

    // 3. Repair the error: insert ',' back at commaOffset
    const repairedAst = activeFacade.parseIncremental(",", commaOffset, 0, baseCode.length);
    expect(repairedAst).toBeGreaterThan(0);
    const repairedDiags = activeFacade.getDiagnostics(repairedAst);
    expect(repairedDiags).toHaveLength(0);

    // 4. Introduce error by deleting semicolon at end of Line 2
    const semiOffset = baseCode.indexOf(";");
    expect(semiOffset).toBeGreaterThan(0);
    const brokenSemiAst = activeFacade.parseIncremental("", semiOffset, 1, baseCode.length - 1);
    const brokenSemiDiags = activeFacade.getDiagnostics(brokenSemiAst);
    expect(brokenSemiDiags.length).toBeGreaterThan(0);

    // 5. Repair semicolon back
    const repairedSemiAst = activeFacade.parseIncremental(";", semiOffset, 0, baseCode.length);
    const repairedSemiDiags = activeFacade.getDiagnostics(repairedSemiAst);
    expect(repairedSemiDiags).toHaveLength(0);
  });
});
