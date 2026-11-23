// SPDX-License-Identifier: AGPL-3.0-or-later

import { SolidKind } from "@modelscript/cad";
import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTerrainMesh, lowerUsgsDemToCadSolid } from "../src/cad/index.js";
import { generateGaussianHillDem, generateInclinedPlaneDem } from "../src/catalog/index.js";
import { lowerUsgsDemToDae, usgsDemToDae } from "../src/dae/index.js";

describe("@modelscript/usgs-dem CAD & DAE lowering", () => {
  it("builds a triangulated terrain mesh with exact planar & surface area on an inclined plane", () => {
    const gradX = 0.75; // slope = 0.75 => sec(theta) = sqrt(1 + 0.75^2) = 1.25
    const model = generateInclinedPlaneDem({
      numCols: 11,
      numRows: 11,
      dx: 10,
      dy: 10,
      baseElevation: 100,
      gradX,
      gradY: 0,
    });
    const mesh = buildTerrainMesh(model, { watertight: false });
    assert.equal(mesh.vertices.length, 11 * 11);
    assert.equal(mesh.faces.length, 10 * 10 * 2);

    const expectedPlanar = 100 * 100;
    const expectedSurface = expectedPlanar * Math.sqrt(1 + gradX * gradX);
    assert.ok(Math.abs(mesh.planarArea - expectedPlanar) < 1e-6);
    assert.ok(Math.abs(mesh.surfaceArea - expectedSurface) / expectedSurface < 1e-10);
  });

  it("lowers a USGS DEM to a watertight @modelscript/cad PolyhedronSolid", () => {
    const model = generateGaussianHillDem({ numCols: 9, numRows: 9, dx: 25, dy: 25 });
    const solid = lowerUsgsDemToCadSolid(model);
    assert.equal(solid.kind, SolidKind.Polyhedron);
    assert.equal(solid.points.length, 9 * 9 + 4);
    assert.ok(solid.faces.length > 8 * 8 * 2);
  });

  it("lowers overland Manning kinematic-wave runoff equations directly to DAEBuilder", () => {
    const model = generateGaussianHillDem({ numCols: 11, numRows: 11, dx: 30, dy: 30 });
    const builder = new DAEBuilder(undefined, "DemRunoffTest");
    const result = lowerUsgsDemToDae(builder, model, {
      manningN: 0.04,
      rainfallIntensity: 2e-5,
      infiltrationRate: 5e-6,
    });
    assert.equal(result.stateVarIndices.length, 2);
    assert.equal(result.equationCount, 6);
    assert.ok(result.variableMap.has("h_depth"));
    assert.ok(result.variableMap.has("V_runoff"));
    assert.ok(result.variableMap.has("Q_out"));
    assert.ok(result.basinAreaM2 > 0);

    const dae = usgsDemToDae(model);
    assert.ok(dae.varCount >= 12);
    assert.equal(dae.eqCount, 6);
  });
});
