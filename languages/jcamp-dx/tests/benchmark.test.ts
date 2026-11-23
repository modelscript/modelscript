// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeXyData, encodeAsdf } from "../src/parser/asdf.js";
import {
  absorbanceToTransmittance,
  findSpectralPeaks,
  gaussianLineShape,
  integrateBand,
  savitzkyGolaySmooth,
  transmittanceToAbsorbance,
} from "../src/solver/spectroscopy.js";
import type { AsdfMode, JcampDataPoint } from "../src/types.js";

describe("@modelscript/jcamp-dx Analytical Benchmarks & Numerical Parity", () => {
  it("achieves exact round-trip parity (relErr < 1e-10) for SQZ, DIF, DUP, and DIFDUP", () => {
    const n = 256;
    const yFactor = 1e-4;
    const points: JcampDataPoint[] = [];
    for (let i = 0; i < n; i++) {
      const x = 4000 - i * 4;
      // Synthetic multi-band IR absorbance spectrum quantized to yFactor
      const rawA =
        gaussianLineShape(x, 3380, 0.85, 80) +
        gaussianLineShape(x, 2925, 0.65, 30) +
        gaussianLineShape(x, 1715, 1.15, 18);
      const yQuant = Math.round(rawA / yFactor) * yFactor;
      points.push({ x, y: yQuant });
    }

    const modes: AsdfMode[] = ["SQZ", "DIF", "DUP", "DIFDUP"];
    for (const mode of modes) {
      const encoded = encodeAsdf(points, { mode, xFactor: 1, yFactor, pointsPerLine: 10 });
      const decoded = decodeXyData(encoded, {
        xFactor: 1,
        yFactor,
        firstX: points[0]!.x,
        lastX: points[points.length - 1]!.x,
      });

      assert.strictEqual(decoded.checkpointErrors.length, 0, `${mode} checkpoint error`);
      assert.strictEqual(decoded.points.length, points.length, `${mode} length mismatch`);

      let maxRelErr = 0;
      for (let i = 0; i < points.length; i++) {
        const denom = Math.max(1e-6, Math.abs(points[i]!.y));
        const relErr = Math.abs(decoded.points[i]!.y - points[i]!.y) / denom;
        if (relErr > maxRelErr) maxRelErr = relErr;
      }
      assert.ok(maxRelErr < 1e-10, `${mode} maxRelErr=${maxRelErr} >= 1e-10`);
    }
  });

  it("verifies Beer-Lambert A = -log10(T) round-trip and exactness (rmse < 1e-12)", () => {
    const ts = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    let sqErr = 0;
    for (const t of ts) {
      const a = transmittanceToAbsorbance(t);
      const expectedA = -Math.log10(t);
      sqErr += (a - expectedA) ** 2;
      const tBack = absorbanceToTransmittance(a);
      sqErr += (tBack - t) ** 2;
    }
    const rmse = Math.sqrt(sqErr / (2 * ts.length));
    assert.ok(rmse < 1e-12, `Beer-Lambert RMSE=${rmse} >= 1e-12`);
  });

  it("verifies Gaussian peak integral int exp(-x^2 / (2*sigma^2)) dx = sigma * sqrt(2*pi) (rmse < 1e-4)", () => {
    const sigmas = [1.0, 2.5, 5.0, 12.0];
    let sqErr = 0;

    for (const sigma of sigmas) {
      const x0 = 1715.0;
      const span = 8 * sigma;
      const steps = 1000;
      const dx = (2 * span) / steps;
      const pts: JcampDataPoint[] = [];
      for (let i = 0; i <= steps; i++) {
        const x = x0 - span + i * dx;
        pts.push({ x, y: gaussianLineShape(x, x0, 1.0, sigma) });
      }
      const numericalArea = integrateBand(pts);
      const exactArea = sigma * Math.sqrt(2 * Math.PI);
      const relErr = (numericalArea - exactArea) / exactArea;
      sqErr += relErr * relErr;
    }

    const rmse = Math.sqrt(sqErr / sigmas.length);
    assert.ok(rmse < 1e-4, `Gaussian integral relative RMSE=${rmse} >= 1e-4`);
  });

  it("detects prominent peaks and preserves quadratic signal under Savitzky-Golay smoothing", () => {
    const pts: JcampDataPoint[] = [];
    for (let x = 1600; x <= 1800; x += 2) {
      const y = gaussianLineShape(x, 1715, 1.0, 10) + gaussianLineShape(x, 1650, 0.45, 8);
      pts.push({ x, y });
    }

    const peaks = findSpectralPeaks(pts, { mode: "maxima", minProminence: 0.1 });
    assert.strictEqual(peaks.length, 2);
    assert.ok(Math.abs(peaks[0]!.x - 1650) <= 2);
    assert.ok(Math.abs(peaks[1]!.x - 1715) <= 2);

    // Quadratic polynomial y = 0.001*(x-1700)^2 + 0.5 must be reproduced exactly in interior by SG(7, 2)
    const quad: JcampDataPoint[] = [];
    for (let i = 0; i < 30; i++) {
      quad.push({ x: i, y: 0.02 * i * i - 0.3 * i + 1.5 });
    }
    const smoothed = savitzkyGolaySmooth(quad, 7, 2);
    for (let i = 3; i < quad.length - 3; i++) {
      assert.ok(Math.abs(smoothed[i]!.y - quad[i]!.y) < 1e-10, `SG quadratic preservation failed at ${i}`);
    }
  });
});
