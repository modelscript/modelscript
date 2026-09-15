// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  VarType,
  Variability,
  createPackedBuffer,
  initBltWasm,
  packFromSparse,
  performBltTransformationArena,
  planStaticArenaMemory,
  unpackToSparse,
} from "@modelscript/runtime";
import assert from "node:assert";

async function main() {
  console.log("=== Testing XLA-Style Static Linear-Memory Planner ===");
  await initBltWasm();

  const dae = new DAEBuilder();

  // Variables:
  // Persistent:
  //   x: State
  //   der(x): Derivative
  //   k: Parameter
  // Transient sequence:
  //   y1 = k * x     (born in block 0, dead after block 1)
  //   y2 = y1 + 10.0 (born in block 1, dead after block 2)
  //   y3 = y2 * 2.0  (born in block 2, dead after block 3)
  //   der(x) = y3    (consumed in block 3)
  const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const derXIdx = dae.addVariable("der(x)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const kIdx = dae.addVariable("k", VarType.Real, Variability.Parameter, Causality.Local, 2.5);
  const y1Idx = dae.addVariable("y1", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const y2Idx = dae.addVariable("y2", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const y3Idx = dae.addVariable("y3", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  // Eq 0: y1 = k * x
  dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("y1")),
    dae.addBinaryExpr(
      BinOp.Mul,
      dae.addExpression(ExprKind.Name, dae.interner.intern("k")),
      dae.addExpression(ExprKind.Name, dae.interner.intern("x")),
    ),
  );

  // Eq 1: y2 = y1 + 10.0
  dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("y2")),
    dae.addBinaryExpr(BinOp.Add, dae.addExpression(ExprKind.Name, dae.interner.intern("y1")), dae.addRealLiteral(10.0)),
  );

  // Eq 2: y3 = y2 * 2.0
  dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("y3")),
    dae.addBinaryExpr(BinOp.Mul, dae.addExpression(ExprKind.Name, dae.interner.intern("y2")), dae.addRealLiteral(2.0)),
  );

  // Eq 3: der(x) = y3
  dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("der(x)")),
    dae.addExpression(ExprKind.Name, dae.interner.intern("y3")),
  );

  const stateVars = new Set<number>([xIdx]);
  const blt = performBltTransformationArena(dae, stateVars);
  console.log(`  BLT partitioned model into ${blt.blocks.length} blocks`);

  const plan = planStaticArenaMemory(dae, blt, stateVars);
  console.log(`  Total Variables: ${dae.varCount}`);
  console.log(`  Persistent Slots: ${plan.persistentCount} (x, der(x), k)`);
  console.log(`  Scratchpad Slots: ${plan.scratchpadCount}`);
  console.log(`  Total Packed Size: ${plan.totalPackedSize}`);
  console.log(`  Compression Ratio: ${(plan.compressionRatio * 100).toFixed(1)}%`);

  // Persistent slots must be 3
  assert.strictEqual(plan.persistentCount, 3, "Persistent count must be 3 (x, der(x), k)");
  // Since y1, y2, y3 have disjoint/pipelined lifetimes, scratchpad slots should be reused (<= 2 slots)
  assert(plan.scratchpadCount <= 2, `Scratchpad slots must be reused, got ${plan.scratchpadCount}`);
  assert(plan.totalPackedSize < dae.varCount, "Packed size must be smaller than total varCount");

  // Test Buffer Packing and Unpacking
  const packed = createPackedBuffer(plan);
  const maxNameId = Math.max(...Array.from(plan.nameIdToOffset.keys())) + 10;
  const sparse = new Float64Array(maxNameId);

  // Set initial sparse values
  sparse[dae.getVarNameId(xIdx)] = 1.234;
  sparse[dae.getVarNameId(kIdx)] = 5.678;

  packFromSparse(plan, sparse, packed);
  const xOffset = plan.varIdxToOffset[xIdx]!;
  const kOffset = plan.varIdxToOffset[kIdx]!;
  assert.strictEqual(packed[xOffset], 1.234);
  assert.strictEqual(packed[kOffset], 5.678);

  // Modify packed buffer and unpack
  packed[xOffset] = 9.876;
  unpackToSparse(plan, packed, sparse);
  assert.strictEqual(sparse[dae.getVarNameId(xIdx)], 9.876);

  console.log("  ✔ Static Linear-Memory Planner tests passed successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
