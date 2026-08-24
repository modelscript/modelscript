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

  test("resolves variables inherited from base model via extends without diagnostics", () => {
    const code = `model A
  Real x;
end A;

model B
  extends A;
  Real y = x;
end B;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_extends.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("EXTENDS DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const varDiags = diags.filter((d: any) => d.code === 2002);
    expect(varDiags).toEqual([]);
  });

  test("flags unknown variable in model that extends base model", () => {
    const code = `model A
  Real x;
end A;

model B
  extends A;
  Real y = unknownVar;
end B;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_extends_unknown.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    const varDiag = diags.find((d: any) => d.code === 2002);
    expect(varDiag).toBeDefined();
    expect(varDiag.message).toBe("Variable 'unknownVar' not found in scope.");
  });

  test("catches invalid attribute 'error' on Real x(error=7)", () => {
    const code = `model A
  Real x(error=7);
end A;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_invalid_attr.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("INVALID ATTR DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const attrDiag = diags.find((d: any) => d.code === 4045);
    expect(attrDiag).toBeDefined();
    expect(attrDiag.message).toBe("Modified element 'error' not found in class 'Real'.");
  });

  test("accepts valid attribute 'start' on Real x(start=7)", () => {
    const code = `model A
  Real x(start=7);
end A;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_attr_valid.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    const attrDiags = diags.filter((d: any) => d.code === 4045);
    expect(attrDiags).toEqual([]);
  });

  test("runs WeatherStation replaceable sensor model", () => {
    const code = `model WeatherStation
  // The sensor is marked replaceable and defaults to IdealSensor
  replaceable BaseSensor sensor = IdealSensor;
  Real data;
equation
  data = sensor.measurement;
end WeatherStation;

partial model BaseSensor
  Real measurement;
equation
  // Base class has no specific equations
end BaseSensor;

model IdealSensor
  extends BaseSensor;
equation
  measurement = time; // Simple ideal behavior
end IdealSensor;

model NoisySensor
  extends BaseSensor;
  parameter Real noise = 0.1;
equation
  measurement = time + noise; // Behavior with added noise
end NoisySensor;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_weather.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("WEATHER STATION DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));

    const varDiags = diags.filter((d: any) => d.code === 2002);
    expect(varDiags).toEqual([]);
  });

  test("parses Simulation model with redeclare NoisySensor without syntax errors", () => {
    const code = `model WeatherStation
  replaceable BaseSensor sensor = IdealSensor;
  Real data;
equation
  data = sensor.measurement;
end WeatherStation;

partial model BaseSensor
  Real measurement;
end BaseSensor;

model IdealSensor
  extends BaseSensor;
equation
  measurement = time;
end IdealSensor;

model NoisySensor
  extends BaseSensor;
  parameter Real noise = 0.1;
equation
  measurement = time + noise;
end NoisySensor;

model Simulation
  // Station A uses the default IdealSensor
  WeatherStation stationA;

  // Station B redeclares the sensor to use NoisySensor instead
  WeatherStation stationB(redeclare NoisySensor sensor(noise=0.5));
end Simulation;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_simulation.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("SIMULATION DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const syntaxErrors = diags.filter((d: any) => d.severity === 1 && (!d.code || d.code < 1000));
    expect(syntaxErrors).toEqual([]);
  });
});
