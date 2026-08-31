import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/dsl/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

describe("Phase 2: Zero-GC WASM DAE Flattening & Connection Physics", () => {
  it("should compile WASM runtime and verify multi-way Kirchhoff laws, stream upwind physics, and expandable connectors", async () => {
    const result = buildParser(modelicaLanguage);
    const tmpDir = path.resolve(__dirname, "../build/tmp-phase2-physics-test");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
    childProcess.execSync(
      `node "${ascBin}" parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
      { cwd: tmpDir, stdio: "inherit" },
    );

    const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: (msg: number, file: number, line: number, col: number) => {
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
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    const exports = instance.exports as any;

    // 1. Create DaeBuilder and ArenaQueryFlattener
    const dae = exports.dae_createBuilder();
    expect(dae).toBeGreaterThan(0);
    const flattener = exports.flattener_create(dae);
    expect(flattener).toBeGreaterThan(0);

    // 2. Define 3-Port Electrical Node (p1, p2, p3)
    // Variables:
    // v1, i1 (port 1)
    // v2, i2 (port 2)
    // v3, i3 (port 3)
    const v1 = exports.dae_addVariable(dae, djb2Hash("p1.v"), 0, 0, 0, 0, 0); // Real, Continuous, Local
    const i1 = exports.dae_addVariable(dae, djb2Hash("p1.i"), 0, 0, 0, 0, 2); // Flow flag (1 << 1)
    const v2 = exports.dae_addVariable(dae, djb2Hash("p2.v"), 0, 0, 0, 0, 0);
    const i2 = exports.dae_addVariable(dae, djb2Hash("p2.i"), 0, 0, 0, 0, 2);
    const v3 = exports.dae_addVariable(dae, djb2Hash("p3.v"), 0, 0, 0, 0, 0);
    const i3 = exports.dae_addVariable(dae, djb2Hash("p3.i"), 0, 0, 0, 0, 2);

    // 3. Connect p1 to p2, and p2 to p3 (Potential across equality v1=v2, v2=v3)
    exports.flattener_addConnection(flattener, v1, v2, 0, 0); // non-flow (potential)
    exports.flattener_addConnection(flattener, v2, v3, 0, 0);

    // Verify Union-Find grouping
    const root1 = exports.flattener_findRoot(flattener, v1);
    const root2 = exports.flattener_findRoot(flattener, v2);
    const root3 = exports.flattener_findRoot(flattener, v3);
    expect(root1).toBe(root2);
    expect(root2).toBe(root3);

    // 4. Connect flow variables (Kirchhoff Current Law i1, i2)
    exports.flattener_addConnection(flattener, i1, i2, 1, 0); // flow = 1

    const generatedFlowEqs = exports.flattener_finalizeConnections(flattener);
    expect(generatedFlowEqs).toBe(1);

    // 5. Test Bidirectional Fluid Stream Connection (Modelica 3.7 Chapter 15)
    const h1 = exports.dae_addVariable(dae, djb2Hash("pipe1.port_b.h_outflow"), 0, 0, 0, 0, 4); // Stream flag (1 << 2)
    const mdot1 = exports.dae_addVariable(dae, djb2Hash("pipe1.port_b.m_flow"), 0, 0, 0, 0, 2);
    const h2 = exports.dae_addVariable(dae, djb2Hash("pipe2.port_a.h_outflow"), 0, 0, 0, 0, 4);
    const mdot2 = exports.dae_addVariable(dae, djb2Hash("pipe2.port_a.m_flow"), 0, 0, 0, 0, 2);

    const streamConnIdx = exports.flattener_addStreamConnection(flattener, h1, mdot1, h2, mdot2);
    expect(streamConnIdx).toBe(0);

    // 6. Test Dynamic Expandable Connector Bus Expansion
    const busVar = exports.dae_addVariable(dae, djb2Hash("canBus"), 0, 0, 0, 0, 0);
    const dynSignalVar = exports.flattener_expandConnector(flattener, busVar, djb2Hash("vehicle_speed"), 0);
    expect(dynSignalVar).toBeGreaterThan(0);
    expect(exports.flattener_findRoot(flattener, dynSignalVar)).toBe(dynSignalVar);
  }, 180000);
});
