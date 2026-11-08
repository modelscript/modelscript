// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { DistributedEmtRunner, WasmEmtBridge, type DistributedEmtNetworkSpec } from "../src/solvers/emt/index.js";

console.log("=== Testing Phase 3: Large-Scale Distributed Graph Partitioning for EMT ===");

// Build a 4-island EMT network connected by 3 long Bergeron transmission lines (tau >= dt).
// Each island has 3 internal nodes coupled by zero-delay RLC branches.
{
  const dt = 50e-6; // 50 us
  const nIslands = 4;
  const nodesPerIsland = 3;
  const nNodes = nIslands * nodesPerIsland; // 12 nodes total

  const spec: DistributedEmtNetworkSpec = {
    nNodes,
    dt,
    branches: [],
    sources: [],
    bergeronLines: [],
    transformers: [],
  };

  for (let isl = 0; isl < nIslands; isl++) {
    const base = isl * nodesPerIsland;
    // Internal zero-delay RLC branches within island (must never be cut!)
    spec.branches.push(
      { fromNode: base + 0, toNode: base + 1, r: 1.5, l: 0.008, c: 0 },
      { fromNode: base + 1, toNode: base + 2, r: 2.0, l: 0.012, c: 0 },
      { fromNode: base + 2, toNode: -1, r: 25.0 + isl * 5.0, l: 0.05, c: 2e-6 },
    );
    // AC voltage source at node base+0 of each island
    spec.sources.push({
      node: base + 0,
      kind: 1,
      amplitude: 10000.0 * (1 + 0.05 * isl),
      freqHz: 50.0,
      phaseRad: -0.15 * isl,
      rInternal: 0.5,
    });
  }

  // Inter-island Bergeron transmission lines with propagation delay tau >= 5 * dt (250 us .. 400 us)
  spec.bergeronLines.push(
    { fromNode: 2, toNode: 3, zc: 320.0, tauSec: 250e-6, rTotal: 2.4 },
    { fromNode: 5, toNode: 6, zc: 300.0, tauSec: 325e-6, rTotal: 3.1 },
    { fromNode: 8, toNode: 9, zc: 350.0, tauSec: 400e-6, rTotal: 2.8 },
  );

  // 1. Run Monolithic Single-Domain Reference WasmEmtBridge
  const mono = new WasmEmtBridge(spec.nNodes, spec.dt, 32, 16);
  for (const br of spec.branches) {
    mono.addBranch(br.fromNode, br.toNode, br.r, br.l, br.c);
  }
  for (const src of spec.sources) {
    mono.addSource({
      node: src.node,
      isDc: src.kind === 0,
      vPeakKv: src.amplitude / 1000.0,
      freqHz: src.freqHz,
      phaseRad: src.phaseRad,
      gSource: 1.0 / Math.max(1e-6, src.rInternal),
    });
  }
  for (const line of spec.bergeronLines) {
    mono.addBergeronLine(line.fromNode, line.toNode, line.zc, line.tauSec, line.rTotal ?? 0);
  }
  assert.strictEqual(mono.buildAndFactorize(), true);

  // 2. Run 4-Partition DistributedEmtRunner
  const distRunner = new DistributedEmtRunner(spec, 4);

  console.log(
    `   Partitioner Result: cutEdges=${distRunner.partitionResult.cutEdgeCount}, cutLinks=${distRunner.cutLinks.length}, imbalance=${distRunner.partitionResult.imbalanceRatio.toFixed(3)}`,
  );

  // Verify zero-delay internal branches were NEVER cut (all 3 nodes of each island stay in the same partition)
  for (let isl = 0; isl < nIslands; isl++) {
    const base = isl * nodesPerIsland;
    const p0 = distRunner.partitionResult.partOfNode[base + 0];
    const p1 = distRunner.partitionResult.partOfNode[base + 1];
    const p2 = distRunner.partitionResult.partOfNode[base + 2];
    assert.strictEqual(p0, p1, `Zero-delay branch in island ${isl} must not be cut`);
    assert.strictEqual(p1, p2, `Zero-delay branch in island ${isl} must not be cut`);
  }
  assert.strictEqual(
    distRunner.cutLinks.length,
    3,
    "All 3 inter-island Bergeron lines should be cut across 4 partitions",
  );
  assert.ok(distRunner.partitionResult.imbalanceRatio <= 1.15, "Partition load imbalance must be <= 1.15");

  // 3. Step both monolithic and distributed runners for 500 steps (25 ms) and verify exact trajectory parity
  let maxAbsError = 0.0;
  for (let s = 0; s < 500; s++) {
    mono.step();
    const vMono = mono.getVoltages();
    const vDist = distRunner.step();

    for (let u = 0; u < nNodes; u++) {
      const err = Math.abs(vMono[u]! - vDist[u]!);
      if (err > maxAbsError) maxAbsError = err;
    }
  }

  console.log(
    `   Max absolute voltage error (4-Partition Distributed vs Monolithic WASM): ${maxAbsError.toExponential(4)} V`,
  );
  assert.ok(
    maxAbsError < 1e-9,
    `Expected floating-point parity (< 1e-9 V absolute / < 1e-13 relative on 10 kV) between partitioned and monolithic EMT, got ${maxAbsError}`,
  );

  // 4. Verify Slurm HPC manifest generation for 'emt-distributed-cluster'
  const manifest = distRunner.generateSlurmManifest();
  assert.strictEqual(manifest.profileId, "emt-distributed-cluster");
  assert.strictEqual(manifest.numPartitions, 4);
  assert.strictEqual(manifest.cutLineCount, 3);
  assert.ok(manifest.sharedRingBufferBytes > 0);

  distRunner.dispose();
}

console.log("=== All Phase 3 Distributed EMT Partitioning Tests Passed! ===");
