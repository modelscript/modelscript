import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "DiagnosticLang",
  rules: {
    Program: ($: any) => repeat($.Block),
    Block: ($: any) => seq("scope", "{", repeat(choice($.Decl, $.Usage)), "}"),
    Decl: ($: any) => seq(semanticToken("keyword", "let"), field("name", $.Identifier), "=", $.Number, ";"),
    Usage: ($: any) => seq(semanticToken("keyword", "print"), field("target", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
  lsp: {},
  recovery: {
    sync: ["}", ";", "print", "let"],
  },
});

describe("GLR Parser Error Recovery Integration", () => {
  let activeFacade: any;
  let tmpDir: string;
  let wasmModule: WebAssembly.Module;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build");
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
    wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
        logNode: () => {},
        debugLog: (id: any, a: any, b: any, c: any) => {},
      },
      JavaScript: {
        debugLog: (id: any, a: any, b: any, c: any) => {},
        logNode: () => {},
      },
      engine: { debugLog: () => {} },
      parser: { logInt: (val: number) => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  beforeEach(() => {
    // Reset configuration to default for each test unless overridden
    activeFacade.setParserConfig(true, true, true, true);
  });

  it("should parse clean code with no errors", () => {
    const code = `scope {
  let velocity = 100;
  print velocity;
}`;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast, true);

    expect(tree).toContain("(Program");
    expect(tree).toContain("(Decl");
    expect(tree).not.toContain("ERROR");

    const diags = activeFacade.getDiagnostics(ast);
    expect(diags).toHaveLength(0);
  });

  it("should insert a ghost node for a missing semicolon", () => {
    const code = `scope {
  let velocity = 100
  print velocity;
}`;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast, true);
    const diags = activeFacade.getDiagnostics(ast);

    expect(diags.length).toBeGreaterThan(0);
    expect(tree).toContain("(Usage");
  });

  it("should use Island Mode to skip garbage tokens inside a block", () => {
    const code = `scope {
  let velocity = 100;
  some garbage text here
  print velocity;
}`;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast, true);

    expect(tree).toContain("ERROR");
    expect(tree).toContain("/[a-zA-Z_][a-zA-Z0-9_]*/");
    expect(tree).toContain("(Usage");
  });

  it("should handle combined recovery (garbage + missing closing brace)", () => {
    const code = `scope {
  let velocity = 100;
  garbage again`;
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast, true);

    expect(tree).toContain("ERROR");
    expect(tree).toContain("/[a-zA-Z_][a-zA-Z0-9_]*/");
  });

  it("should prevent token offset bleed on incomplete identifiers", () => {
    const leTest = `scope {
  let velocity = 100;
  let mass = 50;
  le
  print velocity;
}`;
    const ast = activeFacade.parse(leTest);
    const diags = activeFacade.getDiagnostics(ast);
    const tree = activeFacade.getAstSExpr(ast, true);

    expect(diags.length).toBeGreaterThan(0);
    expect(tree).toContain("ERROR");
    expect(tree).toContain("(Usage"); // recovers the print statement
  });

  it("should recover gracefully from an empty declaration", () => {
    const code = `scope {\n  let velocity = 100;\n  let mass = 50;\n  let ;\n  print velocity;\n}`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    const tree = activeFacade.getAstSExpr(ast, true);

    expect(diags.length).toBeGreaterThan(0);
    expect(tree).toContain("ERROR");
  });

  it("should generate correct semantic tokens with error padding", () => {
    const exactTest = `scope {
  let velocity = 100;
  let mass = 50;
  le 1;
  print velocity;
}`;
    const ast = activeFacade.parse(exactTest);
    const tokens = activeFacade.getSemanticTokens(ast);

    // Ensure semantic tokens were emitted
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.length % 4).toBe(0);
  });

  it("should handle stress test with large multi-branch recovery without crashing", () => {
    const numDecls = 200;
    let stressTest = "scope {\n";
    for (let i = 0; i < numDecls; i++) {
      if (i % 10 === 0) {
        stressTest += `  let var${i} = 100 \n`;
      } else if (i % 25 === 0) {
        stressTest += `  garbage_token ${i} \n`;
      } else if (i % 30 === 0) {
        stressTest += `  let = 10 \n`;
      } else {
        stressTest += `  let var${i} = ${i};\n`;
      }
    }
    stressTest += `  print result;\n}`;

    const ast = activeFacade.parse(stressTest);
    const diags = activeFacade.getDiagnostics(ast);

    expect(diags.length).toBeGreaterThan(20);
  });

  it("should penalize unwinding scope closers to prevent silent structural corruption", () => {
    const scopeTest = `scope {}
  let velocity = 100;
  let mass = 50;
  let c = 1;
  print velocity;
}`;
    const ast = activeFacade.parse(scopeTest);
    const tree = activeFacade.getAstSExpr(ast, true);
    const diags = activeFacade.getDiagnostics(ast);

    // Since all tokens appear after the closed block, they shouldn't be parsed as Decls inside the block
    expect(diags.length).toBeGreaterThan(0);
    // The block should be closed properly
    expect(tree).toMatch(/Block \[\d+, \d+\] - \[\d+, \d+\]\)/);
    // We should have a top-level ERROR node that absorbed everything outside the block
    expect(tree).toContain("(ERROR");
  });

  describe("Matrix Test (Testing branch configurations)", () => {
    const configurations = [
      { name: "All Branches Enabled", config: [true, true, true, true] },
      { name: "Only Deletion", config: [true, false, false, false] },
      { name: "Only Insertion", config: [false, true, false, false] },
      { name: "Only Forced Reduction", config: [false, false, true, false] },
      { name: "Only Island Mode", config: [false, false, false, true] },
      { name: "No Recovery", config: [false, false, false, false] },
    ];

    const scenarios = [
      { name: "Missing Semicolon", code: "scope { let a = 1 let b = 2; }" },
      { name: "Extra Token", code: "scope { let a = 1 garbage ; }" },
      { name: "Island Garbage", code: "scope { let a = 1; garbage text let b = 2; }" },
      { name: "Missing Brace & Semicolon", code: "scope { let a = 1" },
    ];

    for (const scenario of scenarios) {
      describe(`Scenario: ${scenario.name}`, () => {
        for (const c of configurations) {
          it(`config: ${c.name}`, () => {
            activeFacade.setParserConfig(c.config[0], c.config[1], c.config[2], c.config[3]);
            const ast = activeFacade.parse(scenario.code);

            // Sanity check
            expect(ast).not.toBe(0);

            const tree = activeFacade.getAstSExpr(ast, true);
            const declCount = (tree.match(/\(Decl/g) || []).length;

            if (scenario.name === "Missing Semicolon") {
              if (c.name === "All Branches Enabled" || c.name === "Only Forced Reduction") {
                expect(declCount).toBe(2);
              }
            } else if (scenario.name === "Extra Token") {
              if (c.name === "All Branches Enabled" || c.name === "Only Deletion" || c.name === "Only Island Mode") {
                expect(declCount).toBe(1);
              }
            } else if (scenario.name === "Island Garbage") {
              if (c.name === "All Branches Enabled") {
                expect(declCount).toBe(2);
              } else if (c.name === "Only Island Mode") {
                expect(declCount).toBe(1);
              }
            }
          });
        }
      });
    }
  });
});
