import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, optional, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelicaLikeDsl = language({
  name: "ModelicaLikeRecoveryLang",
  word: ($: any) => $.Identifier,
  rules: {
    StoredDefinition: ($: any) =>
      seq(optional(field("withinDirective", $.WithinDirective)), repeat(field("classDefinition", $.ClassDefinition))),
    WithinDirective: ($: any) =>
      seq(semanticToken("keyword", "within"), optional(field("packageName", $.Identifier)), ";"),
    ClassDefinition: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s+/],
});

describe("Split Keyword Error Recovery Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_split_kw");
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

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should recover 'mo del x end x;' into a ClassDefinition ('model') instead of a WithinDirective", () => {
    const code = "mo del x end x;";
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const tree = activeFacade.getAstSExpr(ast, true);

    // Ensure it was parsed as a ClassDefinition / model
    expect(tree).toContain("ClassDefinition");
    expect(tree).toContain('"model"');

    const diags = activeFacade.getDiagnostics(ast);
    expect(diags.length).toBeGreaterThan(0);
  });
});
