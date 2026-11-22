// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildParser, choice, field, language, optional, prec, repeat, seq } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const recoveryLang = language({
  name: "RecoveryLocalizationLang",
  word: ($) => $.Ident,
  brackets: [
    ["(", ")"],
    ["{", "}"],
  ],
  recovery: {
    delimiters: ["end"],
    structuralRules: ["Block", "Decl"],
  },
  extras: () => [/[ \t\r\n]+/],
  rules: {
    Program: ($) => repeat($.Stmt),
    Stmt: ($) => choice($.Decl, $.CallStmt, $.Block),
    Decl: ($) => seq("let", field("name", $.Ident), "=", field("value", $.Expr), ";"),
    CallStmt: ($) => seq(field("callee", $.Ident), "(", optional(seq($.Expr, repeat(seq(",", $.Expr)))), ")", ";"),
    Block: ($) => seq("block", field("name", $.Ident), "{", repeat($.Stmt), "}", "end", ";"),
    Expr: ($) => choice(prec.left(1, seq($.Expr, "+", $.Expr)), seq("(", $.Expr, ")"), $.Number, $.Ident),
    Ident: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    Number: () => /[0-9]+/,
  },
});

describe("GLR Error Recovery Localization, Determinism & Memory Isolation", () => {
  const tmpDir = path.join(__dirname, "scratch_build_recovery_localization");
  let activeFacade: any;
  let TreeClass: any;

  before(async () => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const build = buildParser(recoveryLang as any);
    for (const file of build.assemblyScriptFiles) {
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
      { stdio: "inherit" },
    );

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);
    const wrapperSrc =
      build.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree };`;
    const { LspFacade, Tree } = new Function(wrapperSrc)();
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

  function parseCode(code: string) {
    activeFacade.lastAstRoot = 0;
    const astRoot = activeFacade.parse(code);
    return {
      tree: new TreeClass(activeFacade, astRoot, code),
      diags: activeFacade.getDiagnostics(astRoot),
    };
  }

  it("never degrades or rejects valid parses", () => {
    const code = `block Main {\n  let x = (1 + 2);\n  foo(x, 3);\n} end;\n`;
    const { tree, diags } = parseCode(code);
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got ${JSON.stringify(diags)}`);
    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.descendantsOfType("Decl").length, 1);
    assert.equal(tree.rootNode.descendantsOfType("CallStmt").length, 1);
  });

  it("localizes missing RHS expression via non-terminal placeholder (`let x = ;`) without swallowing sibling decls", () => {
    const code = `let x = ;\nlet y = 2;\nlet z = 3;\n`;
    const { tree, diags } = parseCode(code);
    assert.ok(diags.length >= 1, "Expected diagnostic for missing expression");
    const decls = tree.rootNode.descendantsOfType("Decl");
    assert.ok(
      decls.length >= 2,
      `Expected sibling declarations preserved, got ${decls.length}: ${tree.rootNode.toString()}`,
    );
    const names = decls.map((d: any) => d.childForFieldName("name")?.text);
    assert.ok(names.includes("y"), `Expected 'y' decl preserved in ${JSON.stringify(names)}`);
    assert.ok(names.includes("z"), `Expected 'z' decl preserved in ${JSON.stringify(names)}`);
  });

  it("recovers cleanly at EOF on unclosed delimiter / missing semicolon via MRD completion", () => {
    const code = `let a = 1;\nlet b = (2 + 3`;
    const { tree, diags } = parseCode(code);
    assert.ok(diags.length >= 1, "Expected diagnostic at EOF");
    const decls = tree.rootNode.descendantsOfType("Decl");
    assert.ok(decls.length >= 1, `Expected declarations preserved at EOF: ${tree.rootNode.toString()}`);
    assert.equal(decls[0].childForFieldName("name")?.text, "a");
  });

  it("recovers multi-token local error (`foo(a, b` missing `)` and `;`) via local A* without swallowing following statements", () => {
    const code = `foo(a, b\nlet y = 1;\nlet z = 2;\nlet w = 3;\n`;
    const { tree, diags } = parseCode(code);
    assert.ok(diags.length >= 1, "Expected diagnostic for missing ')' and ';'");
    const decls = tree.rootNode.descendantsOfType("Decl");
    const names = decls.map((d: any) => d.childForFieldName("name")?.text);
    assert.ok(names.includes("y"), `Expected 'y' preserved in ${JSON.stringify(names)}: ${tree.rootNode.toString()}`);
    assert.ok(names.includes("z"), `Expected 'z' preserved in ${JSON.stringify(names)}`);
    assert.ok(names.includes("w"), `Expected 'w' preserved in ${JSON.stringify(names)}`);
  });

  it("splits merged keyword prefix (`letx = 1;`) without mutating input buffer", () => {
    const code = `letx = 1;\nlet y = 2;\n`;
    const { tree, diags } = parseCode(code);
    assert.ok(diags.length >= 1, "Expected diagnostic for merged 'letx'");
    const decls = tree.rootNode.descendantsOfType("Decl");
    const names = decls.map((d: any) => d.childForFieldName("name")?.text);
    assert.ok(names.includes("y"), `Expected 'y' preserved in ${JSON.stringify(names)}: ${tree.rootNode.toString()}`);
    // Verify original text is intact (input buffer untouched)
    assert.equal(tree.rootNode.text.trim(), code.trim());
  });

  it("is 100% deterministic across repeated parses with multiple simultaneous errors", () => {
    const broken = `block B {\n  let x = ;\n  foo(1, 2\n  let y = 42;\n} end;\n`;
    const first = parseCode(broken);
    const firstSexpr = first.tree.rootNode.toString();
    const firstDiags = JSON.stringify(first.diags);

    for (let run = 0; run < 5; run++) {
      const next = parseCode(broken);
      assert.equal(next.tree.rootNode.toString(), firstSexpr, `Run ${run} diverged in AST S-expression`);
      assert.equal(JSON.stringify(next.diags), firstDiags, `Run ${run} diverged in diagnostics`);
    }
  });

  it("maintains incremental == fresh parity across NT placeholder, EOF, merged-token, and local A* edits", () => {
    const edits: [string, string][] = [
      ["let x = 1;\nlet y = 2;\n", "let x = ;\nlet y = 2;\n"],
      ["let x = ;\nlet y = 2;\n", "let x = 10;\nlet y = 2;\n"],
      ["let a = 1;\nlet b = (2 + 3);\n", "let a = 1;\nlet b = (2 + 3"],
      ["foo(a, b);\nlet y = 1;\nlet z = 2;\nlet w = 3;\n", "foo(a, b\nlet y = 1;\nlet z = 2;\nlet w = 3;\n"],
      ["let x = 1;\nlet y = 2;\n", "letx = 1;\nlet y = 2;\n"],
    ];

    for (const [beforeSrc, afterSrc] of edits) {
      // 1. Fresh parse of afterSrc
      const fresh = parseCode(afterSrc);
      const freshSexpr = fresh.tree.rootNode.toString();

      // 2. Parse beforeSrc, then incremental edit -> afterSrc
      activeFacade.lastAstRoot = 0;
      activeFacade.parse(beforeSrc);
      // Find minimal differing span
      let start = 0;
      while (start < beforeSrc.length && start < afterSrc.length && beforeSrc[start] === afterSrc[start]) start++;
      let oldEnd = beforeSrc.length;
      let newEnd = afterSrc.length;
      while (oldEnd > start && newEnd > start && beforeSrc[oldEnd - 1] === afterSrc[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      const incRoot = activeFacade.parseIncremental(
        afterSrc.slice(start, newEnd),
        start,
        oldEnd - start,
        afterSrc.length,
      );
      const incTree = new TreeClass(activeFacade, incRoot, afterSrc);
      assert.equal(
        incTree.rootNode.toString(),
        freshSexpr,
        `Incremental != fresh for edit '${beforeSrc.replace(/\n/g, "\\n")}' -> '${afterSrc.replace(/\n/g, "\\n")}'`,
      );
    }
  });

  it("microbenchmark: localizes multiple errors in a 300-line file with low error coverage and fast runtime", () => {
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) {
      if (i === 50) lines.push("let broken_rhs = ;");
      else if (i === 120) lines.push("foo(a, b");
      else if (i === 200) lines.push("letmerged = 42;");
      else lines.push(`let v_${i} = ${i} + 1;`);
    }
    const bigBroken = lines.join("\n") + "\n";

    const t0 = performance.now();
    const { tree, diags } = parseCode(bigBroken);
    const elapsedMs = performance.now() - t0;

    const decls = tree.rootNode.descendantsOfType("Decl");
    const errorNodes = tree.rootNode.descendantsOfType("ERROR");
    const errorBytes = errorNodes.reduce((acc: number, n: any) => acc + (n.endIndex - n.startIndex), 0);
    const errorCoveragePct = (errorBytes / bigBroken.length) * 100;

    assert.ok(diags.length >= 3, `Expected >= 3 diagnostics, got ${diags.length}`);
    assert.ok(decls.length >= 295, `Expected >= 295 preserved Decl nodes out of 299, got ${decls.length}`);
    assert.ok(
      errorCoveragePct < 5,
      `Expected localized ERROR coverage < 5%, got ${errorCoveragePct.toFixed(2)}% (errors=${JSON.stringify(
        errorNodes.map((n: any) => ({
          start: n.startIndex,
          end: n.endIndex,
          len: n.endIndex - n.startIndex,
          head: n.text.slice(0, 30),
        })),
      )})`,
    );
    assert.ok(elapsedMs < 250, `Expected recovery parse < 250ms, took ${elapsedMs.toFixed(1)}ms`);
  });

  it("recovers Damerau-Levenshtein distance-1 keyword typos (`blcok Main { ... }`) without mutating input", () => {
    const code = `blcok Main {\n  let x = 1;\n} end;\nlet y = 2;\n`;
    const { tree, diags } = parseCode(code);
    assert.ok(diags.length >= 1, "Expected diagnostic for typo 'blcok'");
    const decls = tree.rootNode.descendantsOfType("Decl");
    const names = decls.map((d: any) => d.childForFieldName("name")?.text);
    assert.ok(names.includes("x"), `Expected 'x' preserved in ${JSON.stringify(names)}: ${tree.rootNode.toString()}`);
    assert.ok(names.includes("y"), `Expected 'y' preserved in ${JSON.stringify(names)}: ${tree.rootNode.toString()}`);
    assert.equal(tree.rootNode.text.trim(), code.trim());
  });

  it("handles extra closing brackets (`foo(a, b));`) and newline-separated unclosed expressions cleanly", () => {
    const code = `foo(a, b));\nlet a = (1 + 2\nlet b = 2;\nlet c = 3;\n`;
    const { tree, diags } = parseCode(code);
    assert.ok(diags.length >= 2, `Expected >= 2 diagnostics, got ${diags.length}`);
    const decls = tree.rootNode.descendantsOfType("Decl");
    const names = decls.map((d: any) => d.childForFieldName("name")?.text);
    assert.ok(names.includes("b"), `Expected 'b' preserved in ${JSON.stringify(names)}: ${tree.rootNode.toString()}`);
    assert.ok(names.includes("c"), `Expected 'c' preserved in ${JSON.stringify(names)}: ${tree.rootNode.toString()}`);
  });
});
