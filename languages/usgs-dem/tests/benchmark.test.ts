// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTerrainMesh } from "../src/cad/index.js";
import { generateGaussianHillDem, generateInclinedPlaneDem, generateVValleyDem } from "../src/catalog/index.js";
import {
  computeD8Flow,
  computeHornSlopeAspect,
  computeHypsometricIntegral,
  computeTerrainGridMetrics,
  extractElevationProfile,
  interpolateElevation,
} from "../src/solver/index.js";

describe("@modelscript/usgs-dem analytical geomorphometry benchmarks", () => {
  it("recovers exact analytical slope and aspect on an inclined plane (relErr < 1e-10)", () => {
    const gradX = -0.15;
    const gradY = -0.08;
    const model = generateInclinedPlaneDem({
      numCols: 15,
      numRows: 15,
      dx: 30,
      dy: 30,
      baseElevation: 500,
      gradX,
      gradY,
    });

    const expectedSlopeDeg = (Math.atan(Math.hypot(gradX, gradY)) * 180) / Math.PI;
    const expectedAspectDeg = ((Math.atan2(-gradX, -gradY) * 180) / Math.PI + 360) % 360;

    // Check interior Horn 3x3 stencil and full grid metrics
    const center = computeHornSlopeAspect(model, 7, 7);
    const slopeRelErr = Math.abs(center.slopeDeg - expectedSlopeDeg) / expectedSlopeDeg;
    const aspectRelErr = Math.abs(center.aspectDeg - expectedAspectDeg) / expectedAspectDeg;

    assert.ok(slopeRelErr < 1e-10, `Expected slope relErr < 1e-10, got ${slopeRelErr}`);
    assert.ok(aspectRelErr < 1e-10, `Expected aspect relErr < 1e-10, got ${aspectRelErr}`);

    const gridMetrics = computeTerrainGridMetrics(model);
    const meanRelErr = Math.abs(gridMetrics.meanSlopeDeg - expectedSlopeDeg) / expectedSlopeDeg;
    assert.ok(meanRelErr < 1e-10, `Expected meanSlopeDeg relErr < 1e-10, got ${meanRelErr}`);

    // Bilinear interpolation on a linear plane is exact
    const xTest = 137.5;
    const yTest = 221.25;
    const zInterp = interpolateElevation(model, xTest, yTest, true);
    const zExact = 500 + gradX * xTest + gradY * yTest;
    assert.ok(Math.abs(zInterp - zExact) / Math.abs(zExact) < 1e-12);
  });

  it("matches analytical peak, volume, and hypsometric integral on a Gaussian hill (rmse < 1e-3)", () => {
    const numCols = 81;
    const numRows = 81;
    const dx = 10;
    const dy = 10;
    const baseElevation = 1000;
    const amplitude = 500;
    const sigma = 80;

    const model = generateGaussianHillDem({
      numCols,
      numRows,
      dx,
      dy,
      baseElevation,
      amplitude,
      sigma,
    });

    const hypso = computeHypsometricIntegral(model);
    const mesh = buildTerrainMesh(model, { baseElevation, watertight: false });

    // Analytical peak
    assert.ok(Math.abs(hypso.maxElevation - (baseElevation + amplitude)) < 1e-9);

    // Analytical volume above baseElevation: 2 * pi * sigma^2 * H
    const analyticalVolume = 2 * Math.PI * sigma * sigma * amplitude;
    const volRelErr = Math.abs(mesh.volumeAboveBase - analyticalVolume) / analyticalVolume;
    assert.ok(volRelErr < 1e-3, `Expected Gaussian volume relErr < 1e-3, got ${volRelErr}`);

    // Analytical hypsometric integral over the N x N grid domain: (2 * pi * sigma^2) / (N * dx)^2
    const analyticalHI = (2 * Math.PI * sigma * sigma) / (numCols * dx * numRows * dy);
    const hiErr = Math.abs(hypso.hypsometricIntegral - analyticalHI);
    assert.ok(hiErr < 1e-3, `Expected hypsometric integral err < 1e-3, got ${hiErr}`);

    // Cross-section profile through the summit matches analytical Gaussian curve
    const yc = ((numRows - 1) * dy) / 2;
    const xc = ((numCols - 1) * dx) / 2;
    const profile = extractElevationProfile(model, 0, yc, (numCols - 1) * dx, yc, 41, true);
    let sqErrSum = 0;
    for (const pt of profile) {
      const zExact = baseElevation + amplitude * Math.exp(-((pt.x - xc) * (pt.x - xc)) / (2 * sigma * sigma));
      const diff = (pt.elevation - zExact) / amplitude;
      sqErrSum += diff * diff;
    }
    const normRmse = Math.sqrt(sqErrSum / profile.length);
    assert.ok(normRmse < 1e-3, `Expected Gaussian profile normalized RMSE < 1e-3, got ${normRmse}`);
  });

  it("verifies D8 steepest-descent flow direction and watershed accumulation parity on a V-valley", () => {
    const numCols = 11;
    const numRows = 11;
    const model = generateVValleyDem({
      numCols,
      numRows,
      dx: 30,
      dy: 30,
      baseElevation: 200,
      sideSlope: 0.2,
      channelSlope: 0.04,
    });

    const d8 = computeD8Flow(model);
    const centerCol = Math.floor(numCols / 2);

    // West flank drains East (1) or Southeast (2)
    for (let r = 1; r < numRows; r++) {
      for (let c = 0; c < centerCol; c++) {
        const dir = d8.flowDirection[r * numCols + c]!;
        assert.ok(dir === 1 || dir === 2, `West flank (${r},${c}) expected E(1) or SE(2), got ${dir}`);
      }
    }

    // East flank drains West (16) or Southwest (8)
    for (let r = 1; r < numRows; r++) {
      for (let c = centerCol + 1; c < numCols; c++) {
        const dir = d8.flowDirection[r * numCols + c]!;
        assert.ok(dir === 16 || dir === 8, `East flank (${r},${c}) expected W(16) or SW(8), got ${dir}`);
      }
    }

    // Central thalweg drains due South (4)
    for (let r = 1; r < numRows; r++) {
      const dir = d8.flowDirection[r * numCols + centerCol]!;
      assert.equal(dir, 4, `Thalweg (${r},${centerCol}) expected S(4), got ${dir}`);
    }

    // Entire watershed converges to the southern thalweg outlet (r = 0, c = centerCol)
    assert.equal(d8.outletIndex, centerCol);
    assert.equal(d8.maxAccumulation, numCols * numRows);
  });
});
