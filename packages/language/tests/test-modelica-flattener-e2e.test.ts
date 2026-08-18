import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { buildParser } from "../src/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica In-DSL Physical Flattening E2E Tests", () => {
  const tmpDir = path.join(__dirname, "scratch_build_modelica_e2e");
  let facade: any;
  let wasmExports: any;

  beforeAll(async () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const modelicaLangPath = path.resolve(__dirname, "../../../languages/modelica/dist/src/language.js");
    const mod = await import(pathToFileURL(modelicaLangPath).href);
    const modelicaLanguage = mod.modelicaLanguage;
    const result = buildParser(modelicaLanguage as any);
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: "inherit", maxBuffer: 50 * 1024 * 1024 });
    } catch (e: any) {
      console.error("ASC ERROR:", e);
      throw e;
    }

    const wasmBuffer = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasmBuffer);

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: (msg: any, file: any, line: any, col: any) => {
          console.error(`WASM abort: ${msg} at ${file}:${line}:${col}`);
        },
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
      parser: {
        logInt: () => {},
      },
      recovery: {},
      host: {
        runHostQuery: () => {},
      },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;

    const wrapperModuleFactory = new Function(
      result.javascriptWrapper.js.replace(/export /g, "") + "\nreturn { LspFacade };",
    );
    const { LspFacade } = wrapperModuleFactory();
    facade = new LspFacade(instance.exports.memory, instance.exports);
  }, 180000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should parse Modelica class definition and build AST in WASM linear memory", () => {
    const modelicaSrc = `
      model Resistor
        Pin p, n;
        parameter Real R = 100.0;
        Real v, i;
      equation
        v = p.v - n.v;
        0 = p.i + n.i;
        i = p.i;
        v = R * i;
      end Resistor;
    `;

    facade.lastAstRoot = 0;
    const rootNode = facade.parse(modelicaSrc);
    console.log("PARSED ROOT NODE:", rootNode);
    expect(rootNode).toBeGreaterThan(0);
  });

  test("should execute In-DSL Modelica flattening pipeline on electrical circuit", () => {
    const circuitSrc = `
      model Circuit
        Resistor r1(R = 50.0);
        Capacitor c1(C = 1e-6);
      equation
        connect(r1.n, c1.p);
      end Circuit;
    `;

    facade.lastAstRoot = 0;
    const rootNode = facade.parse(circuitSrc);
    console.log("PARSED CIRCUIT ROOT NODE:", rootNode);
    expect(rootNode).toBeGreaterThan(0);

    const pipelineResult = facade.runPipeline("flatten", rootNode);
    console.log("PIPELINE FLATTEN RESULT:", pipelineResult);
    expect(typeof pipelineResult).toBe("number");
  });
});
