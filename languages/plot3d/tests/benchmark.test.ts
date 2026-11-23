// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPlot3dStdLibWasmBytes } from "../src/catalog/plot3d-std-lib-data.js";
import { conservativeToPrimitive, primitiveToConservative } from "../src/solver/flow.js";
import { computeGridMetrics } from "../src/solver/metrics.js";
import {
  generateIsentropicNozzlePlot3d,
  isentropicAreaRatioFromMach,
  solveIsentropicMachFromAreaRatio,
  verifyIsentropicNozzle,
} from "../src/solver/nozzle.js";
import { plot3dIndex, type Plot3dGrid } from "../src/types.js";

function buildCartesianMultiBlockBox(): { grid: Plot3dGrid; exactVolume: number } {
  // Block 0: x in [0, 2], y in [0, 3], z in [0, 4] => V = 24
  // Block 1: x in [2, 5], y in [0, 3], z in [0, 4] => V = 36
  // Total exact volume = 60.0
  const makeBlock = (index: number, x0: number, x1: number, ni: number, nj: number, nk: number) => {
    const n = ni * nj * nk;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const z = new Float64Array(n);
    for (let k = 0; k < nk; k++) {
      for (let j = 0; j < nj; j++) {
        for (let i = 0; i < ni; i++) {
          const idx = plot3dIndex(i, j, k, ni, nj);
          x[idx] = x0 + ((x1 - x0) * i) / (ni - 1);
          y[idx] = (3.0 * j) / (nj - 1);
          z[idx] = (4.0 * k) / (nk - 1);
        }
      }
    }
    return { index, ni, nj, nk, x, y, z };
  };

  return {
    grid: {
      format: "ascii",
      dimension: "3d",
      multiBlock: true,
      hasIblank: false,
      blocks: [makeBlock(0, 0, 2, 5, 4, 5), makeBlock(1, 2, 5, 7, 4, 5)],
    },
    exactVolume: 60.0,
  };
}

describe("PLOT3D CFD Verification Benchmarks", () => {
  it("achieves exact 3D multi-block hexahedral mesh volume parity (relErr < 1e-12)", () => {
    const { grid, exactVolume } = buildCartesianMultiBlockBox();
    const metrics = computeGridMetrics(grid);

    const relErr = Math.abs(metrics.totalVolume - exactVolume) / exactVolume;
    assert.strictEqual(metrics.invertedCellCount, 0);
    assert.ok(metrics.minJacobian > 0);
    assert.ok(relErr < 1e-12, `Expected volume relErr < 1e-12, got ${relErr}`);
    assert.strictEqual(metrics.totalCellCount, 4 * 3 * 4 + 6 * 3 * 4);
  });

  it("verifies supersonic converging-diverging nozzle Mach, p0/p, and mass-conservation parity", () => {
    const cfg = {
      ni: 25,
      nj: 5,
      nk: 5,
      length: 1.0,
      throatArea: 0.1,
      areaRatioMax: 2.5,
      p0: 600_000.0,
      t0: 350.0,
      gamma: 1.4,
      supersonicExit: true,
      numBlocks: 2,
    };

    const { grid, solution } = generateIsentropicNozzlePlot3d(cfg);
    const res = verifyIsentropicNozzle(grid, solution, cfg);

    assert.ok(res.throatMach > 0.99 && res.throatMach < 1.01, `Expected throat Mach ~1.0, got ${res.throatMach}`);
    assert.ok(res.exitMach > 2.4 && res.exitMach < 2.5, `Expected supersonic exit Mach ~2.44, got ${res.exitMach}`);
    assert.ok(res.maxMachRelErr < 1e-10, `maxMachRelErr=${res.maxMachRelErr}`);
    assert.ok(res.rmseMach < 1e-10, `rmseMach=${res.rmseMach}`);
    assert.ok(res.maxTotalPressureRatioRelErr < 1e-10, `maxPrRelErr=${res.maxTotalPressureRatioRelErr}`);
    assert.ok(res.rmseTotalPressureRatio < 1e-10, `rmsePr=${res.rmseTotalPressureRatio}`);
    assert.ok(res.massConservationRelErr < 1e-10, `massConservationRelErr=${res.massConservationRelErr}`);
  });

  it("verifies purely subsonic nozzle Mach, p0/p, and mass-conservation parity", () => {
    const cfg = {
      ni: 21,
      nj: 4,
      nk: 4,
      areaRatioMax: 2.0,
      gamma: 1.4,
      supersonicExit: false,
      numBlocks: 1,
    };
    const { grid, solution } = generateIsentropicNozzlePlot3d(cfg);
    const res = verifyIsentropicNozzle(grid, solution, cfg);

    assert.ok(res.exitMach < 0.35 && res.exitMach > 0.25, `Expected subsonic exit Mach ~0.306, got ${res.exitMach}`);
    assert.ok(res.maxMachRelErr < 1e-10);
    assert.ok(res.rmseTotalPressureRatio < 1e-10);
    assert.ok(res.massConservationRelErr < 1e-10);
  });

  it("matches cleanroom AssemblyScript stdlib WASM kernel against analytical isentropic relations", async () => {
    const wasmBytes = getPlot3dStdLibWasmBytes();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      plot3dStaticPressure: (rho: number, rhou: number, rhov: number, rhow: number, e: number, g: number) => number;
      plot3dMachNumber: (rho: number, rhou: number, rhov: number, rhow: number, e: number, g: number) => number;
      plot3dTotalPressureRatio: (m: number, g: number) => number;
    };

    const gamma = 1.4;
    const mach = solveIsentropicMachFromAreaRatio(2.2, gamma, true);
    assert.ok(Math.abs(isentropicAreaRatioFromMach(mach, gamma) - 2.2) < 1e-11);

    const rho = 1.2;
    const p = 120_000.0;
    const a = Math.sqrt((gamma * p) / rho);
    const u = mach * a;
    const q = primitiveToConservative(rho, u, 0, 0, p, gamma);
    const prim = conservativeToPrimitive(q, { gamma });

    const wasmP = exports.plot3dStaticPressure(q.rho, q.rhou, q.rhov, q.rhow, q.energy, gamma);
    const wasmM = exports.plot3dMachNumber(q.rho, q.rhou, q.rhov, q.rhow, q.energy, gamma);
    const wasmPr = exports.plot3dTotalPressureRatio(mach, gamma);
    const exactPr = Math.pow(1 + 0.5 * (gamma - 1) * mach * mach, gamma / (gamma - 1));

    assert.ok(Math.abs(wasmP - prim.pressure) / prim.pressure < 1e-12);
    assert.ok(Math.abs(wasmM - prim.mach) / prim.mach < 1e-12);
    assert.ok(Math.abs(wasmPr - exactPr) / exactPr < 1e-12);
  });
});
