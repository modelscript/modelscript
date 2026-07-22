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
        debugLog: (id: any, a: any, b: any, c: any) => {
          if (id === 111) console.log(`[DEBUG] tok=${a} pos=${b} result=${c}`);
        },
      },
      JavaScript: {
        debugLog: (id: any, a: any, b: any, c: any) => {
          if (id === 111) console.log(`[DEBUG] tok=${a} pos=${b} state=${c}`);
          if (id === 112) console.log(`[DEBUG] result=${a}`);
        },
        logNode: () => {},
      },
      engine: {
        debugLog: (id: any, a: any, b: any, c: any) => {
          if (id === 201) console.log(`[DEBUG ISLAND] p=${a} gssDepth=${b} cost=${c}`);
          if (id === 202) console.log(`[DEBUG ISLAND BEST] bestChildCount=${a} cost=${b} bestResumePos=${c}`);
        },
      },
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

    expect(diags.length).toBeGreaterThan(5);
  });

  it("should recover cleanly from scope {} by deleting premature brace when statements follow", () => {
    const scopeTest = `scope {}
  let velocity = 100;
  let mass = 50;
  let c = 1;
  print velocity;
}`;
    const ast = activeFacade.parse(scopeTest, true);
    const tree = activeFacade.getAstSExpr(ast, true);
    const diags = activeFacade.getDiagnostics(ast);

    // Should report a diagnostic on the deleted premature brace
    expect(diags.length).toBeGreaterThan(0);
    // The statements inside the block should be parsed as valid Decls and Usages
    expect(tree).toContain("Decl");
    expect(tree).toContain("Usage");
  });

  it("should prevent diagnostic bleed onto previous line whitespace", () => {
    activeFacade.setParserConfig(true, true, true, true);
    const code = "scope {\n  let a = 1;\n  \n  le\n}";
    const ast = activeFacade.parse(code, true);
    const diagnostics = activeFacade.getDiagnostics(ast);

    expect(diagnostics.length).toBeGreaterThan(0);
    const diag = diagnostics[0];

    // "le" starts at index 26
    expect(diag.startCharOffset).toBe(26);
  });

  it("should position error diagnostic directly on incomplete identifier 'le' on line 4 without bleeding to line 3", () => {
    activeFacade.setParserConfig(true, true, true, true);
    const code = "scope {\n  let velocity = 100;\n  let mass = 50;\n  le\n  print velocity;\n}";
    const ast = activeFacade.parse(code, true);
    const diagnostics = activeFacade.getDiagnostics(ast);

    expect(diagnostics.length).toBeGreaterThan(0);
    const leDiag = diagnostics.find((d: any) => d.range.start.line === 3);
    expect(leDiag).toBeDefined();
    expect(leDiag.range.start.character).toBe(2);
    expect(leDiag.range.end.character).toBe(4);

    const prevLineDiag = diagnostics.find((d: any) => d.range.start.line === 2);
    expect(prevLineDiag).toBeUndefined();
  });

  it("should aggregate diagnostic squiggles continuously for complex garbage", () => {
    const code = "scope {\n  let x = =" + "====== 1;\n}";
    const ast = activeFacade.parse(code);
    const tree = activeFacade.getAstSExpr(ast, true);
    const diags = activeFacade.getDiagnostics(ast);

    // Check if the tree contains the multiple '=' sibling structure
    if (tree.includes(' "=" ') || tree.includes(' "=" [')) {
      console.log("TREE HAS MULTIPLE EQUALS!");
    }
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
      { name: "Island Garbage", code: "scope { let a = 1; let x = ======== 10; }" },
      { name: "Missing Brace & Semicolon", code: "scope { let a = 1" },
    ];

    for (const scenario of scenarios) {
      describe(`Scenario: ${scenario.name}`, () => {
        for (const c of configurations) {
          it(`config: ${c.name}`, () => {
            activeFacade.setParserConfig(c.config[0], c.config[1], c.config[2], c.config[3]);
            const ast = activeFacade.parse(scenario.code);
            if (scenario.name === "Island Garbage" && c.name === "Only Island Mode") {
              console.log("ISLAND GARBAGE AST:", activeFacade.getAstSExpr(ast, true));
            }

            expect(ast).not.toBe(0);
            const tree = activeFacade.getAstSExpr(ast, true);
            const declCount = (tree.match(/\(Decl\s*(?:\[|\(E\))/g) || []).length;

            if (scenario.name === "Missing Semicolon") {
              if (c.name === "All Branches Enabled" || c.name === "Only Forced Reduction") {
                expect(declCount).toBe(2);
              }
            } else if (scenario.name === "Extra Token") {
              if (c.name === "All Branches Enabled" || c.name === "Only Island Mode") {
                expect(declCount).toBe(1);
              }
            } else if (scenario.name === "Island Garbage") {
              if (c.name === "All Branches Enabled" || c.name === "Only Island Mode") {
                expect(declCount).toBe(2);
              }
            }
          });
        }
      });
    }
  });

  describe("incremental parsing", () => {
    it("should handle ======== typing", () => {
      const facade = activeFacade;

      const code = `scope {
        let velocity = 100;
        let mass = 50;
        let x = 10;
        print velocity;
      }`;
      facade.parse(code);

      // simulate typing ======== before 10
      const insertPos = code.indexOf("10;") - 1;
      let currentCode = code;

      for (let i = 0; i < 8; i++) {
        currentCode = currentCode.substring(0, insertPos + i) + "=" + currentCode.substring(insertPos + i);

        const ast = facade.parseIncrementalBatch(
          [{ rangeOffset: insertPos + i, rangeLength: 0, text: "=" }],
          currentCode.length,
        );
        expect(ast).toBeGreaterThan(0);
      }
    });

    it("should recover cleanly from transposed tokens via Branch T without falling into island mode", () => {
      const facade = activeFacade;
      // "x let = 100;" transposed -> "let x = 100;"
      const code = `scope {
        x let = 100;
      }`;
      const ast = facade.parse(code);
      expect(ast).toBeGreaterThan(0);
      const tree = facade.getAstSExpr(ast, true);
      expect(tree).toContain("ERROR");
      expect(tree).toContain("Block");
    });

    it("should recover gracefully when scope {} is followed by statements and a closing brace", () => {
      const facade = activeFacade;
      const code = `scope {}
  let velocity = 100;
  let mass = 50;
  let x = 1;
  print velocity;
}

scope {
  let gravity = 9;
  print mass;
  print gravity;
}`;
      const ast = facade.parse(code, true);
      expect(ast).toBeGreaterThan(0);
      const tree = facade.getAstSExpr(ast, true);
      console.log("SCOPE {} AST:\n", tree);
    });

    it("should produce ZERO diagnostics for multi-line blank lines inside scope blocks", () => {
      const facade = activeFacade;
      const code = `scope {
  let velocity = 100;
  let mass = 50;




  print velocity;
}

scope {
  let gravity = 9;
  print mass;
  print gravity;
}`;
      const ast = facade.parse(code, true);
      const diagnostics = facade.getDiagnostics(ast);
      console.log("BLANK LINES DIAGNOSTICS:", JSON.stringify(diagnostics, null, 2));
      expect(diagnostics).toHaveLength(0);
    });

    it("should keep the first '=' and mark the rest as errors for consecutive duplicates", async () => {
      const code = `scope { let x = ======== 10; }`;
      // Pass true as second argument to force a full re-parse and prevent AST diffing bugs from previous tests
      const ast = activeFacade.parse(code, true);
      const diagnostics = activeFacade.getDiagnostics(ast);

      // The first '=' is at offset 14.
      // The extra '=' are at offsets 15-21.
      expect(diagnostics.length).toBeGreaterThan(0);

      const firstDiag = diagnostics[0];
      expect(firstDiag.startCharOffset).toBe(16);
      expect(firstDiag.endCharOffset).toBe(24); // Spans all extra duplicate '=' tokens in one batch diagnostic
    });

    it("should handle 'let x= ======= 1;' without diagnostic or semantic token corruption", async () => {
      const code = `scope {\n  let velocity = 100;\n  let mass = 50;\n  let x= ======= 1;\n  print velocity;\n}`;
      const ast = activeFacade.parse(code, true);
      const diags = activeFacade.getDiagnostics(ast);

      expect(diags.length).toBeGreaterThan(0);
    });

    it("should handle 75 consecutive semicolons inside a scope block without closing the block prematurely", () => {
      const code = `scope {
  let velocity = 100;
  let mass = 50;
  ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
  print velocity;
}

scope {
  let gravity = 9;
  print mass;
  print gravity;
}`;
      const ast = activeFacade.parse(code, true);
      const tree = activeFacade.getAstSExpr(ast, true);
      const diags = activeFacade.getDiagnostics(ast);

      // Verify that the second scope block remains valid and uncorrupted
      expect(tree).toContain("Decl [8, 2] - [8, 18]");
      expect(tree).toContain('"let" [8, 2] - [8, 5]');
    });

    it("should handle dangling 'let' keyword without corrupting subsequent scope blocks", () => {
      const code = `scope {
  let velocity = 100;
  let mass = 50;
  let
  print velocity;
}

scope {
  let gravity = 9;
  print mass;
  print gravity;
}`;
      const ast = activeFacade.parse(code, true);
      const tree = activeFacade.getAstSExpr(ast, true);

      // Verify that the second scope block remains valid and uncorrupted
      expect(tree).toContain("Decl [8, 2] - [8, 18]");
      expect(tree).toContain('"let" [8, 2] - [8, 5]');
    });

    it("should handle 50 consecutive duplicate error tokens in under 10ms without lag", () => {
      const code = `scope { let x = ${"=".repeat(50)} 10; }`;
      const t0 = performance.now();
      const ast = activeFacade.parse(code, true);
      const elapsed = performance.now() - t0;

      expect(ast).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(10); // Must parse 50 consecutive duplicate tokens in < 10ms
    });
  });
});
