// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { extractIsoSurfaceMesh, lowerNiftiToDae, voxelToWorldRAS } from "../src/mesh/index.js";
import { parseNifti } from "../src/parser/index.js";

describe("NIfTI RAS Coordinate Transform, Isosurface Mesh Extraction & DAE Lowering", () => {
  const sampleDsl = `
    NIFTI title="LeftVentricleSeg" datatype=INT16 segmentation=true
    DIM ndim=3 nx=2 ny=2 nz=2 nt=1
    PIXDIM qfac=1 dx=2.0 dy=2.0 dz=2.0
    SFORM code=1 srow_x=[2.0,0,0,10.0] srow_y=[0,2.0,0,20.0] srow_z=[0,0,2.0,30.0]
    LABEL id=1 name="Myocardium" color=[220,20,60]
    ROI id=ROI_MYO name="MyocardiumTracer" label=1 D=0.18 clearance=0.03 conc=2.5
    VOXELS 1 1 0 0 0 0 0 0
  `;

  it("transforms voxel indices to RAS world coordinates and extracts watertight surface mesh", () => {
    const doc = parseNifti(sampleDsl);
    const ras = voxelToWorldRAS(doc.header, 1, 2, 3);
    assert.deepStrictEqual(ras, [12.0, 24.0, 36.0]);

    const mesh = extractIsoSurfaceMesh(doc);
    // 2 foreground voxels, each of size 2x2x2 = 8 mm^3 -> totalVolume = 16 mm^3
    assert.strictEqual(mesh.foregroundVoxelCount, 2);
    assert(Math.abs(mesh.voxelVolumeMm3 - 8.0) < 1e-9);
    assert(Math.abs(mesh.totalVolumeMm3 - 16.0) < 1e-9);
    assert(Math.abs(mesh.tetrahedralVolumeMm3 - 16.0) < 1e-6);
    // Two adjacent 2x2x2 cubes share 1 face -> 10 exposed faces * 4 mm^2 = 40 mm^2, 20 triangles
    assert.strictEqual(mesh.triangles.length, 20);
    assert(Math.abs(mesh.surfaceAreaMm2 - 40.0) < 1e-6);
    assert.strictEqual(mesh.labelStats.length, 1);
    assert.strictEqual(mesh.labelStats[0]?.labelName, "Myocardium");
  });

  it("lowers compartmental voxel tracer kinetics and diffusion into DAEBuilder", () => {
    const doc = parseNifti(sampleDsl);
    const arena = lowerNiftiToDae(doc);
    assert(arena.getVarCount() >= 8);
    assert(arena.getEqCount() >= 8);
  });
});
