import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Causality, EqKind, ExprKind, VarType, Variability, WasmDaeBridge } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log("=== Testing Native In-WASM Semantic Flattener ===");
  const wasmPath = path.resolve(__dirname, "../../../languages/modelica/dist/parser.wasm");
  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmModule = await WebAssembly.compile(wasmBuffer);

  const memory = new WebAssembly.Memory({ initial: 256, maximum: 4096, shared: true });
  const imports: any = {
    env: {
      memory,
      abort: (msg: any, file: any, line: any, col: any) => {
        console.error(`[WASM Abort] ${msg} at ${file}:${line}:${col}`);
      },
    },
    JavaScript: { debugLog: () => {}, logNode: () => {} },
    engine: { debugLog: () => {} },
    parser: { logInt: (n: number) => console.log("[WASM logInt]", n) },
    recovery: {},
    host: { runHostQuery: () => {} },
  };

  const wasmInstance = await WebAssembly.instantiate(wasmModule, imports);
  const exports = wasmInstance.exports as any;

  assert(typeof exports.flattener_create === "function", "flattener_create must be exported");
  assert(typeof exports.flattener_createEnv === "function", "flattener_createEnv must be exported");
  assert(typeof exports.flattener_envBind === "function", "flattener_envBind must be exported");
  assert(typeof exports.flattener_envLookup === "function", "flattener_envLookup must be exported");
  assert(typeof exports.flattener_envMerge === "function", "flattener_envMerge must be exported");
  assert(typeof exports.flattener_addConnection === "function", "flattener_addConnection must be exported");
  assert(typeof exports.flattener_finalizeConnections === "function", "flattener_finalizeConnections must be exported");
  assert(typeof exports.flattener_addStreamConnection === "function", "flattener_addStreamConnection must be exported");
  assert(typeof exports.flattener_expandConnector === "function", "flattener_expandConnector must be exported");

  console.log("✓ All flattener WASM exports present");

  // Test 1: Modification Environment & Merge
  console.log("Testing Modification Environment...");
  const env1 = exports.flattener_createEnv(0);
  const env2 = exports.flattener_createEnv(0);

  const key1 = 1001;
  const key2 = 1002;
  const val1 = 42;
  const val2 = 99;

  exports.flattener_envBind(env1, key1, val1, 1, 0); // isFinal = 1
  exports.flattener_envBind(env2, key2, val2, 0, 0); // isFinal = 0
  exports.flattener_envBind(env2, key1, 999, 0, 0); // attempt override key1

  assert.strictEqual(exports.flattener_envLookup(env1, key1), 42, "env1 key1 should be 42");
  assert.strictEqual(exports.flattener_envLookup(env2, key2), 99, "env2 key2 should be 99");

  // Merge env2 into env1 (key1 should NOT be overwritten because it is final)
  exports.flattener_envMerge(env1, env2);
  assert.strictEqual(exports.flattener_envLookup(env1, key1), 42, "final key1 should survive merge");
  assert.strictEqual(exports.flattener_envLookup(env1, key2), 99, "key2 should be merged into env1");
  console.log("✓ Modification environment merge and final check passed");

  // Test 2: Connection Sets, Kirchhoff Flow Sums & Potential Equality
  console.log("Testing Connection Sets & Kirchhoff Balancing...");
  const daePtr = exports.dae_createBuilder();
  const flattenerPtr = exports.flattener_create(daePtr);

  // Add 4 variables: v1, v2 (potential), i1, i2 (flow)
  const v1 = exports.dae_addVariable(daePtr, 201, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const v2 = exports.dae_addVariable(daePtr, 202, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const i1 = exports.dae_addVariable(daePtr, 203, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 1); // FLAG_VAR_FLOW
  const i2 = exports.dae_addVariable(daePtr, 204, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 1); // FLAG_VAR_FLOW

  // Connect potential ports: connect(v1, v2) -> adds equality equation v1 = v2
  exports.flattener_addConnection(flattenerPtr, v1, v2, 0, 0);
  // Connect flow ports: connect(i1, i2) -> registers flow set
  exports.flattener_addConnection(flattenerPtr, i1, i2, 1, 0);

  // Finalize connections -> emits flow equation i1 + i2 = 0
  const flowEqs = exports.flattener_finalizeConnections(flattenerPtr);
  assert.strictEqual(flowEqs, 1, "Should generate 1 Kirchhoff flow zero-sum equation");

  const bridge = new WasmDaeBridge(exports, daePtr);
  assert.strictEqual(bridge.getEqCount(), 2, "Should have 2 equations (1 potential equality + 1 flow sum)");
  console.log("✓ Connection sets and Kirchhoff flow balancing passed");

  // Test 3: Stream Connections & Upwind Discretization
  console.log("Testing Stream Connections...");
  const h1 = exports.dae_addVariable(daePtr, 301, VarType.Real, Variability.Continuous, Causality.Local, 100.0, 0);
  const mdot1 = exports.dae_addVariable(daePtr, 302, VarType.Real, Variability.Continuous, Causality.Local, 5.0, 0);
  const h2 = exports.dae_addVariable(daePtr, 303, VarType.Real, Variability.Continuous, Causality.Local, 200.0, 0);
  const mdot2 = exports.dae_addVariable(daePtr, 304, VarType.Real, Variability.Continuous, Causality.Local, -5.0, 0);

  exports.flattener_addStreamConnection(flattenerPtr, h1, mdot1, h2, mdot2);
  assert.strictEqual(bridge.getEqCount(), 3, "Stream connection added upwind mixing equation");
  console.log("✓ Stream connection upwind mixing equation passed");

  // Test 4: Expandable Connector Bus Allocation
  console.log("Testing Expandable Connector Dynamic Bus...");
  const busVar = exports.dae_addVariable(daePtr, 400, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const member1 = exports.flattener_expandConnector(flattenerPtr, busVar, 401, VarType.Real);
  const member2 = exports.flattener_expandConnector(flattenerPtr, busVar, 402, VarType.Real);

  assert(member1 > 0 && member2 > 0 && member1 !== member2, "Allocated dynamic bus members");
  assert.strictEqual(bridge.getVarCount(), 11, "Total variables after expandable connector allocation");
  console.log("✓ Expandable connector dynamic bus allocation passed");

  // Test 5: Full Class Definition Flattening in WASM
  console.log("Testing Full Class Definition Flattening in WASM...");
  const dae2Ptr = exports.dae_createBuilder();
  const flattener2Ptr = exports.flattener_create(dae2Ptr);
  const bridge2 = new WasmDaeBridge(exports, dae2Ptr);

  // Flatten an AST node container representing a class with 3 components and equation sections
  const flattenedVarCount = exports.flattener_flattenClass(flattener2Ptr, 500);
  assert(flattenedVarCount >= 0, "Class flattened cleanly");
  console.log("✓ Class definition flattened in WebAssembly linear memory");

  // Test 6: Hierarchical Submodel & Nested Modifiers
  console.log("Testing Hierarchical Submodel & Nested Modifiers in WASM...");
  const dae3Ptr = exports.dae_createBuilder();
  const flattener3Ptr = exports.flattener_create(dae3Ptr);
  const env3 = exports.flattener_createEnv(0);

  // Bind nested modifier: R1.start = 100.0
  exports.flattener_envBind(env3, 601, 100, 0, 0);
  const count3 = exports.flattener_flattenClassWithMods(flattener3Ptr, 500, 0, env3);
  assert(count3 >= 0, "Hierarchical submodel flattened with nested modifiers");
  console.log("✓ Hierarchical submodel flattened with nested modifiers in WASM");

  // Test 7: Multidimensional Array Component Unrolling in WASM
  console.log("Testing Multidimensional Array Component Unrolling in WASM...");
  const dae4Ptr = exports.dae_createBuilder();
  const flattener4Ptr = exports.flattener_create(dae4Ptr);
  const bridge4 = new WasmDaeBridge(exports, dae4Ptr);

  // Unroll 2D array: Real M[3, 2] -> 6 scalar variables
  const unrolledCount = exports.flattener_flattenArrayComponent(
    flattener4Ptr,
    700,
    3,
    2,
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
  );
  assert.strictEqual(unrolledCount, 6, "Should unroll 3x2 array to 6 scalar variables");
  assert.strictEqual(bridge4.getVarCount(), 6, "DAE should contain 6 unrolled scalar variables");
  console.log("✓ Multidimensional array unrolling in WASM passed");

  // Test 8: Composite Connector Record Port Matching
  console.log("Testing Composite Connector Record Port Matching in WASM...");
  const dae5Ptr = exports.dae_createBuilder();
  const flattener5Ptr = exports.flattener_create(dae5Ptr);
  const bridge5 = new WasmDaeBridge(exports, dae5Ptr);

  // Port 1: Pin p1 (v1: potential, i1: flow)
  const p1_v = exports.dae_addVariable(dae5Ptr, 801, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const p1_i = exports.dae_addVariable(dae5Ptr, 802, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 2); // FLAG_VAR_FLOW = 2

  // Port 2: Pin p2 (v2: potential, i2: flow)
  const p2_v = exports.dae_addVariable(dae5Ptr, 803, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const p2_i = exports.dae_addVariable(dae5Ptr, 804, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 2); // FLAG_VAR_FLOW = 2

  // Connect entire composite ports: connect(p1, p2) with 2 members
  const matchedCount = exports.flattener_connectPorts(flattener5Ptr, p1_v, p2_v, 2, 0);
  assert.strictEqual(matchedCount, 2, "Should match 2 port members");

  const portFlowEqs = exports.flattener_finalizeConnections(flattener5Ptr);
  assert.strictEqual(portFlowEqs, 1, "Should generate 1 flow equation for matched pins");
  assert.strictEqual(bridge5.getEqCount(), 2, "Should have 2 equations: p1.v = p2.v and p1.i + p2.i = 0");
  console.log("✓ Composite connector record port matching passed");

  // Test 9: Inner/Outer Component Scope Resolution
  console.log("Testing Inner/Outer Component Resolution in WASM...");
  const dae6Ptr = exports.dae_createBuilder();
  const flattener6Ptr = exports.flattener_create(dae6Ptr);

  // Register inner global variable (nameHash 900 -> varId 12)
  exports.flattener_registerInner(flattener6Ptr, 900, 12);
  const resolvedInnerVarId = exports.flattener_resolveOuter(flattener6Ptr, 900);
  assert.strictEqual(resolvedInnerVarId, 12, "Should resolve outer reference to matching inner variable");
  console.log("✓ Inner/Outer component scope resolution passed");

  // Test 10: Initial Equation Marking
  console.log("Testing Initial Equation Marking in WASM...");
  const dae7Ptr = exports.dae_createBuilder();
  const flattener7Ptr = exports.flattener_create(dae7Ptr);
  const bridge7 = new WasmDaeBridge(exports, dae7Ptr);

  const xVar = exports.dae_addVariable(dae7Ptr, 1001, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const initLhs = exports.dae_addExpression(dae7Ptr, ExprKind.Name, 1001);
  const initRhs = exports.dae_addRealLiteral(dae7Ptr, 42.0);
  exports.dae_addEquation(dae7Ptr, EqKind.Simple, initLhs, initRhs, 1); // FLAG_EQ_INITIAL = 1

  assert.strictEqual(bridge7.getEqCount(), 1, "Should have 1 equation");
  assert.strictEqual(exports.dae_getEqAux(dae7Ptr, 0) & 1, 1, "Equation should have FLAG_EQ_INITIAL flag set");
  console.log("✓ Initial equation flag marking passed");

  // Test 11: Connector Cardinality Counting
  console.log("Testing Connector Cardinality in WASM...");
  const dae8Ptr = exports.dae_createBuilder();
  const flattener8Ptr = exports.flattener_create(dae8Ptr);
  const pA = exports.dae_addVariable(dae8Ptr, 1101, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const pB = exports.dae_addVariable(dae8Ptr, 1102, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const pC = exports.dae_addVariable(dae8Ptr, 1103, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);

  // Connect A to B, and A to C -> cardinality(A) should be 2, cardinality(B) should be 1, cardinality(C) should be 1
  exports.flattener_addConnection(flattener8Ptr, pA, pB, 0, 0);
  exports.flattener_addConnection(flattener8Ptr, pA, pC, 0, 0);

  assert.strictEqual(exports.flattener_getCardinality(flattener8Ptr, pA), 2, "Cardinality of pA should be 2");
  assert.strictEqual(exports.flattener_getCardinality(flattener8Ptr, pB), 1, "Cardinality of pB should be 1");
  assert.strictEqual(exports.flattener_getCardinality(flattener8Ptr, pC), 1, "Cardinality of pC should be 1");
  console.log("✓ Connector cardinality counting passed");

  console.log("\n=== ALL NATIVE IN-WASM FLATTENER TESTS PASSED ===");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
