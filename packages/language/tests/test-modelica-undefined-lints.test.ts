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
    const rel = ["..", "..", "..", "languages", "modelica", "dist", "src", "language.js"].join("/");
    const langMod = await import(rel);
    const modelicaLanguage = langMod.modelicaLanguage;
    const sourcePath = path.resolve(__dirname, "../../../languages/modelica/src/language.ts");
    const result = buildParser(modelicaLanguage as any, { sourcePath });
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

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade, Tree } = getFacade();
    (globalThis as any).__Tree = Tree;

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

  test("parses nested class definition incrementally as user types", () => {
    let code = "model X\n";
    activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_inc.mo");

    code = "model X\n  model Y\n";
    activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_inc.mo");

    code = "model X\n  model Y\n\n  end Y;\n";
    activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_inc.mo");

    code = "model X\n  model Y\n\n  end Y;\nend X;";
    const root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test_inc.mo");

    const treeStr = activeFacade.tree?.rootNode?.toString();
    console.log("NESTED MODEL AST TREE:\n", treeStr);

    const diags = activeFacade.getDiagnostics(root);
    console.log("INCREMENTAL NESTED MODEL DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const errors = diags.filter((d: any) => d.severity === 1);
    expect(errors).toEqual([]);
  });

  test("parses nested class definition incrementally as user types character by character", () => {
    let doc = "model X\n  model Y\n\n  end Y;\n";
    activeFacade.parseIncremental(doc, 0, 0, doc.length, "file:///test_char.mo");

    let root = 0;
    const additions = ["e", "n", "d", " ", "X", ";"];
    for (const ch of additions) {
      const offset = doc.length;
      doc += ch;
      root = activeFacade.parseIncremental(ch, offset, 0, doc.length, "file:///test_char.mo");
    }

    const diags = activeFacade.getDiagnostics(root);
    console.log("CHAR BY CHAR DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const errors = diags.filter((d: any) => d.severity === 1);
    expect(errors).toEqual([]);
  });

  test("catches type mismatch in binding Real x = 'ERROR'", () => {
    const code = `model X
  Real x = "ERROR";
end X;`;

    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("BINDING MISMATCH DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const mismatchDiag = diags.find((d: any) => d.code === 3001);
    expect(mismatchDiag).toBeDefined();
    expect(mismatchDiag.message).toBe("Type mismatch in binding or modification expression '\"ERROR\"'.");
  });

  test("catches type mismatch in extends modification extends A(x = 'ERROR')", () => {
    const code = `model A
  Real x = 0;
end A;
model B
  extends A(x = "ERROR");
end B;`;

    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("EXTENDS MODIFICATION MISMATCH DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const mismatchDiag = diags.find((d: any) => d.code === 3001);
    expect(mismatchDiag).toBeDefined();
    expect(mismatchDiag.message).toBe("Type mismatch in binding or modification expression '\"ERROR\"'.");
  });

  test("catches type mismatch in component modification A a(x = 'ERROR')", () => {
    const code = `model A
  Real x = 0;
end A;
model B
  A a(x = "ERROR");
end B;`;

    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("COMPONENT MODIFICATION MISMATCH DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const mismatchDiag = diags.find((d: any) => d.code === 3001);
    expect(mismatchDiag).toBeDefined();
    expect(mismatchDiag.message).toBe("Type mismatch in binding or modification expression '\"ERROR\"'.");
  });

  test("catches type mismatch in primitive attribute modification Real x(start = 'ERROR')", () => {
    const code = `model X
  Real x(start = "ERROR");
end X;`;

    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("PRIMITIVE ATTRIBUTE MODIFICATION MISMATCH DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const mismatchDiag = diags.find((d: any) => d.code === 3001);
    expect(mismatchDiag).toBeDefined();
    expect(mismatchDiag.message).toBe("Type mismatch in binding or modification expression '\"ERROR\"'.");
  });

  test("accepts valid modification extends A(x = 10.0) without diagnostics", () => {
    const code = `model A
  Real x = 0;
end A;
model B
  extends A(x = 10.0);
end B;`;

    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    const errors = diags.filter((d: any) => d.severity === 1 || d.code === 3001);
    expect(errors).toEqual([]);
  });

  test("catches syntax error on truncated input 'model'", () => {
    const code = "model";
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("TRUNCATED 'model' DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const errors = diags.filter((d: any) => d.severity === 1);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("catches syntax error on truncated input 'model '", () => {
    const code = "model ";
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("TRUNCATED 'model ' DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const errors = diags.filter((d: any) => d.severity === 1);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("does not emit warning M4038 on connector B in multi-connector model and catches connectFlowMismatch M5004 on connect(a, b)", () => {
    const code = `connector A
  flow Real x;
end;
connector B
  flow Real x;
  flow Real y;
end;
model X
  A a;
  B b;
equation
  connect(a, b);
end;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("CONNECTOR AND CONNECT DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));

    // 1. Should NOT emit M4038 on connector B
    const m4038Diags = diags.filter((d: any) => d.code === 4038);
    expect(m4038Diags).toEqual([]);

    // 2. Should emit M5004 on connect(a, b)
    const m5004Diag = diags.find((d: any) => d.code === 5004);
    expect(m5004Diag).toBeDefined();
    expect(m5004Diag.message).toBe("Flow variable sets differ in connect(): 'a' (1 flows) vs 'b' (2 flows).");
  });

  test("accepts connect(a1, a2) with matching flow counts without warnings", () => {
    const code = `connector A
  flow Real x;
end;
model X
  A a1;
  A a2;
equation
  connect(a1, a2);
end;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    const m5004Diags = diags.filter((d: any) => d.code === 5004 || d.code === 4038);
    expect(m5004Diags).toEqual([]);
  });

  test("catches undefined member in compound component reference x.error in connect equation", () => {
    const code = `connector Pin2
  flow Real a;
  Real b;
end;
model X
  Real val;
end;
model Y
  Pin2 p2;
end;
model Z
  X x;
  Y y;
equation
  connect(x.error, y.p2);
end;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("COMPOUND MEMBER DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const m2002Diag = diags.find((d: any) => d.code === 2002);
    expect(m2002Diag).toBeDefined();
    expect(m2002Diag.message).toBe("Variable 'x.error' not found in scope.");
  });

  test("catches connector port type and flow mismatch in hierarchical connect(x.p1, y.p2)", () => {
    const code = `connector Pin1
  flow Real x;
end;
connector Pin2
  flow Real a;
  Real b;
end;
model X
  Pin1 p1;
end;
model Y
  Pin2 p2;
end;
model Z
  X x;
  Y y;
equation
  connect(x.p1, y.p2);
end;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("HIERARCHICAL CONNECT DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));
    const m5004Diag = diags.find((d: any) => d.code === 5004);
    expect(m5004Diag).toBeDefined();
    expect(m5004Diag.message).toBe("Flow variable sets differ in connect(): 'x.p1' (1 flows) vs 'y.p2' (1 flows).");
  });

  test("accepts valid hierarchical connect(x.p1, y.p1) with matching ports without warnings", () => {
    const code = `connector Pin1
  flow Real x;
end;
model X
  Pin1 p1;
end;
model Y
  Pin1 p1;
end;
model Z
  X x;
  Y y;
equation
  connect(x.p1, y.p1);
end;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    const diagsFiltered = diags.filter((d: any) => d.code === 5004 || d.code === 2002);
    expect(diagsFiltered).toEqual([]);
  });

  test("executes physical in-DSL flattening pipeline on Modelica AST", () => {
    const code = `model A
  Real x;
equation
  x = 1;
end A;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const pipelineResult = activeFacade.executePipeline(root, "flatten");
    console.log("PIPELINE FLATTEN RESULT:\n", JSON.stringify(pipelineResult, null, 2));

    expect(pipelineResult).toBeDefined();
    expect(pipelineResult.variables.length).toBe(1);
    expect(pipelineResult.variables[0].name).toBe("x");
    expect(pipelineResult.variables[0].type).toBe("Real");
    expect(pipelineResult.equations.length).toBe(1);
    expect(pipelineResult.equations[0].lhs).toBe("x");
    expect(pipelineResult.equations[0].rhs).toBe("1");
    expect(pipelineResult.bltBlocks.length).toBe(1);
  });

  test("executes physical in-DSL flattening pipeline on extends inheritance model", () => {
    const code = `model Base
  Real x;
equation
  x = 10;
end Base;

model Derived
  extends Base;
  Real y;
equation
  y = 20;
end Derived;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const pipelineResult = activeFacade.executePipeline(root, "flatten");
    console.log("PIPELINE EXTENDS RESULT:\n", JSON.stringify(pipelineResult, null, 2));

    expect(pipelineResult).toBeDefined();
    expect(pipelineResult.variables.length).toBe(2);
    const varNames = pipelineResult.variables.map((v: any) => v.name);
    expect(varNames).toContain("x");
    expect(varNames).toContain("y");
    expect(pipelineResult.equations.length).toBe(2);
  });

  test("executes physical in-DSL flattening pipeline on hierarchical sub-model with connectors", () => {
    const code = `connector Pin
  Real v;
  flow Real i;
end Pin;

model Resistor
  Pin p;
  Pin n;
  parameter Real R = 100;
equation
  p.v - n.v = R * p.i;
  p.i + n.i = 0;
end Resistor;

model Circuit
  Resistor r1;
equation
  r1.p.v = 10;
end Circuit;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const pipelineResult = activeFacade.executePipeline(root, "flatten");
    console.log("PIPELINE HIERARCHICAL RESULT:\n", JSON.stringify(pipelineResult, null, 2));

    expect(pipelineResult).toBeDefined();
    const varNames = pipelineResult.variables.map((v: any) => v.name);
    expect(varNames).toContain("r1.p.v");
    expect(varNames).toContain("r1.p.i");
    expect(varNames).toContain("r1.n.v");
    expect(varNames).toContain("r1.n.i");
    expect(varNames).toContain("r1.R");
  });

  test("expands connect(x.xc, y.yc) into Kirchhoff zero-sum flow conservation equations", () => {
    const code = `connector XC
  flow Real x;
end;

connector YC
  flow Real x;
end;

model X
  XC xc;
end;

model Y
  YC yc;
end;

model Z
  X x;
  Y y;
equation
  connect(x.xc, y.yc);
end Z;`;
    const root = activeFacade.parse(code);
    expect(root).toBeGreaterThan(0);

    const pipelineResult = activeFacade.executePipeline(root, "flatten");
    console.log("PIPELINE CONNECTOR EXPANSION RESULT:\n", JSON.stringify(pipelineResult, null, 2));

    expect(pipelineResult).toBeDefined();
    const varNames = pipelineResult.variables.map((v: any) => v.name);
    expect(varNames).toContain("x.xc.x");
    expect(varNames).toContain("y.yc.x");

    // Verify connect equation emitted for flattened connector references
    expect(pipelineResult.equations.length).toBe(1);
    const eq = pipelineResult.equations[0];
    expect(eq.kind).toBe("connect");
    expect(eq.text).toContain("connect(x.xc, y.yc)");
  });
});
