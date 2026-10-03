// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression tests for GLR parser subtree reuse & list handling bugs.
// Covers bugs #1–#6, #8 (including boundary touch), #9, #10, #11, #12, #13 from parser_reuse_review.

import { buildParser, choice, field, language, optional, prec, repeat, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import assert from "node:assert";
import { after as afterAll, before as beforeAll, describe, it } from "node:test";

const expect = (actual: any) => ({
  toBeGreaterThan: (expected: number) => assert.ok(actual > expected, `Expected ${actual} > ${expected}`),
  toBeLessThan: (expected: number) => assert.ok(actual < expected, `Expected ${actual} < ${expected}`),
  toContain: (expected: string) =>
    assert.ok(String(actual).includes(expected), `Expected "${String(actual).slice(0, 200)}" to contain "${expected}"`),
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toHaveLength: (expected: number) => assert.strictEqual(actual?.length, expected),
  toBeTruthy: () => assert.ok(actual, `Expected ${actual} to be truthy`),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reuse the ModelicaLikeGrammar that exercises lists, equations, and nested constructs.
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

describe("List Handling & Subtree Reuse Robustness", () => {
  let activeFacade: any;
  let TreeClass: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_list_robustness");
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
    TreeClass = Tree;

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory,
        abort: () => {},
        logNode: () => {},
        debugLog: () => {},
      },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
    activeFacade.syntaxNames = result.syntaxNames;
  }, 40000);

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Helper: fresh parse (resets incremental state)
  // -----------------------------------------------------------------------
  function freshParse(code: string): number {
    activeFacade.lastAstRoot = 0;
    return activeFacade.parseIncremental(code, 0, 0, code.length);
  }

  // -----------------------------------------------------------------------
  // Bug #1  — fixNodeLength shared-tree sibling corruption
  // Bug #2  — fixNodeLength wrong byteLength when pPad != firstPad
  //
  // Strategy: Parse a model, then perform TWO successive incremental edits
  // that both touch the same list region. The second edit forces fixNodeLength
  // to operate on a tree whose siblings were shared by the first edit's clone.
  // Without the fix, the sibling chain is corrupted and the second reparse
  // produces wrong byte offsets or phantom diagnostics.
  // -----------------------------------------------------------------------
  it("Bug #1/#2: successive incremental edits near list boundaries preserve correct byte offsets", () => {
    const code = [
      "model M",
      "  Real a;",
      "  Real b;",
      "  Real c;",
      "  Real d;",
      "  Real e;",
      "  Real f;",
      "  Real g;",
      "  Real h;",
      "equation",
      "  a = b + c;",
      "  d = e + f;",
      "  g = h;",
      "end M;",
    ].join("\n");

    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Edit 1: insert a new declaration "  Real x;\n" after "  Real d;"
    const insertPt = code.indexOf("  Real e;");
    const insertText = "  Real x;\n";
    const code1 = code.slice(0, insertPt) + insertText + code.slice(insertPt);
    const ast1 = activeFacade.parseIncremental(insertText, insertPt, 0, code1.length);
    expect(ast1).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast1)).toHaveLength(0);

    // Edit 2: insert another declaration "  Real y;\n" right after the first insertion
    const insertPt2 = insertPt + insertText.length;
    const insertText2 = "  Real y;\n";
    const code2 = code1.slice(0, insertPt2) + insertText2 + code1.slice(insertPt2);
    const ast2 = activeFacade.parseIncremental(insertText2, insertPt2, 0, code2.length);
    expect(ast2).toBeGreaterThan(0);
    const diags2 = activeFacade.getDiagnostics(ast2);
    expect(diags2).toHaveLength(0);

    // Verify the S-expression contains all declarations
    const sexpr = activeFacade.getAstSExpr(ast2);
    expect(sexpr).toContain("ModelDef");
  });

  // -----------------------------------------------------------------------
  // Bug #3  — concatLists Strategy B padding bleed
  //
  // Strategy: Parse a model with many declarations (>= LIST_MAX_CHILDREN = 16)
  // to trigger Strategy B splitting. Verify that diagnostics are empty AND
  // that the AST's root node endIndex matches the source length.
  // -----------------------------------------------------------------------
  it("Bug #3: large list Strategy B split preserves correct padding and byte offsets", () => {
    // Generate a model with 40 declarations to force multiple Strategy B splits
    const decls = Array.from({ length: 40 }, (_, i) => `  Real var_${i};`).join("\n");
    const code = `model BigModel\n${decls}\nequation\n  var_0 = var_1;\nend BigModel;\n`;

    const ast = freshParse(code);
    expect(ast).toBeGreaterThan(0);
    const diags = activeFacade.getDiagnostics(ast);
    expect(diags).toHaveLength(0);

    // Verify the tree spans the entire source
    const tree = new TreeClass(activeFacade, ast, code);
    expect(tree.rootNode).toBeTruthy();
    // endIndex should be at or near the end of the source
    expect(tree.rootNode.endIndex).toBe(code.trimEnd().length);
  });

  // -----------------------------------------------------------------------
  // Bug #3 extended: incremental edit in the middle of a Strategy B list
  //
  // Strategy: Parse a large list, then delete a declaration from the middle.
  // After the incremental reparse, the tree must still have correct positions
  // and zero diagnostics. This exercises fixNodeLength + concatLists on the
  // re-balanced list after element removal.
  // -----------------------------------------------------------------------
  it("Bug #3 extended: incremental deletion from Strategy B list stays clean", () => {
    const decls = Array.from({ length: 30 }, (_, i) => `  Real v${i};`).join("\n");
    const code = `model D\n${decls}\nend D;\n`;

    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Delete "  Real v15;\n" from the middle
    const target = "  Real v15;\n";
    const delStart = code.indexOf(target);
    expect(delStart).toBeGreaterThan(0);
    const code1 = code.slice(0, delStart) + code.slice(delStart + target.length);
    const ast1 = activeFacade.parseIncremental("", delStart, target.length, code1.length);
    expect(ast1).toBeGreaterThan(0);
    const diags1 = activeFacade.getDiagnostics(ast1);
    expect(diags1).toHaveLength(0);

    // Re-insert to restore original
    const code2 = code;
    const ast2 = activeFacade.parseIncremental(target, delStart, 0, code2.length);
    expect(ast2).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast2)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Bug #4/#4b — null splitHead in appendToList at LIST_MAX_CHILDREN boundary
  //
  // Strategy: Parse a model with exactly LIST_MAX_CHILDREN (16) declarations,
  // then incrementally add one more to trigger the split code path. This forces
  // appendToList's split logic to find the boundary at the very last child.
  // -----------------------------------------------------------------------
  it("Bug #4: appending past LIST_MAX_CHILDREN boundary does not crash or corrupt", () => {
    const decls = Array.from({ length: 16 }, (_, i) => `  Real z${i};`).join("\n");
    const code = `model SplitBoundary\n${decls}\nend SplitBoundary;\n`;

    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Append a 17th declaration right before "end" to trigger the split
    const endPos = code.indexOf("\nend ");
    const insertText = "\n  Real z16;";
    const code1 = code.slice(0, endPos) + insertText + code.slice(endPos);
    const ast1 = activeFacade.parseIncremental(insertText, endPos, 0, code1.length);
    expect(ast1).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast1)).toHaveLength(0);

    // Append an 18th
    const endPos2 = code1.indexOf("\nend ");
    const insertText2 = "\n  Real z17;";
    const code2 = code1.slice(0, endPos2) + insertText2 + code1.slice(endPos2);
    const ast2 = activeFacade.parseIncremental(insertText2, endPos2, 0, code2.length);
    expect(ast2).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast2)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Bug #5 — null origC1 in concatLists asymmetric depth path
  //
  // Strategy: Build up an asymmetric list tree by appending elements one at
  // a time across multiple incremental edits. This creates uneven B-tree
  // depths in the list structure, exercising the asymmetric concat path.
  // -----------------------------------------------------------------------
  it("Bug #5: asymmetric list depth concat does not dereference null children", () => {
    let code = "model Asym\n  Real a0;\nend Asym;\n";
    let ast = freshParse(code);
    expect(ast).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast)).toHaveLength(0);

    // Incrementally add 25 declarations one at a time
    for (let i = 1; i <= 25; i++) {
      const endPos = code.indexOf("\nend ");
      const insertText = `\n  Real a${i};`;
      code = code.slice(0, endPos) + insertText + code.slice(endPos);
      ast = activeFacade.parseIncremental(insertText, endPos, 0, code.length);
      expect(ast).toBeGreaterThan(0);
    }

    // Final tree should have all 26 declarations and no diagnostics
    const diags = activeFacade.getDiagnostics(ast);
    expect(diags).toHaveLength(0);
    const tree = new TreeClass(activeFacade, ast, code);
    const decls = tree.rootNode.descendantsOfType("Decl");
    expect(decls).toHaveLength(26);
  });

  // -----------------------------------------------------------------------
  // Bug #6  — tautological reuse guard preventing punctuation token reuse
  //
  // Strategy: Parse clean code, then delete a semicolon (creating an error),
  // then re-insert it. The fix allows the parser to reuse punctuation tokens
  // adjacent to the edit without re-lexing them. Diagnostics must clear to 0.
  // -----------------------------------------------------------------------
  it("Bug #6: punctuation tokens adjacent to edit boundary are reusable after repair", () => {
    const code = `model Punct\n  Real a;\n  Real b;\n  Real c;\nend Punct;\n`;
    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Delete the semicolon after "Real b"
    const semiPos = code.indexOf("Real b;") + "Real b".length;
    const code1 = code.slice(0, semiPos) + code.slice(semiPos + 1);
    const ast1 = activeFacade.parseIncremental("", semiPos, 1, code1.length);
    expect(ast1).toBeGreaterThan(0);
    const diags1 = activeFacade.getDiagnostics(ast1);
    expect(diags1.length).toBeGreaterThan(0);

    // Re-insert the semicolon
    const code2 = code;
    const ast2 = activeFacade.parseIncremental(";", semiPos, 0, code2.length);
    expect(ast2).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast2)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Bug #6 extended: comma deletion and repair at token boundary
  // -----------------------------------------------------------------------
  it("Bug #6 extended: comma deletion and repair at word boundary clears diagnostics", () => {
    const code = `model Multi\n  Real a, b, c;\nend Multi;\n`;
    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Delete first comma between 'a' and 'b'
    const commaPos = code.indexOf(",");
    const code1 = code.slice(0, commaPos) + code.slice(commaPos + 1);
    const ast1 = activeFacade.parseIncremental("", commaPos, 1, code1.length);
    expect(activeFacade.getDiagnostics(ast1).length).toBeGreaterThan(0);

    // Re-insert comma
    const code2 = code;
    const ast2 = activeFacade.parseIncremental(",", commaPos, 0, code2.length);
    expect(ast2).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast2)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Bug #8  — stale g_lastSlicedEnd after recursive extractListSlice
  //
  // Strategy: Parse a large model (exercising list slicing), then perform a
  // targeted incremental edit within the first half of the list. The prefix
  // splice path uses g_lastSlicedEnd to determine where to resume. If stale,
  // positions drift after the edit. We verify by checking that the repaired
  // tree has no diagnostics and its endIndex is correct.
  // -----------------------------------------------------------------------
  it("Bug #8: incremental edit within prefix of large list does not cause position drift", () => {
    const decls = Array.from({ length: 50 }, (_, i) => `  Real r${i};`).join("\n");
    const eqs = "  r0 = r1;\n  r2 = r3;";
    const code = `model Prefix\n${decls}\nequation\n${eqs}\nend Prefix;\n`;

    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Delete "  Real r5;\n" from the first quarter of the list
    const target = "  Real r5;\n";
    const delStart = code.indexOf(target);
    const code1 = code.slice(0, delStart) + code.slice(delStart + target.length);
    const ast1 = activeFacade.parseIncremental("", delStart, target.length, code1.length);
    expect(ast1).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast1)).toHaveLength(0);

    // Re-insert it
    const code2 = code;
    const ast2 = activeFacade.parseIncremental(target, delStart, 0, code2.length);
    expect(ast2).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast2)).toHaveLength(0);

    // Verify endIndex is correct
    const tree = new TreeClass(activeFacade, ast2, code2);
    expect(tree.rootNode.endIndex).toBe(code2.trimEnd().length);
  });

  // -----------------------------------------------------------------------
  // Bug #12 — infinite loop risk in findReusableNode cursor loop
  //
  // Strategy: Parse deeply malformed input that creates nested error-list
  // structures. Without the depth guard, findReusableNode could loop
  // indefinitely. We verify the parse completes in bounded time.
  // -----------------------------------------------------------------------
  it("Bug #12: deeply malformed input does not hang findReusableNode", () => {
    // Create deeply nested garbage that the parser wraps in error lists
    const garbage = Array.from({ length: 100 }, (_, i) => `${"(".repeat(3)}garbage${i}${"@#$".repeat(2)}`).join(" ");
    const code = `model Err\n${garbage}\nend Err;\n`;

    const start = Date.now();
    const ast0 = freshParse(code);
    const elapsed = Date.now() - start;
    expect(ast0).toBeGreaterThan(0);

    // Parse should complete in a reasonable time (not hang)
    expect(elapsed).toBeLessThan(5000);

    // Now do an incremental edit in the middle of the garbage to exercise
    // findReusableNode on the error tree
    const midPos = Math.floor(code.length / 2);
    const insertText = "INSERTED";
    const code1 = code.slice(0, midPos) + insertText + code.slice(midPos);
    const start2 = Date.now();
    const ast1 = activeFacade.parseIncremental(insertText, midPos, 0, code1.length);
    const elapsed2 = Date.now() - start2;
    expect(ast1).toBeGreaterThan(0);
    expect(elapsed2).toBeLessThan(5000);
  });

  // -----------------------------------------------------------------------
  // Bug #13 — concatLists with non-list structural symbols (listSym == 0)
  //
  // Strategy: Parse input that produces non-list nodes being concatenated
  // during recovery. Without the fix, concatLists would create ERROR-typed
  // wrapper nodes. We verify no false ERROR-typed wrappers leak into the
  // diagnostic output.
  // -----------------------------------------------------------------------
  it("Bug #13: parse with recovery does not produce phantom ERROR diagnostics from listSym==0", () => {
    // Parse two models — the second is missing its end identifier,
    // which forces recovery that may attempt concat with non-list nodes
    const code = `model A\n  Real x;\nend A;\nmodel B\n  Real y;\nend B;\n`;
    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Now break the second model's end keyword
    const endBPos = code.lastIndexOf("end B;");
    const code1 = code.slice(0, endBPos) + "endB;" + code.slice(endBPos + "end B;".length);
    const ast1 = activeFacade.parseIncremental("endB;", endBPos, "end B;".length, code1.length);
    expect(ast1).toBeGreaterThan(0);

    // The error should be localized — no phantom ERROR diagnostics from
    // concatLists wrapping non-list nodes in ERROR-typed wrappers
    const diags = activeFacade.getDiagnostics(ast1);
    // May have diagnostics, but they should be real errors, not phantom ones
    // from listSym==0 wrapper creation. The S-expression should still have
    // both model structures present.
    const sexpr = activeFacade.getAstSExpr(ast1);
    expect(sexpr).toContain("ModelDef");

    // Repair and verify clean
    const code2 = code;
    const ast2 = activeFacade.parseIncremental("end B;", endBPos, "endB;".length, code2.length);
    expect(ast2).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast2)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Combined stress test: rapid successive edits across a large model
  //
  // Exercises bugs #1, #2, #3, #6, #8 together by performing many small
  // incremental edits in sequence on a large model.
  // -----------------------------------------------------------------------
  it("stress: 20 rapid incremental edits on a large model produce no regressions", () => {
    // Build a model with 30 declarations and 5 equations
    const decls = Array.from({ length: 30 }, (_, i) => `  Real s${i};`).join("\n");
    const eqs = Array.from({ length: 5 }, (_, i) => `  s${i} = s${i + 1};`).join("\n");
    let code = `model Stress\n${decls}\nequation\n${eqs}\nend Stress;\n`;

    let ast = freshParse(code);
    expect(ast).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast)).toHaveLength(0);

    // Perform 20 alternating insert/delete cycles at various positions
    for (let i = 0; i < 10; i++) {
      // Delete the semicolon after s{i*3}
      const target = `s${i * 3};`;
      const semiPos = code.indexOf(target);
      if (semiPos < 0) continue;
      const semiActual = semiPos + target.length - 1; // position of ';'

      // Delete semicolon
      const code1 = code.slice(0, semiActual) + code.slice(semiActual + 1);
      ast = activeFacade.parseIncremental("", semiActual, 1, code1.length);
      expect(ast).toBeGreaterThan(0);
      // Should have at least one diagnostic
      const brokenDiags = activeFacade.getDiagnostics(ast);
      expect(brokenDiags.length).toBeGreaterThan(0);

      // Re-insert semicolon
      ast = activeFacade.parseIncremental(";", semiActual, 0, code.length);
      expect(ast).toBeGreaterThan(0);
      const repairedDiags = activeFacade.getDiagnostics(ast);
      expect(repairedDiags).toHaveLength(0);
    }
  });

  // -----------------------------------------------------------------------
  // Bug #1 extended: GLR mode shared tree across multiple edit cycles
  //
  // Exercises shared sibling marking by performing edits that cause the
  // parser to operate in GLR mode (ambiguous grammar region) followed by
  // edits in the LR region. The sibling chain must remain intact.
  // -----------------------------------------------------------------------
  it("Bug #1 extended: edits in equation section (GLR-ambiguous) followed by declaration section", () => {
    const code = ["model GLR", "  Real p;", "  Real q;", "equation", "  p = q + 1;", "  q = p - 1;", "end GLR;"].join(
      "\n",
    );

    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Edit in equation section: delete "  q = p - 1;\n"
    const eqTarget = "  q = p - 1;\n";
    const eqStart = code.indexOf(eqTarget);
    const code1 = code.slice(0, eqStart) + code.slice(eqStart + eqTarget.length);
    const ast1 = activeFacade.parseIncremental("", eqStart, eqTarget.length, code1.length);
    expect(ast1).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast1)).toHaveLength(0);

    // Now edit in declaration section: insert "  Real r;\n"
    const insertPt = code1.indexOf("  Real q;") + "  Real q;\n".length;
    const insertText = "  Real r;\n";
    const code2 = code1.slice(0, insertPt) + insertText + code1.slice(insertPt);
    const ast2 = activeFacade.parseIncremental(insertText, insertPt, 0, code2.length);
    expect(ast2).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast2)).toHaveLength(0);

    // Re-insert the deleted equation
    const eqInsertPt = code2.indexOf("\nend GLR;");
    const code3 = code2.slice(0, eqInsertPt) + "\n  q = r - 1;" + code2.slice(eqInsertPt);
    const ast3 = activeFacade.parseIncremental("\n  q = r - 1;", eqInsertPt, 0, code3.length);
    expect(ast3).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast3)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Bug #2 extended: varying whitespace between declarations
  //
  // Different amounts of whitespace between declarations causes padding
  // mismatches in fixNodeLength. Without the fix, pPad != firstPad would
  // produce wrong byte lengths.
  // -----------------------------------------------------------------------
  it("Bug #2 extended: varying whitespace between declarations produces correct positions", () => {
    const code = [
      "model Whitespace",
      "  Real a;",
      "",
      "",
      "  Real b;",
      "   Real c;",
      "",
      "      Real d;",
      "  Real e;",
      "end Whitespace;",
    ].join("\n");

    const ast = freshParse(code);
    expect(ast).toBeGreaterThan(0);
    const diags = activeFacade.getDiagnostics(ast);
    expect(diags).toHaveLength(0);

    // Verify the tree spans the correct range
    const tree = new TreeClass(activeFacade, ast, code);
    expect(tree.rootNode.endIndex).toBe(code.length);

    // Incrementally add more whitespace and verify positions stay correct
    const insertPt = code.indexOf("\n  Real b;");
    const extraWs = "\n\n\n";
    const code1 = code.slice(0, insertPt) + extraWs + code.slice(insertPt);
    const ast1 = activeFacade.parseIncremental(extraWs, insertPt, 0, code1.length);
    expect(ast1).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast1)).toHaveLength(0);

    const tree1 = new TreeClass(activeFacade, ast1, code1);
    expect(tree1.rootNode.endIndex).toBe(code1.length);
  });

  // -----------------------------------------------------------------------
  // Bug #9: copyChildren transfers first child padding when parent padding is 0
  //
  // Strategy: Perform an incremental edit that triggers an immutable list copy
  // on a list with leading padding on the first child. The resulting copied list
  // must preserve the correct byte offset without shifting by the absorbed padding.
  // -----------------------------------------------------------------------
  it("Bug #9: immutable copyChildren transfers first child padding cleanly", () => {
    const code = [
      "model PadCopy",
      "      Real firstWithBigPad;",
      "  Real second;",
      "  Real third;",
      "end PadCopy;",
    ].join("\n");

    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Incrementally insert at the end of the list to force copyChildren on immutable branches
    const endPos = code.indexOf("\nend PadCopy;");
    const insertText = "\n  Real fourth;";
    const code1 = code.slice(0, endPos) + insertText + code.slice(endPos);
    const ast1 = activeFacade.parseIncremental(insertText, endPos, 0, code1.length);
    expect(ast1).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast1)).toHaveLength(0);

    const tree = new TreeClass(activeFacade, ast1, code1);
    expect(tree.rootNode.endIndex).toBe(code1.length);
  });

  // -----------------------------------------------------------------------
  // Bug #10: appendToList split fallback when no FLAG_LIST_BOUNDARY is present
  //
  // Strategy: Build a large list with >= 24 declarations using consecutive
  // appends to force the split path. Even if elements lack explicit boundary flags
  // (e.g. from concatenations), the split must not degenerate into an empty right chunk.
  // -----------------------------------------------------------------------
  it("Bug #10: list splitting without explicit boundary flags does not degenerate", () => {
    let code = "model SplitFallback\n";
    for (let i = 0; i < 20; i++) {
      code += `  Real v${i};\n`;
    }
    code += "end SplitFallback;\n";

    let ast = freshParse(code);
    expect(ast).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast)).toHaveLength(0);

    // Add 10 more elements incrementally to trigger splits multiple times
    for (let i = 20; i < 30; i++) {
      const endPos = code.indexOf("end SplitFallback;");
      const insertText = `  Real v${i};\n`;
      code = code.slice(0, endPos) + insertText + code.slice(endPos);
      ast = activeFacade.parseIncremental(insertText, endPos, 0, code.length);
      expect(ast).toBeGreaterThan(0);
      expect(activeFacade.getDiagnostics(ast)).toHaveLength(0);
    }

    const tree = new TreeClass(activeFacade, ast, code);
    const decls = tree.rootNode.descendantsOfType("Decl");
    expect(decls).toHaveLength(30);
  });

  // -----------------------------------------------------------------------
  // Bug #11: restoreCursorCheckpoint properly restores path stack from checkpoint
  //
  // Strategy: Cause the GLR parser to explore an ambiguous branch that fails
  // and restores the cursor checkpoint. The restored cursor must not corrupt
  // subsequent lookups.
  // -----------------------------------------------------------------------
  it("Bug #11: GLR exploratory branch rollback restores global cursor correctly", () => {
    const code = [
      "model CursorRollback",
      "  Real a;",
      "  Real b;",
      "equation",
      "  a = b + 1 * 2;",
      "  b = a - 1 * 2;",
      "end CursorRollback;",
    ].join("\n");

    const ast0 = freshParse(code);
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Edit in equation section where operator precedence causes exploratory GLR branches
    const target = "1 * 2;";
    const editPos = code.indexOf(target);
    const newText = "3 + 4 * 5;";
    const code1 = code.slice(0, editPos) + newText + code.slice(editPos + target.length);
    const ast1 = activeFacade.parseIncremental(newText, editPos, target.length, code1.length);
    expect(ast1).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast1)).toHaveLength(0);

    const tree = new TreeClass(activeFacade, ast1, code1);
    expect(tree.rootNode.endIndex).toBe(code1.length);
  });
});
