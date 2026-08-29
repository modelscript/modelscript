import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toyGrammar = {
  name: "AstTraversalTestDSL",
  rules: {
    Program: ($: any) => repeat($.Decl),
    Decl: ($: any) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
    Type: ($: any) => "Real",
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s/],
  lints: {
    uninit: {
      nodes: ["Decl"],
      severity: "warning",
      message: "Uninitialized component",
      query: `(db, node, $) => {
        let nameNode = db.ast.getChildByFieldId(node, 'name');
        if (nameNode != 0) {
          db.diagnostic(nameNode);
        }
      }`,
    },
  },
};

describe("AST Traversal & Field Resolution Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(toyGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_ast_traversal");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }
    const graphFile = result.assemblyScriptFiles.find((f: any) => f.filename === "graph.ts");
    if (graphFile) console.log("GENERATED GRAPH.TS:\n" + graphFile.content);

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
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should extract diagnostics targeting child name identifier node and compute exact range", () => {
    const code = `  Real power;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    const diag = diags.find((d: any) => d.code === 2000) || diags[0];

    // Range should target 'power' (character index 7 to 12)
    expect(diag.range.start.character).toBe(7);
    expect(diag.range.end.character).toBe(12);
  });

  it("should accurately position child field diagnostics across multi-line declarations with irregular indentation", () => {
    const code = `  Real voltage;
      Real current;

    Real resistance;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(diags.length).toBe(3);

    // Line 0: "  Real voltage;" -> 'voltage' is at chars 7..14
    const d0 = diags.find((d: any) => d.range.start.line === 0);
    expect(d0).toBeDefined();
    expect(d0.range.start.character).toBe(7);
    expect(d0.range.end.character).toBe(14);

    // Line 1: "      Real current;" -> 'current' is at chars 11..18
    const d1 = diags.find((d: any) => d.range.start.line === 1);
    expect(d1).toBeDefined();
    expect(d1.range.start.character).toBe(11);
    expect(d1.range.end.character).toBe(18);

    // Line 3: "    Real resistance;" -> 'resistance' is at chars 9..19
    const d3 = diags.find((d: any) => d.range.start.line === 3);
    expect(d3).toBeDefined();
    expect(d3.range.start.character).toBe(9);
    expect(d3.range.end.character).toBe(19);
  });
});
