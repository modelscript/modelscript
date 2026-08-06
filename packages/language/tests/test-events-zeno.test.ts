import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hybridEventsDsl = language({
  name: "EventZenoTestLang",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
});

describe("Direction-Aware Events & Zeno Limit Protection", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(hybridEventsDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_events_zeno");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const filePath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory: memory, abort: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 60000);

  it("should filter zero-crossing events based on requested direction (rising vs falling)", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const detectorPtr = wasmExports.event_createDetector(daePtr);
    expect(detectorPtr).toBeGreaterThan(0);

    // Add state variable 0
    wasmExports.dae_addVariable(daePtr, 1, 0, 0, 0, 1.0);

    // Register a ZCF expression (e.g. var 0)
    const varExpr = wasmExports.dae_addExpression(daePtr, 0, 0, 0, 0); // Name expr for var 0

    // Register rising-only ZCF (targetDirection = 1)
    const zcfIdx = wasmExports.event_addZcf(detectorPtr, varExpr, -1.0, 1);
    expect(zcfIdx).toBe(0);

    const varValuesPtr = wasmExports.atomicChunkAlloc(8);
    const varMem = new Float64Array(wasmExports.memory.buffer, varValuesPtr, 1);

    // Initial state: -1.0 (sign 0)
    varMem[0] = -1.0;
    wasmExports.event_updateZcfSigns(detectorPtr, varValuesPtr);

    // Transition to 1.0 (rising transition neg -> pos)
    varMem[0] = 1.0;
    const triggeredRising = wasmExports.event_checkZeroCrossings(detectorPtr, varValuesPtr);
    expect(triggeredRising).toBe(0); // Triggered!

    // Update signs to 1.0 (sign 1)
    wasmExports.event_updateZcfSigns(detectorPtr, varValuesPtr);

    // Transition to -1.0 (falling transition pos -> neg)
    varMem[0] = -1.0;
    const triggeredFalling = wasmExports.event_checkZeroCrossings(detectorPtr, varValuesPtr);
    expect(triggeredFalling).toBe(-1); // Ignored because targetDirection is 1 (rising only)!
  });

  it("should trigger Zeno protection limit when event frequency threshold is exceeded", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const detectorPtr = wasmExports.event_createDetector(daePtr);

    let t = 1.0;
    let isZeno = false;
    // Simulate 12 rapid events occurring within dt = 1e-7 (< 1e-6)
    for (let i = 0; i < 12; i++) {
      t += 1e-7;
      isZeno = Boolean(wasmExports.event_checkZenoLimit(detectorPtr, t, 10, 1e-6));
    }

    expect(isZeno).toBe(true);
  });
});
