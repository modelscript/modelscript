// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { CfdPodSurrogate, CfdSnapshotCollector, type SnapshotMatrixDataset } from "../src/surrogates/index.js";

console.log("=== Testing Real-Time CFD POD-Galerkin Surrogate & Snapshot Pipeline ===");

// 1. Snapshot Collection across Parameter Space
const numCells = 16 * 8 * 8; // 1024 cells
const collector = new CfdSnapshotCollector(numCells);

// Synthesize flow field snapshots parameterized by inlet velocity U and pitch angle alpha
const velocities = [2.0, 4.0, 6.0, 8.0, 10.0];
const angles = [-5.0, 0.0, 5.0];

for (const U of velocities) {
  for (const alpha of angles) {
    const field = new Float32Array(numCells);

    // Synthesize velocity field with pitch-dependent shear and wake deflection
    for (let z = 0; z < 8; z++) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 16; x++) {
          const idx = (z * 8 + y) * 16 + x;
          const yDeflected = y - 3.5 - 0.2 * (alpha / 5.0) * (x / 16.0);
          const yNorm = yDeflected / 3.5;
          const zNorm = (z - 3.5) / 3.5;
          const rSq = yNorm * yNorm + zNorm * zNorm;
          const profile = Math.max(0.0, 1.0 - 0.5 * rSq);
          const wake = x > 6 ? 0.3 * Math.sin((x - 6) * 0.5 + alpha * 0.1) : 0.0;
          field[idx] = U * (profile - wake);
        }
      }
    }

    const rad = (alpha * Math.PI) / 180;
    const liftForce = 0.5 * 1.225 * U * U * (2.0 * Math.PI * rad) * 0.1;
    const dragForce = 0.5 * 1.225 * U * U * (0.05 + 0.4 * rad * rad) * 0.1;

    collector.record({ inletVelocity: U, pitchAngle: alpha }, field, collector.count * 0.1, { dragForce, liftForce });
  }
}

assert.strictEqual(collector.count, 15, "Should record 15 snapshots");
assert.strictEqual(collector.numFeatures, 1024, "Should record 1024 spatial features");

const dataset: SnapshotMatrixDataset = collector.toDataset();
assert.strictEqual(dataset.numSnapshots, 15);
assert.strictEqual(dataset.numFeatures, 1024);
assert.strictEqual(dataset.parameterNames.length, 2);
assert.strictEqual(dataset.scalarOutputNames.length, 2);
console.log("  ✓ Snapshot collector successfully compiled snapshot dataset (1024 features x 9 conditions).");

// 2. Train POD-Galerkin Surrogate via Sirovich Snapshot SVD
const surrogate = CfdPodSurrogate.train(dataset, {
  energyThreshold: 0.999,
  maxModes: 6,
  polynomialDegree: 2,
});

assert.ok(surrogate.numModes >= 1 && surrogate.numModes <= 6, `Retained modes: ${surrogate.numModes}`);
assert.ok(surrogate.capturedEnergy >= 0.999, `Captured energy: ${surrogate.capturedEnergy}`);
console.log(
  `  ✓ POD-Galerkin trained: ${surrogate.numModes} modes capture ${(surrogate.capturedEnergy * 100).toFixed(3)}% kinetic energy.`,
);

// Verify Eigenvalue decay
for (let i = 0; i < surrogate.eigenvalues.length - 1; i++) {
  assert.ok(
    surrogate.eigenvalues[i]! >= surrogate.eigenvalues[i + 1]! - 1e-10,
    "Eigenvalues must be sorted descending",
  );
}
console.log(`  ✓ Eigenvalue spectrum verified: leading λ_0 = ${surrogate.eigenvalues[0]?.toFixed(4)}.`);

// Verify Orthonormality of POD basis modes Phi^T Phi = I
for (let m1 = 0; m1 < surrogate.numModes; m1++) {
  for (let m2 = 0; m2 < surrogate.numModes; m2++) {
    let dot = 0.0;
    for (let i = 0; i < surrogate.numFeatures; i++) {
      dot +=
        surrogate.basisModes[m1 * surrogate.numFeatures + i]! * surrogate.basisModes[m2 * surrogate.numFeatures + i]!;
    }
    const expected = m1 === m2 ? 1.0 : 0.0;
    assert.ok(
      Math.abs(dot - expected) < 1e-4,
      `Mode orthonormality failure at (${m1}, ${m2}): got ${dot}, expected ${expected}`,
    );
  }
}
console.log("  ✓ Spatial POD modes are strictly orthonormal (Phi^T Phi = I).");

// 3. Fast Sub-Millisecond Evaluation Benchmark (<0.05 ms/eval)
const testParams = { inletVelocity: 6.0, pitchAngle: 0.0 };
const pred = surrogate.predict(testParams);

assert.strictEqual(pred.latent.length, surrogate.numModes);
assert.strictEqual(pred.field.length, 1024);
assert.ok(typeof pred.scalarOutputs["dragForce"] === "number");
assert.ok(typeof pred.scalarOutputs["liftForce"] === "number");

// Expected drag at U=6.0 m/s, alpha=0: 0.5 * 1.225 * 36.0 * 0.05 * 0.1 = 0.11025 N
const expectedDrag = 0.5 * 1.225 * 36.0 * 0.05 * 0.1;
const predictedDrag = pred.scalarOutputs["dragForce"]!;
const dragError = Math.abs(predictedDrag - expectedDrag) / expectedDrag;
assert.ok(dragError < 0.05, `Scalar drag prediction error (${(dragError * 100).toFixed(2)}%) exceeds 5%`);
console.log(
  `  ✓ Scalar aerodynamic prediction (U=6.0 m/s, α=0°): drag = ${predictedDrag.toFixed(5)} N (rel error: ${(dragError * 100).toFixed(4)}%).`,
);

// Benchmark 10,000 evaluations to verify sub-millisecond real-time capability
const numBenchEvals = 10000;
const t0 = performance.now();
for (let b = 0; b < numBenchEvals; b++) {
  surrogate.predict({ inletVelocity: 2.0 + (b % 80) * 0.1, pitchAngle: (b % 10) - 5.0 });
}
const elapsedMs = performance.now() - t0;
const avgEvalMs = elapsedMs / numBenchEvals;

console.log(
  `  ✓ Benchmark: ${numBenchEvals} evaluations in ${elapsedMs.toFixed(2)} ms -> ${(avgEvalMs * 1000).toFixed(2)} µs/eval (<0.05 ms requirement).`,
);
assert.ok(avgEvalMs < 0.05, `Surrogate evaluation time (${avgEvalMs.toFixed(4)} ms) exceeds 0.05 ms limit`);

// 4. Verification of Field Reconstruction Accuracy
// Test at U = 6.0, alpha = 0.0
const predExact = surrogate.predict({ inletVelocity: 6.0, pitchAngle: 0.0 });
let l2Error = 0.0;
let l2Norm = 0.0;

for (let z = 0; z < 8; z++) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (z * 8 + y) * 16 + x;
      const yNorm = (y - 3.5) / 3.5;
      const zNorm = (z - 3.5) / 3.5;
      const rSq = yNorm * yNorm + zNorm * zNorm;
      const profile = Math.max(0.0, 1.0 - 0.5 * rSq);
      const wake = x > 6 ? 0.3 * Math.sin((x - 6) * 0.5) : 0.0;
      const trueVal = 6.0 * (profile - wake);

      const diff = predExact.field[idx]! - trueVal;
      l2Error += diff * diff;
      l2Norm += trueVal * trueVal;
    }
  }
}

const relL2 = Math.sqrt(l2Error / l2Norm);
console.log(`  ✓ Field reconstruction relative L2 error at U=6.0 m/s: ${(relL2 * 100).toFixed(4)}%.`);
assert.ok(relL2 < 0.02, `Relative L2 error too high: ${relL2}`);

console.log("=== All CFD POD-Galerkin Surrogate Tests Passed Successfully! ===");
