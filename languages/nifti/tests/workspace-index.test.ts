// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { niftiLanguage, resolveNiftiInScope } from "../src/index.js";

describe("NIfTI & NRRD Multi-File UnifiedWorkspace", () => {
  it("indexes volumes, anatomical segmentation labels, and compartmental ROIs across files", () => {
    const ws = new UnifiedWorkspace(niftiLanguage);
    const niiUri = "file:///brain_seg.nii";
    const nrrdUri = "file:///liver_seg.nrrd";

    ws.setDocument(
      niiUri,
      `
      NIFTI title="BrainAtlas" datatype=INT16 segmentation=true
      DIM ndim=3 nx=2 ny=2 nz=2
      LABEL id=1 name="Thalamus"
      ROI id=ROI_THAL name="ThalamusPerf" label=1 D=0.14 clearance=0.02
      VOXELS 1 1 0 0 0 0 0 0
    `,
    );

    ws.setDocument(
      nrrdUri,
      `NRRD0004
type: uint8
dimension: 3
sizes: 2 2 2
spacings: 1.0 1.0 1.0
content: HepaticAtlas
Segment0_Name:=PortalVein
Segment0_LabelValue:=2

2 2 0 0 0 0 0 0`,
    );

    assert.strictEqual(ws.fileCount, 2);
    assert(ws.hasDocument(niiUri));
    assert(ws.hasDocument(nrrdUri));

    const foundThal = ws.findSymbolsByName("Thalamus");
    assert.strictEqual(foundThal.length, 1);
    assert.strictEqual(foundThal[0]?.ruleName, "nifti_label");

    const foundVol = ws.findSymbolsByName("BrainAtlas");
    assert.strictEqual(foundVol.length, 1);
    const volId = foundVol[0]!.id;

    const childRoi = resolveNiftiInScope(ws, "ThalamusPerf", volId, niiUri);
    assert(childRoi !== null);
    assert.strictEqual(childRoi.ruleName, "nifti_roi");

    ws.clear();
    assert.strictEqual(ws.fileCount, 0);
  });
});
