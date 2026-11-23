// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIgesFile,
  computePolylineLength,
  evaluateCircularArc,
  evaluateIgesDocument,
  evaluateNurbsCurve,
  evaluateNurbsSurface,
  IDENTITY_TRANSFORM_124,
  IGES_UNIT_TO_METERS,
  parseIges,
  tessellateNurbsCurve,
  tessellateNurbsSurface,
} from "../src/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(Math.abs(expected), 1e-12);
  return Math.abs(actual - expected) / denom;
}

function rmse(actual: readonly number[], expected: readonly number[]): number {
  assert.equal(actual.length, expected.length);
  if (actual.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = actual[i]! - expected[i]!;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / actual.length);
}

describe("@modelscript/iges — Numerical Accuracy Benchmarks (relErr & RMSE)", () => {
  it("evaluates exact rational quadratic NURBS quarter-circle against analytical circle (RMSE < 1e-12, arc length relErr < 1e-4)", () => {
    const R = 25.0;
    const w = Math.SQRT1_2;
    const iges = buildIgesFile({
      unitFlag: 6,
      entities: [
        {
          entityType: 126,
          label: "BENCH_QARC",
          params: [2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, w, 1, R, 0, 0, R, R, 0, 0, R, 0, 0, 1, 0, 0, 1],
        },
      ],
    });

    const doc = parseIges(iges);
    const ent = doc.entitiesByDe.get(1);
    assert.ok(ent && !("rawParams" in ent) && ent.entityType === 126);

    // Every point on the rational quadratic Bezier arc must lie exactly on x^2 + y^2 = R^2
    const sampleCount = 64;
    const actualRadii: number[] = [];
    const expectedRadii: number[] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const u = i / sampleCount;
      const [x, y, z] = evaluateNurbsCurve(ent, u);
      actualRadii.push(Math.hypot(x, y, z));
      expectedRadii.push(R);
    }

    const radiusRmse = rmse(actualRadii, expectedRadii);
    assert.ok(radiusRmse < 1e-12, `Expected radial RMSE < 1e-12, got ${radiusRmse}`);

    const tessellated = tessellateNurbsCurve(ent, 128);
    const polyLen = computePolylineLength(tessellated);
    const exactArcLen = 0.5 * Math.PI * R;
    const lenRelErr = relErr(polyLen, exactArcLen);
    assert.ok(lenRelErr < 1e-4, `Expected arc length relErr < 1e-4, got ${lenRelErr}`);
  });

  it("evaluates rational NURBS cylindrical patch (Type 128) against analytical area and radial RMSE", () => {
    const R = 10.0;
    const H = 30.0;
    const w = Math.SQRT1_2;
    // Quarter-cylinder of radius R and height H: degree (2, 1), K1=2, K2=1
    const iges = buildIgesFile({
      unitFlag: 6,
      entities: [
        {
          entityType: 128,
          label: "QUARTER_CYL",
          params: [
            2,
            1,
            2,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            1,
            1,
            1, // knotsU (6)
            0,
            0,
            1,
            1, // knotsV (4)
            // weights (3 x 2 = 6, v-major stride=3)
            1,
            w,
            1,
            1,
            w,
            1,
            // control points (v=0 row, then v=1 row)
            R,
            0,
            0,
            R,
            R,
            0,
            0,
            R,
            0,
            R,
            0,
            H,
            R,
            R,
            H,
            0,
            R,
            H,
            0,
            1,
            0,
            1,
          ],
        },
      ],
    });

    const doc = parseIges(iges);
    const surf = doc.entitiesByDe.get(1);
    assert.ok(surf && !("rawParams" in surf) && surf.entityType === 128);

    const actualR: number[] = [];
    const expectedR: number[] = [];
    const actualZ: number[] = [];
    const expectedZ: number[] = [];

    for (let iv = 0; iv <= 8; iv++) {
      const v = iv / 8;
      for (let iu = 0; iu <= 16; iu++) {
        const u = iu / 16;
        const [x, y, z] = evaluateNurbsSurface(surf, u, v);
        actualR.push(Math.hypot(x, y));
        expectedR.push(R);
        actualZ.push(z);
        expectedZ.push(v * H);
      }
    }

    assert.ok(rmse(actualR, expectedR) < 1e-12, "Cylinder surface radial RMSE must be < 1e-12");
    assert.ok(rmse(actualZ, expectedZ) < 1e-12, "Cylinder surface height RMSE must be < 1e-12");

    const mesh = tessellateNurbsSurface(surf, 64, 8);
    const expectedArea = 0.5 * Math.PI * R * H;
    const areaErr = relErr(mesh.surfaceArea, expectedArea);
    assert.ok(areaErr < 1e-3, `Expected cylinder surface area relErr < 1e-3, got ${areaErr}`);
  });

  it("evaluates Type 120 Surface of Revolution (right circular cone) lateral area within relErr < 2e-3", () => {
    const R = 6.0;
    const H = 8.0;
    const slant = Math.hypot(R, H); // 10.0
    const expectedConeArea = Math.PI * R * slant; // 60 * pi

    const iges = buildIgesFile({
      unitFlag: 6,
      entities: [
        // D1: Z-axis
        { entityType: 110, params: [0, 0, 0, 0, 0, H] },
        // D3: Slant generatrix from (R,0,0) to (0,0,H)
        { entityType: 110, params: [R, 0, 0, 0, 0, H] },
        // D5: Full 2π revolution
        { entityType: 120, params: [1, 3, 0, 2 * Math.PI] },
      ],
    });

    const evalRes = evaluateIgesDocument(iges, { surfaceSamples: 72 });
    const cone = evalRes.entities.find((e) => e.deNumber === 5);
    assert.ok(cone);
    const err = relErr(cone.area, expectedConeArea);
    assert.ok(err < 2e-3, `Expected cone lateral area relErr < 2e-3, got ${err}`);
  });

  it("evaluates Type 100 Circular Arc length & sector area and Type 124 rigid invariance (relErr < 1e-12)", () => {
    const R = 12.5;
    const angle = Math.PI / 3; // 60 degrees
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const rot30 = Math.PI / 6;

    const iges = buildIgesFile({
      unitFlag: 6,
      entities: [
        // D1: Pure 3D rigid rotation (around Z by 30°) + translation (7, -3, 11)
        {
          entityType: 124,
          params: [Math.cos(rot30), -Math.sin(rot30), 0, 7, Math.sin(rot30), Math.cos(rot30), 0, -3, 0, 0, 1, 11],
        },
        // D3: 60-degree arc
        { entityType: 100, transformMatrixPointer: 1, params: [0, 0, 0, R, 0, R * cosA, R * sinA] },
        // D5: 3D line of exact length 13 (3-4-12 Pythagorean quadruple)
        { entityType: 110, transformMatrixPointer: 1, params: [0, 0, 0, 3, 4, 12] },
      ],
    });

    const doc = parseIges(iges);
    const arcEnt = doc.entitiesByDe.get(3);
    assert.ok(arcEnt && !("rawParams" in arcEnt) && arcEnt.entityType === 100);

    const arcLocal = evaluateCircularArc(arcEnt, IDENTITY_TRANSFORM_124, 1, 64);
    assert.ok(relErr(arcLocal.arcLength, R * angle) < 1e-12);
    assert.ok(relErr(arcLocal.sectorArea, 0.5 * R * R * angle) < 1e-12);

    const evalRes = evaluateIgesDocument(doc, { curveSamples: 64 });
    const arcWorld = evalRes.entities.find((e) => e.deNumber === 3);
    const lineWorld = evalRes.entities.find((e) => e.deNumber === 5);
    assert.ok(arcWorld && lineWorld);

    assert.ok(relErr(arcWorld.arcLength, R * angle) < 1e-12, "Rigid transform must preserve arc length");
    assert.ok(relErr(lineWorld.arcLength, 13.0) < 1e-12, "Rigid transform must preserve line length");
  });

  it("verifies SI unit conversion factors across IGES 5.3 unit flags (relErr < 1e-12)", () => {
    const cases: Array<[number, number]> = [
      [1, 0.0254], // inch
      [2, 0.001], // mm
      [4, 0.3048], // foot
      [6, 1.0], // meter
      [9, 1e-6], // micron
      [10, 0.01], // cm
    ];

    for (const [flag, expectedScale] of cases) {
      assert.ok(relErr(IGES_UNIT_TO_METERS[flag]!, expectedScale) < 1e-12);
      const iges = buildIgesFile({
        unitFlag: flag,
        entities: [{ entityType: 110, params: [0, 0, 0, 100, 0, 0] }],
      });
      const res = evaluateIgesDocument(iges, { convertToMeters: true });
      assert.ok(
        relErr(res.totalCurveLength, 100 * expectedScale) < 1e-12,
        `Unit flag ${flag} length conversion mismatch`,
      );
    }
  });
});
