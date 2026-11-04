// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { niftiLanguage } from "../src/language.js";
import {
  executeNiftiAction,
  getNiftiCompletions,
  getNiftiDefinition,
  getNiftiDocumentSymbols,
  getNiftiHover,
  validateNifti,
} from "../src/lsp.js";
import { parseNifti } from "../src/parser/index.js";
import { niftiToScad, niftiToStep } from "../src/projections/index.js";

describe("NIfTI Projections (OpenSCAD .scad & STEP .stp) and LSP Services", () => {
  const sampleNifti = `NIFTI title="AortaSegmentation" datatype=UINT8 segmentation=true
DIM ndim=3 nx=2 ny=2 nz=1 nt=1
PIXDIM qfac=1 dx=1.5 dy=1.5 dz=1.5
SFORM code=1 srow_x=[1.5,0,0,0] srow_y=[0,1.5,0,0] srow_z=[0,0,1.5,0]
LABEL id=1 name="AorticLumen" color=[255,50,50]
ROI id=ROI_AORTA name="ContrastBolus" label=1 D=0.25 clearance=0.08 conc=5.0
VOXELS 1 1 1 0`;

  it("projects segmented NIfTI mesh to OpenSCAD polyhedron (.scad) and STEP AP242 (.stp)", () => {
    const doc = parseNifti(sampleNifti);
    const scad = niftiToScad(doc);
    assert(scad.includes("module AortaSegmentation()"));
    assert(scad.includes("polyhedron("));
    assert(scad.includes("points = ["));
    assert(scad.includes("faces = ["));

    const step = niftiToStep(doc);
    assert(step.includes("ISO-10303-21;"));
    assert(step.includes("CARTESIAN_POINT"));
    assert(step.includes("MANIFOLD_SOLID_BREP"));
  });

  it("provides LSP diagnostics, symbols, hover, completions, definition, and actions", async () => {
    assert(niftiLanguage.fileExtensions.includes(".nii"));
    assert(niftiLanguage.fileExtensions.includes(".nrrd"));
    assert(niftiLanguage.fileExtensions.includes(".nhdr"));

    const diags = validateNifti(sampleNifti);
    assert.strictEqual(diags.length, 0);

    const symbols = getNiftiDocumentSymbols(sampleNifti);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]?.children?.length, 2);

    const lblOffset = sampleNifti.indexOf("AorticLumen");
    const hover = getNiftiHover(sampleNifti, lblOffset);
    assert(hover !== null);
    assert(hover.contents.value.includes("AorticLumen"));

    const completions = getNiftiCompletions(sampleNifti);
    assert(completions.some((c) => c.label === "AorticLumen"));
    assert(completions.some((c) => c.label === "ContrastBolus"));

    const roiLineOffset = sampleNifti.indexOf("ROI id=ROI_AORTA") + 5;
    const def = getNiftiDefinition(sampleNifti, roiLineOffset, "file:///aorta.nii");
    assert(def !== null);
    assert.strictEqual(def.uri, "file:///aorta.nii");

    const daeRes = await executeNiftiAction("nifti_to_dae", sampleNifti);
    assert(daeRes.variableCount >= 8);
  });
});
