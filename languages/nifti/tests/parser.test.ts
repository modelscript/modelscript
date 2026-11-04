// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseNifti, serializeNifti1Binary } from "../src/parser/index.js";

describe("NIfTI-1/2 (.nii) & NRRD (.nrrd, .nhdr) Multi-Format Parser", () => {
  it("parses NRRD0004 headers with space directions, segment labels, and inline voxel grids", () => {
    const nrrd = `NRRD0004
type: int16
dimension: 3
sizes: 2 2 2
space directions: (1.5,0,0) (0,1.5,0) (0,0,2.0)
space origin: (-10.0, -20.0, 5.0)
Segment0_Name:=Hippocampus
Segment0_LabelValue:=1

1 1 0 0
1 0 0 1`;

    const doc = parseNifti(nrrd, "file:///hippocampus.nrrd");
    assert.strictEqual(doc.format, "nrrd");
    assert.strictEqual(doc.header.datatypeCode, 4);
    assert.strictEqual(doc.header.dim[1], 2);
    assert.strictEqual(doc.header.dim[2], 2);
    assert.strictEqual(doc.header.dim[3], 2);
    assert.strictEqual(doc.header.pixdim[1], 1.5);
    assert.strictEqual(doc.header.pixdim[3], 2.0);
    assert.strictEqual(doc.header.qoffsetX, -10.0);
    assert.strictEqual(doc.labels.length, 1);
    assert.strictEqual(doc.labels[0]?.name, "Hippocampus");
    assert.strictEqual(doc.voxels.length, 8);
  });

  it("parses and round-trips 348-byte binary NIfTI-1 headers and voxel payloads", () => {
    const dsl = `
      NIFTI title="BrainT1" datatype=FLOAT32
      DIM ndim=3 nx=2 ny=2 nz=2 nt=1
      PIXDIM qfac=1 dx=1.0 dy=1.0 dz=1.2
      SFORM code=1 srow_x=[1,0,0,-50] srow_y=[0,1,0,-60] srow_z=[0,0,1.2,-30]
      VOXELS 1 1 1 1 0 0 0 0
    `;
    const initialDoc = parseNifti(dsl);
    const binaryBytes = serializeNifti1Binary(initialDoc);
    assert(binaryBytes.byteLength >= 352 + 8 * 4);

    const parsedBin = parseNifti(binaryBytes);
    assert.strictEqual(parsedBin.format, "nifti1");
    assert.strictEqual(parsedBin.header.sizeofHdr, 348);
    assert.strictEqual(parsedBin.header.magic, "n+1");
    assert.strictEqual(parsedBin.header.dim[1], 2);
    assert(Math.abs(parsedBin.header.pixdim[3] - 1.2) < 1e-5);
    assert.strictEqual(parsedBin.voxels.length, 8);
    assert.strictEqual(parsedBin.voxels[0], 1);
  });

  it("parses JSON and XML NIfTI header representations", () => {
    const jsonText = JSON.stringify({
      sizeof_hdr: 348,
      magic: "n+1",
      datatype: "UINT8",
      dim: [3, 2, 2, 1, 1, 1, 1, 1],
      pixdim: [1, 0.8, 0.8, 1.0, 1, 1, 1, 1],
      voxels: [1, 1, 0, 1],
    });
    const jsonDoc = parseNifti(jsonText);
    assert.strictEqual(jsonDoc.format, "json");
    assert.strictEqual(jsonDoc.header.datatypeCode, 2);
    assert.strictEqual(jsonDoc.voxels.length, 4);

    const xmlText = `<nifti_image dim="3 4 4 4 1 1 1 1" pixdim="1 1.0 1.0 1.0 1 1 1 1" datatype="INT16" description="CorticalAtlas" />`;
    const xmlDoc = parseNifti(xmlText);
    assert.strictEqual(xmlDoc.format, "xml");
    assert.strictEqual(xmlDoc.title, "CorticalAtlas");
  });
});
