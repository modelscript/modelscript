// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Large-Scale DAE Arena Benchmark (1M+ Coupled Equations).
 *
 * Verifies:
 * 1. Scalability of DAEBuilder Struct-of-Arrays linear memory arena across 10k, 100k, and 1,000,000 equations.
 * 2. Exact linear memory consumption (WASM pages and bytes allocated).
 * 3. wasm32 constraint verification (4GB address space limit, 65,536 pages of 64KB).
 * 4. wasm64 constraint projection (64-bit linear memory space with Memory64).
 * 5. Structural integrity via sampled equation verification.
 */

import { performance } from "node:perf_hooks";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, VarType, Variability } from "../src/index.js";

export interface ScaleRunResult {
  equationCount: number;
  variableCount: number;
  expressionCount: number;
  buildTimeMs: number;
  throughputEqSec: number;
  wasmLinearBytes: number;
  wasmMb: number;
  wasmPages: number;
  v8HeapMb: number;
  bytesPerEquationTotal: number;
  wasm32Max4GbUsagePct: number;
  wasm32Practical2GbUsagePct: number;
  wasm32MaxTheoreticalCapacity: number;
  wasm64Theoretical8GbCapacity: number;
  wasm64Theoretical16GbCapacity: number;
  wasm64Theoretical64GbCapacity: number;
}

export function runDaeScaleBenchmark(targetCount: number): ScaleRunResult {
  // Force garbage collection if available
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }

  const initialHeap = process.memoryUsage().heapUsed;
  const dae = new DAEBuilder(undefined, "CoupledDAESystem");

  const nameX = dae.interner.intern("x");
  const nameDerX = dae.interner.intern("der_x");
  const nameK = dae.interner.intern("k");

  const t0 = performance.now();

  // Construct coupled chain of N differential-algebraic equations:
  // For each i:
  //   der(x[i]) = -k * x[i] + 0.5 * x[i-1]
  // This constructs:
  //   - 1 state variable x[i]
  //   - 1 parameter literal k
  //   - 1 derivative expr der(x[i])
  //   - 1 decay binary expr (-k * x[i])
  //   - 1 coupling binary expr (+ 0.5 * x[i-1])
  //   - 1 simple equation: der(x[i]) = rhs
  let prevVarExprId = -1;

  for (let i = 0; i < targetCount; i++) {
    // Add state variable into SoA linear arena
    const varIdx = dae.addVariable(
      nameX,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      1.0 + (i % 100) * 0.01,
      0,
    );

    const varExprId = dae.addExpression(ExprKind.Name, varIdx);
    const derExprId = dae.addExpression(ExprKind.Derivative, varExprId);

    // Literal parameter
    const paramLiteralId = dae.addRealLiteral(1.05);

    // -k * x[i]
    const decayExprId = dae.addBinaryExpr(BinOp.Mul, paramLiteralId, varExprId);

    // Coupled term with neighbor
    let rhsExprId = decayExprId;
    if (prevVarExprId >= 0) {
      const couplingLiteralId = dae.addRealLiteral(0.5);
      const coupledTermId = dae.addBinaryExpr(BinOp.Mul, couplingLiteralId, prevVarExprId);
      rhsExprId = dae.addBinaryExpr(BinOp.Add, decayExprId, coupledTermId);
    }

    // Add equation der(x[i]) = rhs
    dae.addEquation(EqKind.Simple, derExprId, rhsExprId);

    prevVarExprId = varExprId;
  }

  const buildTimeMs = performance.now() - t0;
  const finalHeap = process.memoryUsage().heapUsed;

  const wasmLinearBytes = dae.exports?.memory?.buffer?.byteLength ?? 0;
  const wasmPages = wasmLinearBytes / 65536;
  const wasmMb = wasmLinearBytes / (1024 * 1024);
  const v8HeapMb = Math.max(0, finalHeap - initialHeap) / (1024 * 1024);

  const eqCount = dae.eqCount;
  const varCount = dae.varCount;
  const exprCount = dae.exprCount;

  // Sampled verification: verify index 0, mid, and last
  const samples = [0, Math.floor(targetCount / 2), targetCount - 1];
  for (const s of samples) {
    const kind = dae.getEqKind(s);
    if (kind !== EqKind.Simple) {
      throw new Error(`Integrity check failed at equation ${s}: expected EqKind.Simple, got ${kind}`);
    }
    const lhs = dae.getEqLhs(s);
    if (lhs < 0 || lhs >= exprCount) {
      throw new Error(`Integrity check failed at equation ${s}: invalid lhs ${lhs}`);
    }
  }

  // Memory Constraint Projections:
  // wasm32: 4GB = 4 * 1024 * 1024 * 1024 bytes (4,294,967,296 bytes, 65,536 pages)
  const WASM32_MAX_BYTES = 4 * 1024 * 1024 * 1024;
  const WASM32_PRACTICAL_2GB = 2 * 1024 * 1024 * 1024;
  const bytesPerEquationTotal = wasmLinearBytes / targetCount;
  const wasm32Max4GbUsagePct = (wasmLinearBytes / WASM32_MAX_BYTES) * 100;
  const wasm32Practical2GbUsagePct = (wasmLinearBytes / WASM32_PRACTICAL_2GB) * 100;
  const wasm32MaxTheoreticalCapacity = Math.floor(WASM32_MAX_BYTES / bytesPerEquationTotal);

  // wasm64: projected against physical host memory constraints
  const WASM64_HOST_8GB = 8 * 1024 * 1024 * 1024;
  const WASM64_HOST_16GB = 16 * 1024 * 1024 * 1024;
  const WASM64_HOST_64GB = 64 * 1024 * 1024 * 1024;

  const wasm64Theoretical8GbCapacity = Math.floor(WASM64_HOST_8GB / bytesPerEquationTotal);
  const wasm64Theoretical16GbCapacity = Math.floor(WASM64_HOST_16GB / bytesPerEquationTotal);
  const wasm64Theoretical64GbCapacity = Math.floor(WASM64_HOST_64GB / bytesPerEquationTotal);

  dae.free();

  return {
    equationCount: eqCount,
    variableCount: varCount,
    expressionCount: exprCount,
    buildTimeMs,
    throughputEqSec: Math.round(targetCount / (buildTimeMs / 1000)),
    wasmLinearBytes,
    wasmMb,
    wasmPages,
    v8HeapMb,
    bytesPerEquationTotal,
    wasm32Max4GbUsagePct,
    wasm32Practical2GbUsagePct,
    wasm32MaxTheoreticalCapacity,
    wasm64Theoretical8GbCapacity,
    wasm64Theoretical16GbCapacity,
    wasm64Theoretical64GbCapacity,
  };
}

async function main() {
  console.log("================================================================================");
  console.log(" ModelScript Large-Scale DAE Arena Benchmark (wasm32 & wasm64 Constraints)");
  console.log("================================================================================\n");

  const scales = [10_000, 100_000, 1_000_000];
  const results: ScaleRunResult[] = [];

  for (const count of scales) {
    process.stdout.write(`Running benchmark for ${count.toLocaleString()} equations... `);
    const res = runDaeScaleBenchmark(count);
    results.push(res);
    console.log(
      `Done in ${res.buildTimeMs.toFixed(1)}ms (${res.throughputEqSec.toLocaleString()} eq/s, ${res.wasmMb.toFixed(2)} MB WASM)`,
    );
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" Benchmark Results Summary Table");
  console.log("--------------------------------------------------------------------------------");
  console.log(
    "Equations".padEnd(12) +
      "Vars".padEnd(12) +
      "Exprs".padEnd(12) +
      "Time".padEnd(10) +
      "Rate (eq/s)".padEnd(14) +
      "WASM Mem".padEnd(12) +
      "Bytes/Eq".padEnd(10),
  );
  console.log("-".repeat(82));

  for (const r of results) {
    console.log(
      r.equationCount.toLocaleString().padEnd(12) +
        r.variableCount.toLocaleString().padEnd(12) +
        r.expressionCount.toLocaleString().padEnd(12) +
        `${r.buildTimeMs.toFixed(1)}ms`.padEnd(10) +
        r.throughputEqSec.toLocaleString().padEnd(14) +
        `${r.wasmMb.toFixed(2)} MB`.padEnd(12) +
        `${r.bytesPerEquationTotal.toFixed(1)} B`.padEnd(10),
    );
  }

  const r1m = results[results.length - 1]!;
  console.log("\n================================================================================");
  console.log(" Architectural Memory Constraint Analysis for 1,000,000 Equations");
  console.log("================================================================================");
  console.log(
    `1. WASM Linear Memory Allocated: ${r1m.wasmMb.toFixed(2)} MB (${r1m.wasmPages.toLocaleString()} pages of 64KB)`,
  );
  console.log(
    `2. Average Density:             ${r1m.bytesPerEquationTotal.toFixed(1)} bytes per coupled equation (1 var + 7 expr nodes + 1 eq handle)`,
  );
  console.log(`3. wasm32 Constraints:`);
  console.log(
    `   - 4 GB Maximum Address Space: 1M equations consume ${r1m.wasm32Max4GbUsagePct.toFixed(2)}% of wasm32 limit`,
  );
  console.log(`   - Headroom in wasm32 (4GB):   ${(100 - r1m.wasm32Max4GbUsagePct).toFixed(2)}% free`);
  console.log(
    `   - Practical 2 GB Browser Cap: 1M equations consume ${r1m.wasm32Practical2GbUsagePct.toFixed(2)}% of 2GB cap`,
  );
  console.log(
    `   - Theoretical wasm32 Max:     ${r1m.wasm32MaxTheoreticalCapacity.toLocaleString()} coupled DAE equations`,
  );
  console.log(`4. wasm64 / Memory64 Projections:`);
  console.log(`   - Address Space Limit:        16 Exabytes (2^64 bytes, effectively boundless)`);
  console.log(
    `   - 8 GB RAM Host Cap:          ${r1m.wasm64Theoretical8GbCapacity.toLocaleString()} coupled DAE equations`,
  );
  console.log(
    `   - 16 GB RAM Host Cap:         ${r1m.wasm64Theoretical16GbCapacity.toLocaleString()} coupled DAE equations`,
  );
  console.log(
    `   - 64 GB Workstation Cap:      ${r1m.wasm64Theoretical64GbCapacity.toLocaleString()} coupled DAE equations`,
  );
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
