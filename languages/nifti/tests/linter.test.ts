// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintNiftiDocument } from "../src/lints/index.js";
import { parseNifti } from "../src/parser/index.js";

describe("NIfTI & NRRD Volumetric Medical Imaging Linter (M9501–M9510)", () => {
  it("emits M9501 on invalid volume dimensions dim[0] or non-positive nx, ny, nz", () => {
    const dsl = `
      NIFTI title="BadDims"
      DIM ndim=9 nx=0 ny=-4 nz=10
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9501"));
  });

  it("emits M9502 on non-positive voxel spacing pixdim[1..3]", () => {
    const dsl = `
      NIFTI title="BadSpacing"
      DIM ndim=3 nx=4 ny=4 nz=4
      PIXDIM qfac=1 dx=1.0 dy=-0.5 dz=0.0
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9502"));
  });

  it("emits M9503 when 4x4 sform affine transformation matrix is singular", () => {
    const dsl = `
      NIFTI title="SingularSform"
      DIM ndim=3 nx=4 ny=4 nz=4
      SFORM code=1 srow_x=[1,0,0,0] srow_y=[2,0,0,0] srow_z=[0,0,1,0]
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9503"));
  });

  it("emits M9504 when quaternion parameters satisfy b^2 + c^2 + d^2 > 1.0", () => {
    const dsl = `
      NIFTI title="BadQuaternion"
      DIM ndim=3 nx=4 ny=4 nz=4
      QFORM code=1 qfac=1 b=0.8 c=0.7 d=0.5
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9504"));
  });

  it("emits M9505 on qform vs sform coordinate handedness mismatch", () => {
    const dsl = `
      NIFTI title="HandednessMismatch"
      DIM ndim=3 nx=4 ny=4 nz=4
      QFORM code=1 qfac=-1 b=0 c=0 d=0
      SFORM code=1 srow_x=[1,0,0,0] srow_y=[0,1,0,0] srow_z=[0,0,1,0]
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9505"));
  });

  it("emits M9506 when scl_slope is explicitly 0 while intensity scaling is active", () => {
    const dsl = `
      NIFTI title="ZeroSlope"
      DIM ndim=3 nx=2 ny=2 nz=2
      SCALING slope=0.0 inter=100.0
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9506"));
  });

  it("emits M9507 on unsupported or unrecognized voxel datatype code", () => {
    const dsl = `
      NIFTI title="BadDatatype" datatype=9999
      DIM ndim=3 nx=2 ny=2 nz=2
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9507"));
  });

  it("emits M9508 when voxel payload length does not match nx * ny * nz * nt", () => {
    const dsl = `
      NIFTI title="SizeMismatch"
      DIM ndim=3 nx=2 ny=2 nz=2 nt=1
      VOXELS 1 1 1
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9508"));
  });

  it("emits M9509 when segmentation labelmap contains zero foreground voxels", () => {
    const dsl = `
      NIFTI title="EmptyMask" segmentation=true
      DIM ndim=3 nx=2 ny=2 nz=1
      LABEL id=1 name="Tumor"
      VOXELS 0 0 0 0
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    assert(diags.some((d) => d.code === "M9509"));
  });

  it("emits M9510 warning when slice thickness dz exceeds 5x in-plane resolution", () => {
    const dsl = `
      NIFTI title="ThickSlices"
      DIM ndim=3 nx=4 ny=4 nz=4
      PIXDIM qfac=1 dx=0.5 dy=0.5 dz=4.0
    `;
    const doc = parseNifti(dsl);
    const diags = lintNiftiDocument(doc);
    const m9510 = diags.find((d) => d.code === "M9510");
    assert(m9510 !== undefined);
    assert.strictEqual(m9510.severity, "warning");
  });
});
