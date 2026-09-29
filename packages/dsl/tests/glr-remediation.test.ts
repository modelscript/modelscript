// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, choice, language, optional, prec, repeat, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Grammar designed to test:
// 1. Root-level dynamic precedence tie-breaking
// 2. Large production reduction (>32 RHS elements) across GLR ambiguity
// 3. Epsilon reduction self-cycle resilience
const dsl = language({
  name: "GlrRemediationLang",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => choice($.DynamicTieHigh, $.DynamicTieLow, $.LongTupleStmt, $.EpsilonCycleStmt),

    // Priority 2: Two rules matching the exact same token stream but differing in dynamic precedence
    DynamicTieHigh: ($: any) => prec.dynamic(10, seq("dyn", $.Identifier, ";")),
    DynamicTieLow: ($: any) => prec.dynamic(1, seq("dyn", $.Identifier, ";")),

    // Priority 4: Large production with 36 elements inside an ambiguous construct
    LongTupleStmt: ($: any) =>
      seq(
        "tuple",
        "(",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ",",
        $.Identifier,
        ")",
        ";",
      ),

    // Priority 1: Epsilon rules that could create cycles
    EpsilonCycleStmt: ($: any) => seq("cycle", optional("a"), optional("b"), ";"),

    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s+/],
  conflicts: ($: any) => [[$.DynamicTieHigh, $.DynamicTieLow]],
  recovery: {
    sync: [";"],
  },
});

describe("GLR Remediation: Robustness, Soundness & Completeness", () => {
  let activeFacade: any;
  let tmpDir: string;
  let wasmInstance: any;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_glr_remediation_test");
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

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
        logNode: () => {},
        debugLog: () => {},
      },
      JavaScript: {
        debugLog: () => {},
        logNode: () => {},
      },
      engine: {
        debugLog: () => {},
      },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    wasmInstance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(wasmInstance.exports.memory, wasmInstance.exports);
  }, 60000);

  it("Priority 2: should resolve root-level dynamic precedence deterministically", () => {
    const code = "dyn foo;";
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const sexpr = activeFacade.getAstSExpr(ast, true);
    // DynamicTieHigh (prec.dynamic = 10) must win over DynamicTieLow (prec.dynamic = 1)
    expect(sexpr).toContain("(DynamicTieHigh");
    expect(sexpr).not.toContain("(DynamicTieLow");
  });

  it("Priority 4: should reduce large productions (>32 RHS elements) across GLR paths", () => {
    // 36 elements in tuple
    const ids = Array.from({ length: 36 }, (_, i) => `x${i}`).join(", ");
    const code = `tuple (${ids});`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const sexpr = activeFacade.getAstSExpr(ast, true);
    expect(sexpr).toContain("LongTupleStmt");
    expect(sexpr).not.toContain("ERROR");
  });

  it("Priority 1: should handle epsilon productions and self-merges without hanging", () => {
    const code = "cycle ;";
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const sexpr = activeFacade.getAstSExpr(ast, true);
    expect(sexpr).toContain("EpsilonCycleStmt");
    expect(sexpr).not.toContain("ERROR");
  });

  it("Priority 3: should correctly decode UTF-16BE characters in the lexer", () => {
    // Test peekChar directly from the compiled WASM exports for UTF-16BE (encoding 2)
    const exports = wasmInstance.exports;
    if (exports.setInputEncoding && exports.peekChar && exports.ensureInputBuffer) {
      // String "dyn" in UTF-16BE bytes:
      // 'd' = 0x0064 -> [0x00, 0x64]
      // 'y' = 0x0079 -> [0x00, 0x79]
      // 'n' = 0x006E -> [0x00, 0x6E]
      const beBytes = new Uint8Array([0x00, 0x64, 0x00, 0x79, 0x00, 0x6e]);
      const bufPtr = exports.ensureInputBuffer(beBytes.length);
      const mem8 = new Uint8Array(exports.memory.buffer);
      mem8.set(beBytes, bufPtr);

      exports.setInputLength(beBytes.length);
      exports.setInputEncoding(2); // UTF-16BE

      const ch0 = exports.peekChar(0);
      const ch1 = exports.peekChar(2);
      const ch2 = exports.peekChar(4);

      expect(ch0).toBe(0x64); // 'd'
      expect(ch1).toBe(0x79); // 'y'
      expect(ch2).toBe(0x6e); // 'n'

      // Reset back to UTF-16LE for default operation
      exports.setInputEncoding(1);
    }
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
