// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTransform124,
  buildIgesFile,
  composeTransform124,
  computeBasisFunctions,
  evaluateCircularArc,
  evaluateIgesDocument,
  evaluateNurbsCurve,
  evaluateNurbsSurface,
  findKnotSpan,
  IDENTITY_TRANSFORM_124,
  lowerIgesToCad,
  parseIges,
  resolveEntityTransform,
  tessellateNurbsCurve,
  tessellateNurbsSurface,
  type Transform3x4,
} from "../src/index.js";

describe("@modelscript/iges — Geometric Evaluator, NURBS & CAD Lowering", () => {
  it("evaluates Cox-de Boor knot spans and basis functions (partition of unity)", () => {
    const knots = [0, 0, 0, 0.5, 1, 1, 1];
    const n = 3;
    const degree = 2;

    assert.equal(findKnotSpan(n, degree, 0.0, knots), 2);
    assert.equal(findKnotSpan(n, degree, 0.25, knots), 2);
    assert.equal(findKnotSpan(n, degree, 0.75, knots), 3);
    assert.equal(findKnotSpan(n, degree, 1.0, knots), 3);

    for (const u of [0, 0.1, 0.5, 0.75, 1.0]) {
      const span = findKnotSpan(n, degree, u, knots);
      const basis = computeBasisFunctions(span, u, degree, knots);
      assert.equal(basis.length, degree + 1);
      const sum = basis.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1.0) < 1e-12, `Basis functions at u=${u} should sum to 1, got ${sum}`);
      for (const b of basis) {
        assert.ok(b >= -1e-15 && b <= 1 + 1e-15, `Basis value out of [0,1]: ${b}`);
      }
    }
  });

  it("composes and resolves chained Type 124 transformation matrices", () => {
    const rotZ90: Transform3x4 = {
      rotation: [
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ],
      translation: [10, 0, 0],
    };
    const translateY: Transform3x4 = {
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      translation: [0, 5, 0],
    };

    const composed = composeTransform124(rotZ90, translateY);
    const p = applyTransform124([1, 0, 0], composed);
    // translateY([1,0,0]) = [1,5,0]; rotZ90([1,5,0]) = [-5+10, 1, 0] = [5, 1, 0]
    assert.ok(Math.abs(p[0] - 5) < 1e-12);
    assert.ok(Math.abs(p[1] - 1) < 1e-12);
    assert.ok(Math.abs(p[2] - 0) < 1e-12);

    // Verify document-level chained matrix resolution
    const iges = buildIgesFile({
      entities: [
        // D1: parent rotation + translation
        { entityType: 124, params: [0, -1, 0, 10, 1, 0, 0, 0, 0, 0, 1, 0] },
        // D3: child translation referencing D1
        { entityType: 124, transformMatrixPointer: 1, params: [1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1, 0] },
        // D5: point at [1, 0, 0] referencing D3
        { entityType: 116, transformMatrixPointer: 3, params: [1, 0, 0, 0] },
      ],
    });

    const doc = parseIges(iges);
    const ptEntity = doc.entitiesByDe.get(5);
    assert.ok(ptEntity);
    const resolved = resolveEntityTransform(doc, ptEntity);
    const worldPt = applyTransform124([1, 0, 0], resolved);
    assert.ok(Math.abs(worldPt[0] - 5) < 1e-12);
    assert.ok(Math.abs(worldPt[1] - 1) < 1e-12);
    assert.ok(Math.abs(worldPt[2] - 0) < 1e-12);
  });

  it("evaluates Type 100 Circular Arc (quarter arc and full circle) with exact arc length & sector area", () => {
    const iges = buildIgesFile({
      entities: [
        // Quarter arc of radius 10 centered at (0,0) in z=2
        { entityType: 100, label: "QARC", params: [2, 0, 0, 10, 0, 0, 10] },
        // Full circle of radius 5 centered at (3,4) (start == end)
        { entityType: 100, label: "FULL", params: [0, 3, 4, 8, 4, 8, 4] },
      ],
    });
    const doc = parseIges(iges);
    const qEnt = doc.entitiesByDe.get(1);
    const fEnt = doc.entitiesByDe.get(3);
    assert.ok(qEnt && !("rawParams" in qEnt) && qEnt.entityType === 100);
    assert.ok(fEnt && !("rawParams" in fEnt) && fEnt.entityType === 100);

    const qArc = evaluateCircularArc(qEnt, IDENTITY_TRANSFORM_124, 1, 32);
    assert.equal(qArc.isFullCircle, false);
    assert.ok(Math.abs(qArc.radius - 10) < 1e-12);
    assert.ok(Math.abs(qArc.arcLength - 5 * Math.PI) < 1e-12);
    assert.ok(Math.abs(qArc.sectorArea - 25 * Math.PI) < 1e-12);
    assert.deepEqual(qArc.center, [0, 0, 2]);

    const fArc = evaluateCircularArc(fEnt, IDENTITY_TRANSFORM_124, 1, 64);
    assert.equal(fArc.isFullCircle, true);
    assert.ok(Math.abs(fArc.radius - 5) < 1e-12);
    assert.ok(Math.abs(fArc.arcLength - 10 * Math.PI) < 1e-12);
    assert.ok(Math.abs(fArc.sectorArea - 25 * Math.PI) < 1e-12);
  });

  it("evaluates Type 126 NURBS curve, Type 128 NURBS surface, and Type 120 Surface of Revolution", () => {
    const w = Math.SQRT1_2;
    const iges = buildIgesFile({
      unitFlag: 2, // millimeters
      entities: [
        // D1: Type 126 NURBS quarter-circle of radius 100 mm
        {
          entityType: 126,
          label: "NURBS_ARC",
          params: [2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, w, 1, 100, 0, 0, 100, 100, 0, 0, 100, 0, 0, 1, 0, 0, 1],
        },
        // D3: Type 128 Bilinear NURBS square 100x50 mm
        {
          entityType: 128,
          label: "NURBS_SURF",
          params: [
            1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 100, 0, 0, 0, 50, 0, 100, 50, 0, 0,
            1, 0, 1,
          ],
        },
        // D5: Axis line along Z from (0,0,0) to (0,0,100)
        { entityType: 110, label: "AXIS", params: [0, 0, 0, 0, 0, 100] },
        // D7: Generatrix line parallel to Z at x=20 from z=0 to z=50
        { entityType: 110, label: "GEN", params: [20, 0, 0, 20, 0, 50] },
        // D9: Surface of Revolution (cylinder R=20, H=50, full 2π)
        { entityType: 120, label: "CYL", params: [5, 7, 0, 2 * Math.PI] },
      ],
    });

    const doc = parseIges(iges);
    const curveEnt = doc.entitiesByDe.get(1);
    const surfEnt = doc.entitiesByDe.get(3);
    assert.ok(curveEnt && !("rawParams" in curveEnt) && curveEnt.entityType === 126);
    assert.ok(surfEnt && !("rawParams" in surfEnt) && surfEnt.entityType === 128);

    // Midpoint of quarter circle at u=0.5 should be at (100*cos(45°), 100*sin(45°), 0)
    const mid = evaluateNurbsCurve(curveEnt, 0.5);
    assert.ok(Math.abs(mid[0] - 100 * Math.SQRT1_2) < 1e-9);
    assert.ok(Math.abs(mid[1] - 100 * Math.SQRT1_2) < 1e-9);
    assert.equal(tessellateNurbsCurve(curveEnt, 16).length, 17);

    // Center of 100x50 bilinear surface at (0.5, 0.5) should be (50, 25, 0)
    const sMid = evaluateNurbsSurface(surfEnt, 0.5, 0.5);
    assert.ok(Math.abs(sMid[0] - 50) < 1e-12);
    assert.ok(Math.abs(sMid[1] - 25) < 1e-12);
    const mesh = tessellateNurbsSurface(surfEnt, 4, 4);
    assert.ok(Math.abs(mesh.surfaceArea - 5000) < 1e-9);

    // Evaluate full document with SI meter conversion (mm -> m, scale = 0.001)
    const evalMeters = evaluateIgesDocument(doc, { convertToMeters: true, surfaceSamples: 36 });
    assert.equal(evalMeters.unitFlag, 2);
    assert.equal(evalMeters.unitScaleToMeters, 0.001);
    assert.ok(evalMeters.boundingBox !== null);

    const surfRes = evalMeters.entities.find((e) => e.deNumber === 3);
    assert.ok(surfRes);
    // 5000 mm^2 = 0.005 m^2
    assert.ok(Math.abs(surfRes.area - 0.005) < 1e-9);

    const cylRes = evalMeters.entities.find((e) => e.deNumber === 9);
    assert.ok(cylRes && cylRes.mesh);
    // Analytical cylinder area = 2 * pi * 0.02 * 0.05 = 0.002 * pi
    const expectedCylArea = 2 * Math.PI * 0.02 * 0.05;
    assert.ok(Math.abs(cylRes.area - expectedCylArea) / expectedCylArea < 0.01);
  });

  it("lowers IGES wireframe, circular arc, NURBS surface, and B-Rep entities into @modelscript/cad Solids and Assembly", () => {
    const iges = buildIgesFile({
      productId: "BRACKET_ASM",
      unitFlag: 6,
      entities: [
        { entityType: 110, label: "EDGE_A", params: [0, 0, 0, 2, 0, 0] },
        { entityType: 100, label: "HOLE_A", params: [0, 1, 1, 1.5, 1, 1.5, 1] },
        { entityType: 106, label: "POLY_A", params: [2, 3, 0, 0, 0, 1, 1, 0, 2, 0, 0] },
        {
          entityType: 128,
          label: "FACE_A",
          params: [
            1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0, 0, 1, 0,
            1,
          ],
        },
        { entityType: 186, label: "SOLID_A", params: [7, 1, 0] },
      ],
    });

    const result = lowerIgesToCad(iges, { wireThickness: 0.01 });
    assert.equal(result.summary.entityCount, 5);
    assert.equal(result.summary.hasBRep, true);
    assert.equal(result.summary.solidCount, 5);
    assert.equal(result.solids.length, 5);
    assert.equal(result.assembly.name, "BRACKET_ASM");
    assert.equal(result.assembly.parts.length, 5);
    assert.ok(result.summary.totalCurveLength > 0);
    assert.ok(result.summary.totalSurfaceArea >= 4.0);
  });
});
