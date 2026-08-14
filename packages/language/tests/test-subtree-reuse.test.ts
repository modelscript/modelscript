import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toyGrammar = {
  name: "ReuseTestDSL",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq("model", field("name", $.Identifier), repeat($.Decl), "end", field("endName", $.Identifier), ";"),
    Decl: ($: any) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
    Type: ($: any) => "Real",
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s/],
};

describe("Incremental Subtree Reuse Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(toyGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_subtree_reuse");
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
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should successfully parse initial tree and produce valid AST root", () => {
    const codeV1 = `model x Real x; end x;`;
    const astV1 = activeFacade.parse(codeV1);
    expect(astV1).toBeGreaterThan(0);

    const sexprV1 = activeFacade.getAstSExpr(astV1);
    expect(sexprV1).toContain("ModelDef");
  });

  it("should incrementally parse modified text and retain AST structural validity", () => {
    const codeV1 = `model x Real x; end x;`;
    const astV1 = activeFacade.parse(codeV1);

    const codeV2 = `model x Real x; Real y; end x;`;
    activeFacade.lastAstRoot = astV1;
    const astV2 = activeFacade.parse(codeV2);
    expect(astV2).toBeGreaterThan(0);

    const sexprV2 = activeFacade.getAstSExpr(astV2);
    expect(sexprV2).toContain("ModelDef");
  });
});
