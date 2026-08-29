import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "TrigramTestLang",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat($.Decl),
        semanticToken("keyword", "end"),
        ";",
      ),
    Decl: ($: any) => seq("Real", field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  symbols: {
    ModelDef: { name: "name", kind: "model", scope: true },
    Decl: { name: "name", kind: "Variable", scope: false },
  },
  extras: ($: any) => [/\s+/],
});

describe("Gap 2: Dex-Style Trigram Fuzzy Search Tests", () => {
  let facade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_trigram");
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
    const getFacadeFn = new Function(wrapperSrc);

    const memory = new WebAssembly.Memory({ initial: 256, maximum: 1024 });
    const imports = {
      env: {
        memory,
        abort: (msg: any, file: any, line: any, col: any) => {
          console.error(`WASM ABORT: msg=${msg}, file=${file}, line=${line}, col=${col}`);
        },
      },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: (val: number) => process.stderr.write("WASM_LOG: " + val + "\n") },
      recovery: {},
      host: { runHostQuery: () => {} },
    };
    const instance = await WebAssembly.instantiate(wasmModule, imports);
    const { LspFacade } = getFacadeFn();
    facade = new LspFacade(instance.exports.memory || memory, instance.exports);
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should index symbols into trigram inverted map and rank fuzzy search queries", () => {
    facade.clearStubs();

    // Register distinct symbols
    facade.registerStub(1, 1, 0, 1, 0, "MotorSpeedController", 0, 100);
    facade.registerStub(2, 2, 0, 1, 0, "ThermalFluidPump", 0, 100);
    facade.registerStub(3, 3, 0, 1, 0, "ResistorModel", 0, 100);
    facade.registerStub(4, 4, 0, 1, 0, "MotorDriverUnit", 0, 100);

    // Index all stubs into trigrams
    const indexed = facade.indexTrigrams();
    console.log("INDEXED_COUNT:", indexed);
    expect(indexed).toBeGreaterThanOrEqual(3);

    // Query 'Motor'
    const motorResults = facade.fuzzyFindSymbols("Motor");
    console.log("MOTOR_RESULTS:", JSON.stringify(motorResults));
    expect(motorResults.length).toBeGreaterThanOrEqual(2);
    expect(motorResults[0].score).toBeGreaterThan(0);

    // Query 'Pump'
    const pumpResults = facade.fuzzyFindSymbols("Pump");
    expect(pumpResults.length).toBeGreaterThanOrEqual(1);

    // Query 'Resistor'
    const resistorResults = facade.fuzzyFindSymbols("Resistor");
    expect(resistorResults.length).toBeGreaterThanOrEqual(1);

    // Case-insensitivity check
    const lowerResults = facade.fuzzyFindSymbols("motor");
    const upperResults = facade.fuzzyFindSymbols("MOTOR");
    expect(lowerResults.length).toBe(motorResults.length);
    expect(upperResults.length).toBe(motorResults.length);

    // Short prefix queries (< 3 characters)
    const shortPrefixResults = facade.fuzzyFindSymbols("M");
    expect(shortPrefixResults.length).toBeGreaterThanOrEqual(2);

    // Exact match score boosting
    const exactResults = facade.fuzzyFindSymbols("ResistorModel");
    expect(exactResults.length).toBeGreaterThanOrEqual(1);
    expect(exactResults[0].score).toBeGreaterThanOrEqual(1500); // 1000 exact + 500 prefix + trigram points
  });
});
