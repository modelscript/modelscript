// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  box,
  compileToStep,
  computeMeshVolumeAndArea,
  cylinder,
  intersect,
  linearExtrude,
  ManifoldWorker,
  polyhedron,
  subtract,
  translate,
  union,
} from "../src/index.js";

describe("3D BSP CSG Boolean Clipping & Mesh Metrics", () => {
  it("computes exact volume and surface area for a Box solid", () => {
    const b = box({ width: 10, height: 20, depth: 30 });
    const mesh = ManifoldWorker.evaluateSolid(b);
    const { volume, surfaceArea } = computeMeshVolumeAndArea(mesh);

    assert.ok(Math.abs(volume - 6000) < 1e-2, `Expected volume 6000, got ${volume}`);
    assert.ok(Math.abs(surfaceArea - 2200) < 1e-2, `Expected area 2200, got ${surfaceArea}`);
  });

  it("clips geometry and reduces volume when subtracting a hole from a block (difference)", () => {
    const baseBox = box({ width: 20, height: 10, depth: 20 }); // Volume = 4000
    const holeBox = box({ width: 6, height: 20, depth: 6 }); // Cuts 6 x 10 x 6 = 360 through center
    const drilled = subtract(baseBox, holeBox);

    const mesh = ManifoldWorker.evaluateSolid(drilled);
    const { volume, surfaceArea } = computeMeshVolumeAndArea(mesh);

    // Expected volume = 4000 - 360 = 3640
    assert.ok(Math.abs(volume - 3640) < 1.0, `Expected subtracted volume ~3640, got ${volume}`);
    // Surface area increases by interior hole walls (4 * 6 * 10 = 240) minus top/bottom hole caps (2 * 36 = 72)
    // Original box area = 2*(20*10 + 20*20 + 10*20) = 1600 -> 1600 - 72 + 240 = 1768
    assert.ok(Math.abs(surfaceArea - 1768) < 1.0, `Expected subtracted surface area ~1768, got ${surfaceArea}`);
  });

  it("computes exact intersection of two overlapping boxes", () => {
    const a = box({ width: 10, height: 10, depth: 10 }); // [-5, 5]^3
    const b = translate(box({ width: 10, height: 10, depth: 10 }), [5, 0, 0]); // [0, 10] x [-5, 5]^2
    const common = intersect(a, b); // [0, 5] x [-5, 5] x [-5, 5] => 5 x 10 x 10 = 500

    const mesh = ManifoldWorker.evaluateSolid(common);
    const { volume } = computeMeshVolumeAndArea(mesh);
    assert.ok(Math.abs(volume - 500) < 1.0, `Expected intersection volume ~500, got ${volume}`);
  });

  it("removes internal overlapping faces in union of two overlapping boxes", () => {
    const a = box({ width: 10, height: 10, depth: 10 }); // Vol 1000
    const b = translate(box({ width: 10, height: 10, depth: 10 }), [5, 0, 0]); // Vol 1000, overlap 500
    const merged = union(a, b); // Expected union volume = 1500

    const mesh = ManifoldWorker.evaluateSolid(merged);
    const { volume } = computeMeshVolumeAndArea(mesh);
    assert.ok(Math.abs(volume - 1500) < 1.0, `Expected union volume ~1500, got ${volume}`);
  });

  it("evaluates cylinder frustum (r1 != r2) and polyhedron primitives", () => {
    const frustum = cylinder({ radius: 7.5, radiusBottom: 10, radiusTop: 5, height: 12, segments: 64 });
    const fMesh = ManifoldWorker.evaluateSolid(frustum);
    const { volume: fVol } = computeMeshVolumeAndArea(fMesh);
    const expectedFrustumVol = (Math.PI * 12 * (100 + 50 + 25)) / 3;
    assert.ok(
      Math.abs(fVol - expectedFrustumVol) / expectedFrustumVol < 0.02,
      `Expected frustum volume ~${expectedFrustumVol.toFixed(1)}, got ${fVol.toFixed(1)}`,
    );

    // Tetrahedron polyhedron with vertices (0,0,0), (6,0,0), (0,6,0), (0,0,6) -> Vol = 36
    const tetra = polyhedron({
      points: [
        [0, 0, 0],
        [6, 0, 0],
        [0, 6, 0],
        [0, 0, 6],
      ],
      faces: [
        [0, 2, 1],
        [0, 1, 3],
        [0, 3, 2],
        [1, 2, 3],
      ],
    });
    const tMesh = ManifoldWorker.evaluateSolid(tetra);
    const { volume: tVol } = computeMeshVolumeAndArea(tMesh);
    assert.ok(Math.abs(tVol - 36) < 1e-2, `Expected tetrahedron volume 36, got ${tVol}`);
  });

  it("compiles polygonal linear_extrude to true multi-face STEP B-Rep", () => {
    const prism = linearExtrude(
      [
        [0, 0],
        [20, 0],
        [10, 15],
      ],
      10,
      { name: "TriPrism" },
    );
    const step = compileToStep(prism, "TriPrism");
    assert.ok(step.includes("MANIFOLD_SOLID_BREP('TriPrism'"));
    // Triangular prism has 5 faces (bottom + top + 3 sides)
    const faceMatches = step.match(/ADVANCED_FACE\(/g) ?? [];
    assert.strictEqual(faceMatches.length, 5, "Triangular prism must emit 5 ADVANCED_FACE entities");
  });
});
