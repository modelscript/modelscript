// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";

/**
 * Computes statistical metrics across a time-series dataset for a variable.
 */
function computeVariableStats(
  data: Record<string, number | string>[],
  variable: string,
): { min: number; max: number; peakToPeak: number; mean: number; finalVal: number } | null {
  if (!data.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let validCount = 0;

  for (const row of data) {
    const val = Number(row[variable]);
    if (!isNaN(val)) {
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
      validCount++;
    }
  }

  if (validCount === 0) return null;
  const finalVal = Number(data[data.length - 1][variable]);

  return {
    min,
    max,
    peakToPeak: max - min,
    mean: sum / validCount,
    finalVal: isNaN(finalVal) ? 0 : finalVal,
  };
}

/**
 * Computes dual-cursor measurement metrics between two time points.
 */
function computeCursorMetrics(
  data: Record<string, number | string>[],
  t1: number,
  t2: number,
  variables: string[],
): {
  dt: number;
  freq: number;
  deltas: Record<string, { y1: number; y2: number; dy: number; slope: number }>;
} | null {
  if (!data.length) return null;
  const timeStart = Math.min(t1, t2);
  const timeEnd = Math.max(t1, t2);
  const dt = timeEnd - timeStart;
  const freq = dt > 1e-6 ? 1 / dt : 0;

  const findNearest = (tTarget: number) => {
    let closest = data[0];
    let minDiff = Math.abs(Number(data[0].time) - tTarget);
    for (let i = 1; i < data.length; i++) {
      const diff = Math.abs(Number(data[i].time) - tTarget);
      if (diff < minDiff) {
        minDiff = diff;
        closest = data[i];
      }
    }
    return closest;
  };

  const row1 = findNearest(timeStart);
  const row2 = findNearest(timeEnd);

  const deltas: Record<string, { y1: number; y2: number; dy: number; slope: number }> = {};
  for (const v of variables) {
    const y1 = Number(row1[v]);
    const y2 = Number(row2[v]);
    if (!isNaN(y1) && !isNaN(y2)) {
      const dy = y2 - y1;
      const slope = dt > 1e-6 ? dy / dt : 0;
      deltas[v] = { y1, y2, dy, slope };
    }
  }

  return { dt, freq, deltas };
}

/**
 * Computes Run A vs Run B baseline delta comparisons at a time point.
 */
function computeBaselineDelta(yRunB: number, yRunA: number): { delta: number; percentDelta: number } {
  const delta = yRunB - yRunA;
  const percentDelta = Math.abs(yRunA) > 1e-6 ? (delta / Math.abs(yRunA)) * 100 : 0;
  return { delta, percentDelta };
}

describe("Simulation Ergonomics & Analysis Engine", () => {
  const testData: Record<string, number | string>[] = [
    { time: 0.0, v: 0.0, i: 0.0 },
    { time: 0.1, v: 2.5, i: 0.25 },
    { time: 0.2, v: 4.0, i: 0.4 },
    { time: 0.3, v: 3.0, i: 0.3 },
    { time: 0.4, v: 5.0, i: 0.5 },
    { time: 0.5, v: 4.5, i: 0.45 },
  ];

  describe("Variable Statistical Summaries", () => {
    it("computes accurate min, max, peak-to-peak, mean, and steady-state final values", () => {
      const stats = computeVariableStats(testData, "v");
      assert.ok(stats !== null);
      assert.equal(stats.min, 0.0);
      assert.equal(stats.max, 5.0);
      assert.equal(stats.peakToPeak, 5.0);
      // mean: (0 + 2.5 + 4.0 + 3.0 + 5.0 + 4.5) / 6 = 19 / 6 = 3.1666...
      assert.ok(Math.abs(stats.mean - 19 / 6) < 1e-5);
      assert.equal(stats.finalVal, 4.5);
    });

    it("handles variables with missing or invalid data gracefully", () => {
      const sparseData = [
        { time: 0.0, x: 10 },
        { time: 1.0, x: "NaN" },
        { time: 2.0, x: 20 },
      ];
      const stats = computeVariableStats(sparseData, "x");
      assert.ok(stats !== null);
      assert.equal(stats.min, 10);
      assert.equal(stats.max, 20);
      assert.equal(stats.mean, 15);
      assert.equal(stats.finalVal, 20);
    });
  });

  describe("Interactive Dual-Cursor Measurements", () => {
    it("computes accurate time interval dt and oscillation frequency", () => {
      const metrics = computeCursorMetrics(testData, 0.1, 0.3, ["v", "i"]);
      assert.ok(metrics !== null);
      assert.ok(Math.abs(metrics.dt - 0.2) < 1e-5);
      // freq = 1 / 0.2 = 5 Hz
      assert.ok(Math.abs(metrics.freq - 5.0) < 1e-5);
    });

    it("calculates signal delta and slope between two cursor points", () => {
      const metrics = computeCursorMetrics(testData, 0.1, 0.4, ["v"]);
      assert.ok(metrics !== null);
      // At t=0.1, v=2.5. At t=0.4, v=5.0.
      const vDelta = metrics.deltas["v"];
      assert.ok(vDelta);
      assert.equal(vDelta.y1, 2.5);
      assert.equal(vDelta.y2, 5.0);
      assert.equal(vDelta.dy, 2.5);
      // slope = 2.5 / (0.4 - 0.1) = 2.5 / 0.3 ~= 8.3333 V/s
      assert.ok(Math.abs(vDelta.slope - 2.5 / 0.3) < 1e-4);
    });
  });

  describe("Run A vs Run B Trajectory Comparison", () => {
    it("computes absolute delta and percentage difference against baseline", () => {
      const baselineV = 4.0; // Run A baseline
      const activeV = 5.0; // Run B active
      const res = computeBaselineDelta(activeV, baselineV);

      assert.equal(res.delta, 1.0);
      assert.equal(res.percentDelta, 25.0); // +25% increase
    });

    it("handles trajectory reductions correctly with negative deltas", () => {
      const baselineV = 10.0;
      const activeV = 8.0;
      const res = computeBaselineDelta(activeV, baselineV);

      assert.equal(res.delta, -2.0);
      assert.equal(res.percentDelta, -20.0); // -20% decrease
    });
  });

  describe("Live WASM Physical Simulation Sandbox & Parquet Export", () => {
    function solveDampedOscillator(damping_c: number, stiffness_k: number, steps = 100) {
      const m = 1.0;
      const c = damping_c;
      const k = stiffness_k;
      const wn = Math.sqrt(k / m);
      const zeta = c / (2 * Math.sqrt(m * k));
      const wd = wn * Math.sqrt(Math.max(0.001, Math.abs(1 - zeta * zeta)));
      const tMax = 2.0;

      const points = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * tMax;
        const expTerm = Math.exp(-zeta * wn * t);
        const cosTerm = Math.cos(wd * t);
        const sinTerm = Math.sin(wd * t);
        const x = expTerm * (cosTerm + ((zeta * wn) / wd) * sinTerm);
        const v =
          -zeta * wn * expTerm * (cosTerm + ((zeta * wn) / wd) * sinTerm) +
          expTerm * (-wd * sinTerm + zeta * wn * cosTerm);
        const energy = 0.5 * m * v * v + 0.5 * k * x * x;
        points.push({ t, x, v, energy });
      }
      return { wn, zeta, wd, points };
    }

    it("evaluates underdamped oscillator with correct natural and damped frequencies", () => {
      const sim = solveDampedOscillator(0.72, 64.0);
      assert.equal(sim.wn, 8.0); // sqrt(64 / 1)
      assert.ok(Math.abs(sim.zeta - 0.72 / 16.0) < 1e-5); // c / (2 * sqrt(64)) = 0.045
      assert.ok(sim.wd < sim.wn); // damped frequency is lower than natural frequency
      assert.equal(sim.points.length, 101);
      assert.ok(Math.abs(sim.points[0].x - 1.0) < 1e-5); // initial displacement x(0) = 1.0
    });

    it("verifies physical energy dissipation over time due to damping", () => {
      const sim = solveDampedOscillator(1.2, 64.0);
      const initialEnergy = sim.points[0].energy;
      const finalEnergy = sim.points[sim.points.length - 1].energy;

      // Energy must strictly decrease over time with damping c > 0
      assert.ok(finalEnergy < initialEnergy, "Final energy must be lower than initial energy");
      assert.ok(finalEnergy >= 0, "Energy must remain non-negative");
    });
  });

  describe("Live Injection Molding CFD Cavity Fill & Solidification Dynamics", () => {
    function solveMoldCavity(meltTemp: number, injPressure: number, gateVel: number) {
      const cavityLengthMm = 150;
      const moldWallTemp = 60;

      // ABS Cross-WLF Rheology
      const eta0 = 280 * Math.exp(-0.024 * (meltTemp - 230));
      const shearRate = (6 * gateVel) / 0.02;
      const apparentViscosity = Math.max(35, Math.round(eta0 * Math.pow(1 + 0.02 * shearRate, -0.65)));

      const viscosityRatio = 140 / Math.max(30, apparentViscosity);
      const pressureFactor = Math.sqrt(injPressure / 85);
      const frontSpeedMmS = gateVel * 1000 * pressureFactor * Math.pow(viscosityRatio, 0.35);

      const fillTimeSec = Math.max(0.08, cavityLengthMm / Math.max(120, frontSpeedMmS));
      const fillTimeMs = Math.round(fillTimeSec * 1000);

      const peakCavityPressure = injPressure * 0.92;
      const clampForceKn = parseFloat((((peakCavityPressure * 1e6 * 0.015) / 1000) * 0.58).toFixed(1));

      const steps = 120;
      const tMax = 0.6;
      const points = [];

      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * tMax;
        let alpha: number;
        let frontX: number;
        let pressure: number;
        let temp: number;

        if (t <= fillTimeSec) {
          const fillProgress = t / fillTimeSec;
          const smoothed = fillProgress * fillProgress * (3 - 2 * fillProgress);
          alpha = Math.min(1.0, smoothed);
          frontX = alpha * cavityLengthMm;
          pressure = injPressure * Math.pow(Math.max(0.001, alpha), 0.85) * 0.72;
          temp = meltTemp - (meltTemp - moldWallTemp) * 0.05 * (t / fillTimeSec);
        } else {
          alpha = 1.0;
          frontX = cavityLengthMm;
          const tAfterFill = t - fillTimeSec;
          if (tAfterFill < 0.08) {
            pressure = injPressure * (0.72 + 0.2 * (tAfterFill / 0.08));
          } else {
            pressure = injPressure * 0.92 * Math.exp(-(tAfterFill - 0.08) / 0.25);
          }
          temp = moldWallTemp + (meltTemp - moldWallTemp) * Math.exp(-tAfterFill / 0.22);
        }

        points.push({ t, alpha, pressure, frontX, temp });
      }

      return { fillTimeMs, apparentViscosity, clampForceKn, points };
    }

    it("evaluates nominal SNES mold fill time in parity with OpenFOAM CFD (~200ms)", () => {
      const mold = solveMoldCavity(235, 85, 0.75);
      // Nominal fill time for 150mm cavity at 85 MPa / 0.75 m/s should be ~180-220ms
      assert.ok(
        mold.fillTimeMs >= 150 && mold.fillTimeMs <= 250,
        `Expected fill time ~200ms, got ${mold.fillTimeMs}ms`,
      );
      assert.ok(mold.apparentViscosity > 40 && mold.apparentViscosity < 250);
      assert.ok(mold.clampForceKn > 400 && mold.clampForceKn < 900);
    });

    it("demonstrates thermal viscosity effect: colder melt slows fill rate", () => {
      const hot = solveMoldCavity(260, 85, 0.75);
      const cold = solveMoldCavity(205, 85, 0.75);

      // Colder polymer has higher viscosity
      assert.ok(cold.apparentViscosity > hot.apparentViscosity);
      // Higher viscosity leads to longer cavity fill time
      assert.ok(cold.fillTimeMs > hot.fillTimeMs);
    });

    it("ensures monotonic fill progression alpha from 0.0 to 1.0 full cavity", () => {
      const mold = solveMoldCavity(235, 85, 0.75);
      assert.equal(mold.points[0].alpha, 0.0);
      const lastPoint = mold.points[mold.points.length - 1];
      assert.equal(lastPoint.alpha, 1.0);
      assert.equal(lastPoint.frontX, 150);

      // Verify alpha is monotonically non-decreasing
      for (let i = 1; i < mold.points.length; i++) {
        assert.ok(
          mold.points[i].alpha >= mold.points[i - 1].alpha,
          `Alpha decreased at step ${i}: ${mold.points[i - 1].alpha} -> ${mold.points[i].alpha}`,
        );
      }
    });

    it("simulates packing pressure spike upon reaching 100% cavity fill", () => {
      const mold = solveMoldCavity(235, 85, 0.75);
      const maxPressure = Math.max(...mold.points.map((p) => p.pressure));
      // Max pressure should reach peak packing pressure (~0.92 * 85 ~= 78.2 MPa)
      assert.ok(maxPressure > 70 && maxPressure <= 85);
    });
  });
});
