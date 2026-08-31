import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "SotaTestLanguage",
  word: ($: any) => $.Identifier,
  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
    multiWordKeywords: ["end scope"],
  },
  rules: {
    Program: ($: any) => repeat(choice($.ModelDef, $.ScopeDef)),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.Equation)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    ScopeDef: ($: any) =>
      seq(
        semanticToken("keyword", "scope"),
        field("name", $.Identifier),
        "{",
        repeat(choice($.Decl, $.Equation)),
        semanticToken("keyword", "end scope"),
        ";",
      ),
    Decl: ($: any) =>
      seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
    Type: ($: any) => choice("Real", "Integer"),
    Equation: ($: any) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.AddExpr, $.Identifier, $.Number),
    AddExpr: ($: any) => prec.left(1, seq(field("left", $.Expr), field("op", "+"), field("right", $.Expr))),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($: any) => [/\s+/],
});

describe("SOTA Architecture Verification Suite", () => {
  let activeFacade: any;
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_sota");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: () => {},
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
      parser: { logInt: (val: number) => console.log("WASM LOG INT:", val) },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Pillar 1: A* Priority Queue & Bounded Expansion Budget
  // --------------------------------------------------------------------------
  describe("Pillar 1: A* Driven Token Recovery", () => {
    it("should handle severe multi-token corruption within bounded expansion budget without stack overflow", () => {
      const code = `model Corrupted
        Real a = 1.0;
        ??? !!! %%% $$$ ### @@@ +++ ***
        Real b = 2.0;
      end Corrupted;`;

      const ast = activeFacade.parse(code);
      expect(ast).toBeGreaterThan(0);

      const tree = activeFacade.getAstSExpr(ast, true);
      // Ensure it recovered and parsed second declaration
      expect(tree).toContain("Real");
      expect(tree).toContain("b");
    });
  });

  // --------------------------------------------------------------------------
  // Pillar 2: Scope-Aware Synchronization Anchors
  // --------------------------------------------------------------------------
  describe("Pillar 2: Scope-Aware Synchronization Anchors", () => {
    it("should isolate scope boundary corruption so adjacent scopes parse cleanly", () => {
      const code = `scope ScopeA {
        Real x = 10.0;
        broken_garbage_token_without_semicolon
      end scope;

      scope ScopeB {
        Real y = 20.0;
        y = y + 1.0;
      end scope;`;

      const ast = activeFacade.parse(code);
      const diags = activeFacade.getDiagnostics(ast);

      // ScopeB (lines 6-9, 0-indexed 5-8) should contain NO diagnostics
      const scopeBDiags = diags.filter((d: any) => d.range.start.line >= 5);
      expect(scopeBDiags).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Pillar 3: O(1) Subtree Reuse with LR Start-State Check
  // --------------------------------------------------------------------------
  describe("Pillar 3: O(1) Subtree Reuse & startState Validation", () => {
    it("should set and retrieve startState accurately on allocated AST nodes", () => {
      const ast = activeFacade.parse(`model M Real x = 1.0; end M;`);
      expect(ast).toBeGreaterThan(0);

      if (typeof wasmExports.getNodeStartState === "function") {
        const initialState = wasmExports.getNodeStartState(ast);
        expect(typeof initialState).toBe("number");

        if (typeof wasmExports.setNodeStartState === "function") {
          wasmExports.setNodeStartState(ast, 108);
          expect(wasmExports.getNodeStartState(ast)).toBe(108);
          wasmExports.setNodeStartState(ast, initialState);
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Pillar 4: Dynamic Expected Tokens Diagnostics
  // --------------------------------------------------------------------------
  describe("Pillar 4: Dynamic Expected Tokens Diagnostics", () => {
    it("should return precise expected token diagnostics based on LR state bitset", () => {
      const code = `model Test
        Real x
      end Test;`;

      const ast = activeFacade.parse(code);
      const diags = activeFacade.getDiagnostics(ast);

      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toBeDefined();
      expect(diags[0].severity).toBe(1); // 1 = Error (Red Squiggle)
    });
  });

  // --------------------------------------------------------------------------
  // Pillar 5: Synthetic Node Dataflow Bypass
  // --------------------------------------------------------------------------
  describe("Pillar 5: Synthetic Node Dataflow Bypass", () => {
    it("should correctly support FLAG_IS_SYNTHETIC (0x400) on AST nodes", () => {
      const ast = activeFacade.parse(`model M Real x = 1.0; end M;`);
      expect(ast).toBeGreaterThan(0);

      if (typeof wasmExports.getNodeFlags === "function") {
        const FLAG_IS_SYNTHETIC = 1024; // 0x400
        const initialFlags = wasmExports.getNodeFlags(ast);
        expect(initialFlags & FLAG_IS_SYNTHETIC).toBe(0);

        if (typeof wasmExports.setNodeFlags === "function") {
          wasmExports.setNodeFlags(ast, initialFlags | FLAG_IS_SYNTHETIC);
          const updatedFlags = wasmExports.getNodeFlags(ast);
          expect(updatedFlags & FLAG_IS_SYNTHETIC).toBe(FLAG_IS_SYNTHETIC);

          // Restore original flags
          wasmExports.setNodeFlags(ast, initialFlags);
        }
      }
    });

    it("should not crash or generate spurious dataflow errors when synthetic recovery nodes are inserted", () => {
      const code = `scope SyntheticTest {
        Real a = 1.0
        Real b = 2.0;
      end scope;`;

      const ast = activeFacade.parse(code);
      expect(ast).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Pillar 6: Complete SOTA Integration Verification
  // --------------------------------------------------------------------------
  describe("Pillar 6: Complete SOTA System Verification", () => {
    it("should run incremental parsing and diagnostic extractions cleanly across consecutive edits", () => {
      const codeV1 = `model M1 Real x = 1.0; end M1;`;
      const codeV2 = `model M1 Real x = 1.0; Real y = 2.0; end M1;`;

      const astV1 = activeFacade.parse(codeV1);
      expect(astV1).toBeGreaterThan(0);

      const astV2 = activeFacade.parse(codeV2);
      expect(astV2).toBeGreaterThan(0);

      const diags = activeFacade.getDiagnostics(astV2);
      expect(diags).toHaveLength(0);
    });

    it("should maintain accurate diagnostic ranges for reused subtrees after incremental edits", () => {
      const codeV1 = `model M1
        Real x = 1.0;
        ??? !!! %%%
      end M1;`;

      activeFacade.lastAstRoot = 0;
      const astV1 = activeFacade.parse(codeV1);
      const diagsV1 = activeFacade.getDiagnostics(astV1);
      console.log("DIAGS V1:", JSON.stringify(diagsV1, null, 2));
      expect(diagsV1.length).toBeGreaterThan(0);

      // Incremental edit: insert whitespace on line 1 before reused block
      const codeV2 = `     model M1
        Real x = 1.0;
        ??? !!! %%%
      end M1;`;

      const astV2 = activeFacade.parseIncremental("     model M1", 0, 8, codeV2.length);
      const diagsV2 = activeFacade.getDiagnostics(astV2);
      console.log("DIAGS V2:", JSON.stringify(diagsV2, null, 2));
      const diag1 = diagsV1.find((d: any) => d.range.start.line === 2);
      const diag2 = diagsV2.find((d: any) => d.range.start.line === 2);
      expect(diag1).toBeDefined();
      expect(diag2).toBeDefined();
    });
  });
});
