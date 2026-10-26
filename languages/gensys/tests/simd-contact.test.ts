// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getWasmContactBridge,
  pureTsSolveFastsim,
  solveFastsimSimd,
  solvePolachBatchSimd,
  supportsWasmSimd,
  type FastsimContactInput,
  type PolachContactInput,
} from "../src/index.js";

describe("WASM SIMD128 Contact Kernel Acceleration", () => {
  const bridge = getWasmContactBridge();

  it("should confirm WASM SIMD128 vector capabilities in runtime environment", () => {
    assert.equal(supportsWasmSimd(), true);
    assert.equal(bridge.supportsSimd, true);
    assert.equal(typeof bridge.exports.contact_fastsim_simd, "function");
    assert.equal(typeof bridge.exports.contact_batch_fastsim_simd, "function");
    assert.equal(typeof bridge.exports.contact_batch_polach_simd, "function");
    assert.equal(typeof bridge.exports.contact_lut_interp_simd, "function");
  });

  describe("FASTSIM SIMD128 Tangential Rolling Contact Parity", () => {
    const sampleInput: FastsimContactInput = {
      normalForce: 60000, // 60 kN vertical load
      longitudinalCreep: 0.002,
      lateralCreep: 0.003,
      spin: 0.04,
      ellipseSemiMajor: 0.006,
      ellipseSemiMinor: 0.005,
      shearModulus: 8.2e10,
      poissonRatio: 0.28,
      frictionCoeff: 0.38,
    };

    it("should achieve numerical parity between scalar WASM and SIMD128 FASTSIM", () => {
      const scalarRes = bridge.solveFastsim(sampleInput, 25);
      const simdRes = bridge.solveFastsimSimd(sampleInput, 25);
      const helperRes = solveFastsimSimd(sampleInput, 25);

      // Verify SIMD matches scalar within numerical integration rounding
      assert.ok(Math.abs(simdRes.fx - scalarRes.fx) < 1e-6, `fx mismatch: ${simdRes.fx} vs ${scalarRes.fx}`);
      assert.ok(Math.abs(simdRes.fy - scalarRes.fy) < 1e-6, `fy mismatch: ${simdRes.fy} vs ${scalarRes.fy}`);
      assert.ok(Math.abs(simdRes.mz - scalarRes.mz) < 1e-6, `mz mismatch: ${simdRes.mz} vs ${scalarRes.mz}`);
      assert.ok(Math.abs(simdRes.adhesionRatio - scalarRes.adhesionRatio) < 1e-6);

      // Helper function matches
      assert.equal(helperRes.fx, simdRes.fx);
      assert.equal(helperRes.fy, simdRes.fy);
      assert.equal(helperRes.mz, simdRes.mz);
    });

    it("should match pure TypeScript reference within 0.1% tolerance", () => {
      const pureTs = pureTsSolveFastsim(sampleInput, 30);
      const simdRes = bridge.solveFastsimSimd(sampleInput, 30);

      const relErrFx = Math.abs(simdRes.fx - pureTs.fx) / Math.abs(pureTs.fx);
      const relErrFy = Math.abs(simdRes.fy - pureTs.fy) / Math.abs(pureTs.fy);
      const relErrMz = Math.abs(simdRes.mz - pureTs.mz) / Math.abs(pureTs.mz);

      assert.ok(relErrFx < 1e-4, `relErrFx: ${relErrFx}`);
      assert.ok(relErrFy < 1e-4, `relErrFy: ${relErrFy}`);
      assert.ok(relErrMz < 1e-3, `relErrMz: ${relErrMz}`);
    });

    it("should handle degenerate and boundary contact conditions in SIMD", () => {
      // Zero normal force
      const zeroNormal = bridge.solveFastsimSimd({ ...sampleInput, normalForce: 0 }, 20);
      assert.equal(zeroNormal.fx, 0);
      assert.equal(zeroNormal.fy, 0);
      assert.equal(zeroNormal.mz, 0);
      assert.equal(zeroNormal.adhesionRatio, 0);

      // Negative semi-axis
      const negAxis = bridge.solveFastsimSimd({ ...sampleInput, ellipseSemiMajor: -0.005 }, 20);
      assert.equal(negAxis.fx, 0);
      assert.equal(negAxis.fy, 0);
      assert.equal(negAxis.mz, 0);
      assert.equal(negAxis.adhesionRatio, 0);
    });
  });

  describe("Batched FASTSIM SIMD Acceleration", () => {
    it("should evaluate multi-patch train contact patches with SIMD parity and measure throughput", () => {
      const patchCount = 32;
      const inputs: FastsimContactInput[] = [];

      for (let i = 0; i < patchCount; i++) {
        const factor = (i + 1) / patchCount;
        inputs.push({
          normalForce: 50000 + 15000 * factor,
          longitudinalCreep: 0.001 * (i % 3 === 0 ? -1 : 1) * factor,
          lateralCreep: 0.002 * (i % 2 === 0 ? 1 : -1) * factor,
          spin: 0.03 * ((i % 4) - 1.5) * factor,
          ellipseSemiMajor: 0.005 + 0.002 * factor,
          ellipseSemiMinor: 0.004 + 0.0015 * factor,
          shearModulus: 8.2e10,
          poissonRatio: 0.28,
          frictionCoeff: 0.35 + 0.05 * (i % 3),
        });
      }

      const scalarResults = bridge.batchFastsim(inputs, 20);
      const simdResults = bridge.batchFastsimSimd(inputs, 20);

      assert.equal(simdResults.length, patchCount);
      for (let i = 0; i < patchCount; i++) {
        const s = scalarResults[i]!;
        const v = simdResults[i]!;
        assert.ok(Math.abs(v.fx - s.fx) < 1e-6, `Patch ${i} fx mismatch`);
        assert.ok(Math.abs(v.fy - s.fy) < 1e-6, `Patch ${i} fy mismatch`);
        assert.ok(Math.abs(v.mz - s.mz) < 1e-6, `Patch ${i} mz mismatch`);
        assert.ok(Math.abs(v.adhesionRatio - s.adhesionRatio) < 1e-6);
      }

      // Benchmark throughput over 1000 evaluations
      const benchmarkBatch: FastsimContactInput[] = [];
      for (let i = 0; i < 200; i++) {
        benchmarkBatch.push(inputs[i % patchCount]!);
      }

      const tStartSimd = performance.now();
      for (let r = 0; r < 5; r++) {
        bridge.batchFastsimSimd(benchmarkBatch, 15);
      }
      const tSimdMs = performance.now() - tStartSimd;

      const tStartScalar = performance.now();
      for (let r = 0; r < 5; r++) {
        bridge.batchFastsim(benchmarkBatch, 15);
      }
      const tScalarMs = performance.now() - tStartScalar;

      // Ensure both executed reliably
      assert.ok(tSimdMs > 0);
      assert.ok(tScalarMs > 0);
    });
  });

  describe("2-Wide SIMD128 Polach Creep Solver", () => {
    const basePolach: PolachContactInput = {
      normalForce: 65000,
      longitudinalCreep: 0.0025,
      lateralCreep: 0.0018,
      wheelVelocity: 40.0,
      ellipseSemiMajor: 0.0062,
      ellipseSemiMinor: 0.0051,
      shearModulus: 8.2e10,
      poissonRatio: 0.28,
      staticFriction: 0.4,
      kineticFrictionRatio: 0.75,
      frictionDecayRate: 0.4,
    };

    it("should achieve exact parity between scalar and 2-wide SIMD Polach for even patch count", () => {
      const inputs: PolachContactInput[] = [
        { ...basePolach, longitudinalCreep: 0.002, lateralCreep: 0.001 },
        { ...basePolach, longitudinalCreep: -0.002, lateralCreep: -0.001 },
        { ...basePolach, normalForce: 50000, wheelVelocity: 60.0 },
        { ...basePolach, normalForce: 75000, wheelVelocity: 20.0 },
      ];

      const scalarRes = bridge.batchPolach(inputs);
      const simdRes = bridge.batchPolachSimd(inputs);
      const helperRes = solvePolachBatchSimd(inputs);

      assert.equal(simdRes.length, 4);
      for (let i = 0; i < 4; i++) {
        const s = scalarRes[i]!;
        const v = simdRes[i]!;
        assert.ok(Math.abs(v.fx - s.fx) < 1e-9, `Polach patch ${i} fx mismatch`);
        assert.ok(Math.abs(v.fy - s.fy) < 1e-9, `Polach patch ${i} fy mismatch`);
        assert.ok(Math.abs(v.resultantForce - s.resultantForce) < 1e-9);
        assert.ok(Math.abs(v.effectiveFrictionCoeff - s.effectiveFrictionCoeff) < 1e-9);
        assert.ok(Math.abs(v.adhesionRatio - s.adhesionRatio) < 1e-9);

        assert.equal(helperRes[i]!.fx, v.fx);
      }
    });

    it("should handle odd patch count with trailing single patch fallback", () => {
      const inputs: PolachContactInput[] = [
        { ...basePolach, longitudinalCreep: 0.003, lateralCreep: 0.002 },
        { ...basePolach, longitudinalCreep: 0.001, lateralCreep: -0.001 },
        { ...basePolach, longitudinalCreep: 0.0, lateralCreep: 0.004 }, // trailing odd patch (index 2)
      ];

      const scalarRes = bridge.batchPolach(inputs);
      const simdRes = bridge.batchPolachSimd(inputs);

      assert.equal(simdRes.length, 3);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(simdRes[i]!.fx - scalarRes[i]!.fx) < 1e-9);
        assert.ok(Math.abs(simdRes[i]!.fy - scalarRes[i]!.fy) < 1e-9);
        assert.ok(Math.abs(simdRes[i]!.resultantForce - scalarRes[i]!.resultantForce) < 1e-9);
      }
    });

    it("should correctly handle zero creep and zero load edge cases in 2-wide SIMD", () => {
      const inputs: PolachContactInput[] = [
        { ...basePolach, longitudinalCreep: 0, lateralCreep: 0 },
        { ...basePolach, normalForce: 0 },
      ];

      const simdRes = bridge.batchPolachSimd(inputs);
      assert.equal(simdRes[0]!.fx, 0);
      assert.equal(simdRes[0]!.fy, 0);
      assert.equal(simdRes[0]!.resultantForce, 0);
      assert.equal(simdRes[0]!.effectiveFrictionCoeff, basePolach.staticFriction);

      assert.equal(simdRes[1]!.fx, 0);
      assert.equal(simdRes[1]!.fy, 0);
      assert.equal(simdRes[1]!.resultantForce, 0);
    });
  });

  describe("Vectorized Profile LUT SIMD Interpolation", () => {
    it("should simultaneously interpolate 2-point left/right values with SIMD instructions", () => {
      const val0L = 10.5;
      const val0R = -4.2;
      const val1L = 22.1;
      const val1R = 8.6;

      const testFractions = [0.0, 0.25, 0.5, 0.725, 1.0];

      for (const frac of testFractions) {
        const [interpL, interpR] = bridge.interpolateProfileLutSimd(frac, val0L, val0R, val1L, val1R);

        const expectedL = val0L + frac * (val1L - val0L);
        const expectedR = val0R + frac * (val1R - val0R);

        assert.ok(Math.abs(interpL - expectedL) < 1e-12, `Fraction ${frac} L mismatch`);
        assert.ok(Math.abs(interpR - expectedR) < 1e-12, `Fraction ${frac} R mismatch`);
      }
    });
  });
});
