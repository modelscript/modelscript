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

describe("Phase 1: Deep Salsa 3.0 Semantics & Modification Environment", () => {
  it("should compile WASM runtime and verify nested ModificationEnvironment algebra with final/redeclare", async () => {
    const result = buildParser(modelicaLanguage);
    const tmpDir = path.resolve(__dirname, "../build/tmp-phase1-salsa-test");
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

    // 1. Test ModificationEnvironment Creation & Binding
    const env1 = exports.flattener_createEnv(0);
    expect(env1).toBeGreaterThan(0);

    const keyR = djb2Hash("R");
    const keyC = djb2Hash("C");

    // Bind parameter R = 100 (value expr ID 42) marked as final
    exports.flattener_envBind(env1, keyR, 42, 1, 0); // isFinal = 1, isEach = 0
    expect(exports.flattener_envLookup(env1, keyR)).toBe(42);
    expect(exports.flattener_envLookupFlags(env1, keyR) & 1).toBe(1); // FLAG_MOD_FINAL = 1

    // 2. Test Nested Environment: subB(C = 50)
    const envSubB = exports.flattener_createEnv(env1);
    exports.flattener_envBind(envSubB, keyC, 50, 0, 1); // isFinal = 0, isEach = 1
    const keySubB = djb2Hash("subB");
    exports.flattener_envBindNested(env1, keySubB, envSubB, 0, 0);

    const lookupSubB = exports.flattener_envLookupNested(env1, keySubB);
    expect(lookupSubB).toBe(envSubB);
    expect(exports.flattener_envLookup(lookupSubB, keyC)).toBe(50);
    expect((exports.flattener_envLookupFlags(lookupSubB, keyC) & 2) >>> 1).toBe(1); // FLAG_MOD_EACH = 2

    // 3. Test Environment Merge respecting 'final'
    const incomingEnv = exports.flattener_createEnv(0);
    // Incoming tries to override R with 999
    exports.flattener_envBind(incomingEnv, keyR, 999, 0, 0);
    const keyL = djb2Hash("L");
    exports.flattener_envBind(incomingEnv, keyL, 777, 0, 0);

    exports.flattener_envMerge(env1, incomingEnv);
    // R was marked final: must remain 42!
    expect(exports.flattener_envLookup(env1, keyR)).toBe(42);
    // L was newly merged: must be 777
    expect(exports.flattener_envLookup(env1, keyL)).toBe(777);

    // 4. Test Redeclarations
    const keyMedium = djb2Hash("Medium");
    const newTypeAir = djb2Hash("Modelica.Media.Air");
    exports.flattener_envBindRedeclare(env1, keyMedium, newTypeAir, 0, 0, 0);
    expect(exports.flattener_envLookupRedeclare(env1, keyMedium) >>> 0).toBe(newTypeAir);
    expect((exports.flattener_envLookupFlags(env1, keyMedium) & 4) >>> 2).toBe(1); // FLAG_MOD_REDECLARE = 4

    // 5. Test Negative Dependency Registration & Invalidation
    const queryNodePtr = exports.allocQueryNode2(1, 100, 200, 0, 0);
    const missingNameHash = djb2Hash("MissingForwardModel");
    exports.salsa_registerNegativeDependency(queryNodePtr, missingNameHash);

    const invalidatedCount = exports.salsa_invalidateNegativeDependencies(missingNameHash);
    expect(invalidatedCount).toBe(1);
  }, 180000);
});
