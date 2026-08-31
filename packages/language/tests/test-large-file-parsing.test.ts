import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { field, language, optional, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelicaLikeDsl = language({
  name: "ModelicaLikeLargeLang",
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
        repeat(field("element", $.Element)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Element: ($: any) => seq(field("type", $.Identifier), field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s+/],
});

describe("Large File Parsing & Fat Padding Scalability Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_large_file");
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

    const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048, shared: true });

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
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("successfully parses a 3,500 line model with >3,000 elements without crash or LR degradation", () => {
    const lines: string[] = ["within MyPackage;\n", "model LargeModel\n"];

    // Generate 3,500 element declarations
    for (let i = 0; i < 3500; i++) {
      // Inject fat padding (>1200 spaces) periodically
      if (i % 500 === 0) {
        lines.push(" ".repeat(1500) + `Real var_${i};\n`);
      } else {
        lines.push(`  Real var_${i};\n`);
      }
    }
    lines.push("end LargeModel;\n");

    const source = lines.join("");
    const startTime = Date.now();
    const astRoot = activeFacade.parse(source);
    const parseDuration = Date.now() - startTime;

    expect(astRoot).toBeGreaterThan(0);
    expect(parseDuration).toBeLessThan(3000); // Should be fast in O(N) LR mode

    const diags = activeFacade.getDiagnostics(astRoot);
    expect(diags).toHaveLength(0);

    const tokens = activeFacade.getSemanticTokens(astRoot);
    expect(tokens.length).toBeGreaterThan(10000);
  });
});
