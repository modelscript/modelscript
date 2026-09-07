import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmPath = path.resolve(__dirname, "../../runtime/build/release.wasm");
const wasmBuffer = fs.readFileSync(wasmPath);

const imports = {
  env: {
    abort: (msg, file, line, col) => {
      console.error(`WASM ABORT at ${line}:${col}`);
    }
  },
  JavaScript: { debugLog: () => {}, logNode: () => {} },
  engine: { debugLog: () => {} },
  parser: { logInt: () => {} },
  recovery: {},
  host: { runHostQuery: () => {} }
};

const { instance } = await WebAssembly.instantiate(wasmBuffer, imports);
const wasm = instance.exports;
const memory = wasm.memory;

console.log("=== WebAssembly Math Kernel Initialized ===");

const alloc = wasm.alloc || ((sz) => 1024 * 1024);

const memPtr = alloc(1024);
const varValsPtr = memPtr;
const varBoundsLoPtr = memPtr + 64;
const varBoundsHiPtr = memPtr + 128;
const outLoPtr = memPtr + 192;
const outHiPtr = memPtr + 200;
const outCvPtr = memPtr + 208;
const outCcPtr = memPtr + 216;

let f64View = new Float64Array(memory.buffer);

// Setup variable 0: x1 in [1.0, 3.0], val = 2.0
// Setup variable 1: x2 in [2.0, 4.0], val = 3.0
f64View[varValsPtr / 8 + 0] = 2.0;
f64View[varValsPtr / 8 + 1] = 3.0;

f64View[varBoundsLoPtr / 8 + 0] = 1.0;
f64View[varBoundsLoPtr / 8 + 1] = 2.0;

f64View[varBoundsHiPtr / 8 + 0] = 3.0;
f64View[varBoundsHiPtr / 8 + 1] = 4.0;

// Create DaeBuilder
const daePtr = wasm.dae_createBuilder();
// Add variables: nameId, type (0=Real), variability (0=Continuous), causality (0=Local), startVal, flags
const v1 = wasm.dae_addVariable(daePtr, 1, 0, 0, 0, 2.0, 0);
const v2 = wasm.dae_addVariable(daePtr, 2, 0, 0, 0, 3.0, 0);

// Build expression 1: (x1 + x2) * x1
const name1 = wasm.dae_addName(daePtr, 0);
const name2 = wasm.dae_addName(daePtr, 1);
const sumExpr = wasm.dae_addBinaryExpr(daePtr, 0, name1, name2); // Add
const prodExpr = wasm.dae_addBinaryExpr(daePtr, 2, sumExpr, name1); // Mul

console.log("DaeBuilder created, prodExpr id:", prodExpr);

// --- Test 1: Interval Arithmetic Accuracy & Zero-GC ---
console.log("\n--- Test 1: Interval Arithmetic Zero-GC Benchmark ---");
const initialPages = memory.buffer.byteLength / 65536;

wasm.dae_evalInterval(daePtr, prodExpr, varBoundsLoPtr, varBoundsHiPtr, outLoPtr, outHiPtr);
f64View = new Float64Array(memory.buffer);
const loVal = f64View[outLoPtr / 8];
const hiVal = f64View[outHiPtr / 8];
console.log(`Computed Interval: [${loVal}, ${hiVal}], Expected: [3, 21]`);
if (Math.abs(loVal - 3.0) > 1e-9 || Math.abs(hiVal - 21.0) > 1e-9) {
  throw new Error(`Interval mismatch: expected [3, 21], got [${loVal}, ${hiVal}]`);
}

const startIvTime = performance.now();
for (let i = 0; i < 100000; i++) {
  wasm.dae_evalInterval(daePtr, prodExpr, varBoundsLoPtr, varBoundsHiPtr, outLoPtr, outHiPtr);
}
const endIvTime = performance.now();
const finalPagesIv = memory.buffer.byteLength / 65536;

console.log(`100,000 Interval Evaluations: ${(endIvTime - startIvTime).toFixed(2)} ms (${((endIvTime - startIvTime)/100).toFixed(3)} µs/eval)`);
console.log(`Memory pages: before=${initialPages}, after=${finalPagesIv} (Grown: ${finalPagesIv - initialPages})`);
if (finalPagesIv !== initialPages) {
  throw new Error("Memory grew during Interval evaluation! Zero-GC invariant violated.");
}

// --- Test 2: McCormick Relaxation Accuracy & Zero-GC ---
console.log("\n--- Test 2: McCormick Relaxation Zero-GC Benchmark ---");
wasm.dae_evalMcCormick(daePtr, prodExpr, varValsPtr, varBoundsLoPtr, varBoundsHiPtr, outCvPtr, outCcPtr, outLoPtr, outHiPtr);

f64View = new Float64Array(memory.buffer);
const mcCv = f64View[outCvPtr / 8];
const mcCc = f64View[outCcPtr / 8];
const mcLo = f64View[outLoPtr / 8];
const mcHi = f64View[outHiPtr / 8];

console.log(`McCormick bounds at (2,3): cv=${mcCv.toFixed(3)}, cc=${mcCc.toFixed(3)}, [lo=${mcLo}, hi=${mcHi}]`);
if (mcCv > 10.0 + 1e-9 || mcCc < 10.0 - 1e-9) {
  throw new Error(`McCormick relaxation violated primal value at 10.0: cv=${mcCv}, cc=${mcCc}`);
}
if (mcLo > mcCv || mcCc > mcHi) {
  throw new Error(`McCormick bounds outside interval bounds: lo=${mcLo}, cv=${mcCv}, cc=${mcCc}, hi=${mcHi}`);
}

const startMcTime = performance.now();
for (let i = 0; i < 100000; i++) {
  wasm.dae_evalMcCormick(daePtr, prodExpr, varValsPtr, varBoundsLoPtr, varBoundsHiPtr, outCvPtr, outCcPtr, outLoPtr, outHiPtr);
}
const endMcTime = performance.now();
const finalPagesMc = memory.buffer.byteLength / 65536;

console.log(`100,000 McCormick Evaluations: ${(endMcTime - startMcTime).toFixed(2)} ms (${((endMcTime - startMcTime)/100).toFixed(3)} µs/eval)`);
console.log(`Memory pages: before=${initialPages}, after=${finalPagesMc} (Grown: ${finalPagesMc - initialPages})`);
if (finalPagesMc !== initialPages) {
  throw new Error("Memory grew during McCormick evaluation! Zero-GC invariant violated.");
}

// --- Test 3: Affine Arithmetic & Correlation Dependency Elimination ---
console.log("\n--- Test 3: Affine Arithmetic Dependency Elimination ---");
const diffExpr = wasm.dae_addBinaryExpr(daePtr, 1, name1, name1); // Binary Sub (x1 - x1)

wasm.dae_evalInterval(daePtr, diffExpr, varBoundsLoPtr, varBoundsHiPtr, outLoPtr, outHiPtr);
f64View = new Float64Array(memory.buffer);
const stdLo = f64View[outLoPtr / 8];
const stdHi = f64View[outHiPtr / 8];
const stdWidth = stdHi - stdLo;
console.log(`Standard Interval (x1 - x1): [${stdLo}, ${stdHi}], width=${stdWidth} (Exploded due to dependency)`);

wasm.dae_evalAffine(daePtr, diffExpr, varBoundsLoPtr, varBoundsHiPtr, outLoPtr, outHiPtr);
f64View = new Float64Array(memory.buffer);
const affLo = f64View[outLoPtr / 8];
const affHi = f64View[outHiPtr / 8];
const affWidth = affHi - affLo;
console.log(`Affine Arithmetic (x1 - x1): [${affLo}, ${affHi}], width=${affWidth} (Noise symbols canceled exactly!)`);

if (affWidth > 1e-12 || Math.abs(affLo) > 1e-12 || Math.abs(affHi) > 1e-12) {
  throw new Error(`Affine arithmetic failed to cancel dependency: got [${affLo}, ${affHi}]`);
}

const startAffTime = performance.now();
for (let i = 0; i < 100000; i++) {
  wasm.dae_evalAffine(daePtr, diffExpr, varBoundsLoPtr, varBoundsHiPtr, outLoPtr, outHiPtr);
}
const endAffTime = performance.now();
const finalPagesAff = memory.buffer.byteLength / 65536;

console.log(`100,000 Affine Evaluations: ${(endAffTime - startAffTime).toFixed(2)} ms (${((endAffTime - startAffTime)/100).toFixed(3)} µs/eval)`);
console.log(`Memory pages: before=${initialPages}, after=${finalPagesAff} (Grown: ${finalPagesAff - initialPages})`);
if (finalPagesAff !== initialPages) {
  throw new Error("Memory grew during Affine evaluation! Zero-GC invariant violated.");
}

console.log("\n>>> ALL ZERO-GC WASM MATH TESTS PASSED PERFECTLY! <<<\n");
