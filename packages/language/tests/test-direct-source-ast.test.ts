import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { extractLanguageAST } from "../src/codegen/ast-loader.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Direct Source AST Extraction & Typed Lambda Transpilation", () => {
  const tmpDir = path.join(__dirname, "scratch_build_direct_source_ast");

  beforeAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should extract AST nodes directly from TypeScript source text", () => {
    const sampleTs = `
      import { language, seq, field } from "@modelscript/language";

      export class ScopeTracker {
        depth: u32;
        init(): void { this.depth = 0; }
      }

      export default language({
        name: "SampleLang",
        classes: [ScopeTracker],
        rules: {
          Program: ($) => $.Decl,
          Decl: ($) => seq("var", field("name", $.Identifier), ";"),
          Identifier: ($) => /[a-zA-Z_]+/,
        },
        lints: {
          checkIdent: {
            nodes: ["Decl"],
            severity: "error",
            code: 3001,
            message: "Invalid identifier",
            query: (db, node, $) => {
              let nameNode: u32 = db.ast.getChildByFieldId(node, "name");
              if (nameNode !== 0) {
                db.diagnostic(nameNode);
              }
            }
          }
        }
      });
    `;

    const ast = extractLanguageAST(sampleTs);
    expect(ast).not.toBeNull();
    expect(ast?.lints.has("checkIdent")).toBe(true);
    expect(ast?.classes.has("ScopeTracker")).toBe(true);
  });

  it("should compile language with typed lambdas to AssemblyScript and execute in WASM", async () => {
    const testGrammarSource = `
      import { language, seq, field, repeat, semanticToken } from "../src/dsl.js";

      export class NodeCounter {
        count: u32;
        init(): void { this.count = 0; }
        increment(): void { this.count++; }
      }

      export const TypedDsl = language({
        name: "TypedDsl",
        sourcePath: __filename,
        classes: [NodeCounter],
        rules: {
          Program: ($: any) => repeat($.Decl),
          Decl: ($: any) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
          Type: ($: any) => "Real",
          Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
        },
        extras: ($: any) => [/\\s/],
        lints: {
          uninitCheck: {
            nodes: ["Decl"],
            severity: "warning",
            code: 2001,
            message: "Uninitialized variable",
            query: (db, node, $) => {
              let nameNode: u32 = db.ast.getChildByFieldId(node, "name");
              if (nameNode !== 0 && db.ast.getByteLength(nameNode) > 0) {
                db.diagnostic(nameNode);
              }
            },
          },
        },
      });
    `;

    const grammarObj = language({
      name: "TypedDsl",
      sourceText: testGrammarSource,
      rules: {
        Program: ($: any) => repeat($.Decl),
        Decl: ($: any) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
        Type: ($: any) => "Real",
        Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
      },
      extras: ($: any) => [/\s/],
      lints: {
        uninitCheck: {
          nodes: ["Decl"],
          severity: "warning",
          code: 2001,
          message: "Uninitialized variable",
          query: (db: any, node: any, $: any) => {
            const nameNode = db.ast.getChildByFieldId(node, "name");
            if (nameNode !== 0 && db.ast.getByteLength(nameNode) > 0) {
              db.diagnostic(nameNode);
            }
          },
        },
      },
    });

    const result = buildParser(grammarObj);
    const graphFile = result.assemblyScriptFiles.find((f) => f.filename === "graph.ts");
    expect(graphFile).toBeDefined();
    expect(graphFile?.content).toContain("export function lint_uninitCheck");
    expect(graphFile?.content).toContain("lsp_allocDiagnostic");

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (e: any) {
      fs.writeFileSync(path.join(__dirname, "asc_error.log"), e.stderr.toString() + "\n" + e.stdout.toString());
      throw e;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    const facade = new LspFacade(instance.exports.memory, instance.exports);

    const code = `Real x;`;
    const ast = facade.parse(code);
    const diags = facade.getDiagnostics(ast);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].code).toBe(2001);
    expect(diags[0].message).toContain("Uninitialized variable");
  }, 120000);
});
