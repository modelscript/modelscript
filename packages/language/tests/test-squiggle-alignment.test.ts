import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { field, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toyGrammar = {
  name: "SquiggleAlignTestDSL",
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

describe("Squiggle Range Alignment & Line Clamping Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(toyGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_squiggle_align");
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
    // if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should calculate exact range on line 2 for indented component 'heatFlow' without bleeding to line 1", () => {
    const code = `Real temp;\n  Real heatFlow;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("SQUIGGLE TEST ALL DIAGS:", JSON.stringify(diags, null, 2));

    expect(diags.length).toBe(2);

    const heatFlowDiag = diags.find((d: any) => d.range.start.line === 1);
    expect(heatFlowDiag).toBeDefined();

    // Line 1: '  Real heatFlow;'
    // '  Real ' is 7 characters (index 0..6), 'heatFlow' starts at index 7 and ends at index 15
    expect(heatFlowDiag.range.start.character).toBe(7);
    expect(heatFlowDiag.range.end.character).toBe(15);
  });
});
