import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Undefined Type & Variable Lint Diagnostics", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const rel = ["..", "..", "..", "languages", "modelica", "src", "language.js"].join("/");
    const langMod = await import(rel);
    const modelicaLanguage = langMod.modelicaLanguage;
    const result = buildParser(modelicaLanguage as any);
    tmpDir = path.join(__dirname, "scratch_build_modelica_undefined_lints");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");
    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;

    try {
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (e: any) {
      if (e.stderr) fs.writeFileSync("/tmp/asc_error.log", e.stderr.toString());
      throw e;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
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
    activeFacade.syntaxNames = result.syntaxNames;
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("catches undefined type ERROR and undefined variable undefined", () => {
    const code = `model X
  ERROR y;
equation
  undefined = y;
end X;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));

    // 1. Check undefined type "ERROR" (M2003)
    const typeDiag = diags.find((d: any) => d.code === 2003);
    expect(typeDiag).toBeDefined();
    expect(typeDiag.message).toBe("Class or type 'ERROR' not found in scope.");
    expect(typeDiag.range.start.line).toBe(1);

    // 2. Check undefined variable "undefined" (M2002)
    const varDiag = diags.find((d: any) => d.code === 2002);
    expect(varDiag).toBeDefined();
    expect(varDiag.message).toBe("Variable 'undefined' not found in scope.");
    expect(varDiag.range.start.line).toBe(3);
  });

  test("produces 0 diagnostics for valid model with declared variables and primitive types", () => {
    const code = `model X
  Real y;
  Real z;
equation
  y = 1;
  z = y;
end X;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_valid.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    expect(diags).toEqual([]);
  });

  test("runs diagnostics on playground initial ElectricalCircuit code", () => {
    const code = `model ElectricalCircuit
  Pin p, n;
  parameter Real R = 100.0;
  parameter Real L = 0.001;
  Real v, i;
equation
  v = p.v - n.v;
  0 = p.i + n.i;
  i = p.i;
  v = R * i;
end ElectricalCircuit;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_circuit.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("CIRCUIT DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
  });
});
