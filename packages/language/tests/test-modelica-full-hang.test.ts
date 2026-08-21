import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Full Modelica Grammar Hang Reproduction", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const target = path.join(__dirname, "..", "..", "..", "languages", "modelica", "src", "language.js");
    const mod = await import("file://" + target);
    const modelicaLanguage = mod.modelicaLanguage;
    const result = buildParser(modelicaLanguage as any);
    tmpDir = path.join(__dirname, "scratch_build_full_modelica_hang");
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
    childProcess.execSync(ascCmd, { stdio: "pipe" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: (msg: any) => console.log("ABORT!", msg),
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
      parser: { logInt: (x: any) => console.log("WASM logInt:", x) },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
    activeFacade.syntaxNames = result.syntaxNames;
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  });

  it("should incrementally parse mo del -> model -> model ElectricalCircuit ERROR", () => {
    let currentCode = `model ElectricalCircuit
  Pin p, n;
  parameter Real R = 100.0;
  parameter Real L = 0.001;
  Real v, i;
equation
  v = p.v - n.v;
  0 = p.i + n.i;
  i = p.i;
  v = R * i;
end ElectricalCircuit;

model ChuaCircuit
  Pin p, n;
  Real vC1, vC2, iL;
  parameter Real C1 = 10.0;
  parameter Real C2 = 100.0;
  parameter Real L = 18.0;
  parameter Real G = 0.7;
equation
  C1 * der(vC1) = G * (vC2 - vC1);
  C2 * der(vC2) = G * (vC1 - vC2) + iL;
  L * der(iL) = -vC2;
end ChuaCircuit;
`;

    let prevRoot = 0;
    const diffOps: any[] = [];
    const listener = {
      onFullReset: (root: number) => diffOps.push({ op: "reset", root }),
      onNodeInserted: (ptr: number) => diffOps.push({ op: "insert", ptr }),
      onNodeDeleted: (ptr: number) => diffOps.push({ op: "delete", ptr }),
      onNodeRetained: (ptr: number) => diffOps.push({ op: "retain", ptr }),
      onNodeUpdated: (newPtr: number, oldPtr: number) => diffOps.push({ op: "update", newPtr, oldPtr }),
    };

    // 1. Initial parse
    activeFacade.lastAstRoot = 0;
    let ast = activeFacade.parseIncremental(currentCode, 0, 0, currentCode.length);
    console.log("Step 1 (Initial) astRoot:", ast, "diags:", activeFacade.getDiagnostics(ast).length);
    activeFacade.walkAstDiff(prevRoot, ast, listener);
    prevRoot = ast;

    // 2. "model" -> "mo del"
    currentCode = currentCode.slice(0, 2) + " " + currentCode.slice(2);
    ast = activeFacade.parseIncremental(" ", 2, 0, currentCode.length);
    console.log("Step 2 (mo del) astRoot:", ast, "diags:", activeFacade.getDiagnostics(ast).length);
    activeFacade.walkAstDiff(prevRoot, ast, listener);
    prevRoot = ast;

    // 3. "mo del" -> "model"
    currentCode = currentCode.slice(0, 2) + currentCode.slice(3);
    ast = activeFacade.parseIncremental("", 2, 1, currentCode.length);
    console.log("Step 3 (Repaired) astRoot:", ast, "diags:", activeFacade.getDiagnostics(ast).length);
    activeFacade.walkAstDiff(prevRoot, ast, listener);
    prevRoot = ast;

    // 4. "model ElectricalCircuit" -> "model ElectricalCircuit ERROR"
    const ecOffset = currentCode.indexOf("ElectricalCircuit") + "ElectricalCircuit".length;
    console.log("ecOffset:", ecOffset);
    currentCode = currentCode.slice(0, ecOffset) + " ERROR" + currentCode.slice(ecOffset);
    console.log("Calling parseIncremental Step 4...");
    const t0 = Date.now();
    ast = activeFacade.parseIncremental(" ERROR", ecOffset, 0, currentCode.length);
    const t1 = Date.now();
    console.log(`Step 4 (ERROR) astRoot: ${ast} in ${t1 - t0}ms, diags:`, activeFacade.getDiagnostics(ast).length);
    activeFacade.walkAstDiff(prevRoot, ast, listener);
    console.log("All steps completed successfully!");
  });
});
