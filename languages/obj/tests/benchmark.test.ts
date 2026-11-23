// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMtl, parseObj } from "../src/parser/index.js";
import {
  computeBoundingBox,
  computeMeshMetrics,
  computeSmoothVertexNormals,
  triangulateObjMesh,
} from "../src/solver/index.js";

const UNIT_CUBE_POSITIVE = [
  "o UnitCubePos",
  "v 0 0 0",
  "v 1 0 0",
  "v 1 1 0",
  "v 0 1 0",
  "v 0 0 1",
  "v 1 0 1",
  "v 1 1 1",
  "v 0 1 1",
  "# 6 quad faces with outward CCW winding",
  "f 1 4 3 2",
  "f 5 6 7 8",
  "f 1 2 6 5",
  "f 3 4 8 7",
  "f 1 5 8 4",
  "f 2 3 7 6",
].join("\n");

const UNIT_CUBE_NEGATIVE = [
  "o UnitCubeNeg",
  "v 0 0 0",
  "v 1 0 0",
  "v 1 1 0",
  "v 0 1 0",
  "v 0 0 1",
  "v 1 0 1",
  "v 1 1 1",
  "v 0 1 1",
  "# Identical 6 quad faces using negative relative indices (-8..-1)",
  "f -8 -5 -6 -7",
  "f -4 -3 -2 -1",
  "f -8 -7 -3 -4",
  "f -6 -5 -1 -2",
  "f -8 -4 -1 -5",
  "f -7 -6 -2 -3",
].join("\n");

describe("Wavefront OBJ & MTL Quantitative Benchmarks", () => {
  it("triangulates quad-face unit cube to 12 triangles with exact area A=6, volume V=1, χ=2", () => {
    const doc = parseObj(UNIT_CUBE_POSITIVE);
    const tris = triangulateObjMesh(doc);
    assert.equal(tris.length, 12);

    const metrics = computeMeshMetrics(doc);
    const relErrArea = Math.abs(metrics.surfaceArea - 6.0) / 6.0;
    const relErrVol = Math.abs(metrics.signedVolume - 1.0) / 1.0;

    assert.ok(relErrArea < 1e-10, `area relErr=${relErrArea}`);
    assert.ok(relErrVol < 1e-10, `volume relErr=${relErrVol}`);
    assert.equal(metrics.eulerCharacteristic, 2);
    assert.equal(metrics.isWatertight, true);
    assert.equal(metrics.boundaryEdgeCount, 0);
    assert.equal(metrics.nonManifoldEdgeCount, 0);

    const bbox = computeBoundingBox(doc);
    assert.deepEqual(bbox.min, [0, 0, 0]);
    assert.deepEqual(bbox.max, [1, 1, 1]);
    assert.deepEqual(bbox.center, [0.5, 0.5, 0.5]);
    assert.ok(Math.abs(bbox.diagonal - Math.sqrt(3)) < 1e-12);

    // Smooth vertex normals on cube corners should be unit length and point along (±1, ±1, ±1)/√3
    const normals = computeSmoothVertexNormals(doc, tris);
    assert.equal(normals.length, 8);
    for (const [nx, ny, nz] of normals) {
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      assert.ok(Math.abs(len - 1.0) < 1e-12, `expected unit normal, got len=${len}`);
    }
  });

  it("maintains exact parity between positive 1-based and negative relative indexing (relErr < 1e-10, rmse < 1e-10)", () => {
    const posDoc = parseObj(UNIT_CUBE_POSITIVE);
    const negDoc = parseObj(UNIT_CUBE_NEGATIVE);

    const posMetrics = computeMeshMetrics(posDoc);
    const negMetrics = computeMeshMetrics(negDoc);

    const posVec = [
      posMetrics.surfaceArea,
      posMetrics.signedVolume,
      posMetrics.centroid[0],
      posMetrics.centroid[1],
      posMetrics.centroid[2],
      posMetrics.unitDensityInertia.ixx,
      posMetrics.unitDensityInertia.iyy,
      posMetrics.unitDensityInertia.izz,
    ];
    const negVec = [
      negMetrics.surfaceArea,
      negMetrics.signedVolume,
      negMetrics.centroid[0],
      negMetrics.centroid[1],
      negMetrics.centroid[2],
      negMetrics.unitDensityInertia.ixx,
      negMetrics.unitDensityInertia.iyy,
      negMetrics.unitDensityInertia.izz,
    ];

    let sumSq = 0;
    for (let i = 0; i < posVec.length; i++) {
      const diff = Math.abs(posVec[i]! - negVec[i]!);
      const relErr = diff / Math.max(1e-12, Math.abs(posVec[i]!));
      assert.ok(relErr < 1e-10, `component ${i} relErr=${relErr}`);
      sumSq += diff * diff;
    }
    const rmse = Math.sqrt(sumSq / posVec.length);
    assert.ok(rmse < 1e-10, `expected rmse < 1e-10, got ${rmse}`);
  });

  it("accurately parses MTL illumination models, colors, specular exponent, and optical density", () => {
    const mtl = parseMtl(
      [
        "newmtl OpticalGlass",
        "Ka 0.10 0.12 0.14",
        "Kd 0.88 0.95 0.98",
        "Ks 0.95 0.95 0.95",
        "Ke 0.00 0.00 0.00",
        "Ns 600.0",
        "d 0.25",
        "Ni 1.52",
        "illum 4",
      ].join("\n"),
    );

    assert.equal(mtl.errors.length, 0);
    const g = mtl.materials.get("OpticalGlass")!;
    assert.ok(g);
    assert.equal(g.illum, 4);
    assert.ok(Math.abs((g.Ni ?? 0) - 1.52) < 1e-12);
    assert.ok(Math.abs((g.d ?? 0) - 0.25) < 1e-12);
    assert.ok(Math.abs((g.Tr ?? 0) - 0.75) < 1e-12);
    assert.ok(Math.abs((g.Ns ?? 0) - 600.0) < 1e-12);
    assert.deepEqual(g.Kd, [0.88, 0.95, 0.98]);
  });
});
