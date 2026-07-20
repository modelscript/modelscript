import { buildParser, choice, field, language, repeat, semanticToken, seq } from "@modelscript/language";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A simple grammar with declarations, blocks, and expressions to trigger different recovery paths.
const dsl = language({
  name: "RecoveryLang",
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
});

const testCases = [
  {
    name: "Branch A (Deletion) - Duplicate/extra tokens",
    code: `scope {
      let x = = 10;
      print print y;
    }`,
  },
  {
    name: "Branch B (Insertion) - Missing semicolon",
    code: `scope {
      let x = 10
      print y;
    }`,
  },
  {
    name: "Branch C (Forced Reduction) - Truncated declaration at EOF",
    code: `scope {
      let x =`,
  },
  {
    name: "Island Mode - Gibberish inside block",
    code: `scope {
      let x = 10;
      $$$$$;
      print y;
    }`,
  },
  {
    name: "User Report - 'le' with only Branch C",
    code: `scope {
      let velocity = 100;
      let mass = 50;
      le
      print velocity;
    }`,
  },
  {
    name: "User Report - 'let x  1;' with only Branch B",
    code: `scope {
      let velocity = 100;
      let mass = 50;
      let x  1;
      print velocity;
    }`,
  },
];

describe("GLR Parser Error Recovery Branches", () => {
  let facade: any;
  let tmpDir: string;
  let wasmModule: WebAssembly.Module;

  beforeAll(async () => {
    const result = buildParser(dsl as any);

    tmpDir = path.join("/tmp", "modelscript-recovery-test");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.join(__dirname, "../../../node_modules/.bin/asc");
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
        abort: () => {},
        logNode: () => {},
        debugLog: () => {},
      },
      JavaScript: {
        debugLog: () => {},
        logNode: () => {},
      },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    facade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  const configs = [
    { name: "Only Branch A (Deletion)", a: true, b: false, c: false, island: false },
    { name: "Only Branch B (Insertion)", a: false, b: true, c: false, island: false },
    { name: "Only Branch C (Forced Reduction)", a: false, b: false, c: true, island: false },
    { name: "Only Island Mode", a: false, b: false, c: false, island: true },
    { name: "All Enabled (Default)", a: true, b: true, c: true, island: true },
  ];

  for (const testCase of testCases) {
    describe(`Test Case: ${testCase.name}`, () => {
      for (const config of configs) {
        it(`should run with config: ${config.name}`, () => {
          facade.setParserConfig(config.a, config.b, config.c, config.island);

          expect(() => {
            const astRoot = facade.parse(testCase.code);

            // Ensure parser didn't fail completely
            expect(astRoot).not.toBe(0);

            const diags = facade.getDiagnostics(astRoot);
            const sexpr = facade.getAstSExpr(astRoot);

            // Sexpr should be available
            expect(sexpr).toBeTruthy();

            // Depending on the configuration, it may or may not produce diagnostics
            // We just assert it doesn't crash here.
            // We could add more assertions based on specific expectations.
          }).not.toThrow();
        });
      }
    });
  }
  describe("Regression Tests", () => {
    it("should anchor the missing semicolon diagnostic to the previous token instead of the next line", () => {
      facade.setParserConfig(false, false, true, false); // Only Branch C
      const code = "scope {\n  let velocity = 100;\n  let mass = 50;\n  let x = 1\n  print velocity;\n}";
      const astRoot = facade.parse(code);
      const diags = facade.getDiagnostics(astRoot);
      // There should be a diagnostic for the missing semicolon after '1'
      expect(diags.length).toBeGreaterThan(0);

      const missingSemi = diags[0];

      // Check line and column of the diagnostic (0-indexed)
      // The '1' is on line 3, column 10 to 11.
      // The diagnostic should be anchored near it, so on line 3 (not line 4).
      const startPos = missingSemi.range.start;

      // Check that it's NOT on line 4 (where the 'p' of print is)
      expect(startPos.line).not.toBe(4);
    });
  });
});
