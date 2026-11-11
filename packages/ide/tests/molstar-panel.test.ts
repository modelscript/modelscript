// SPDX-License-Identifier: AGPL-3.0-or-later

import { parsePdb, solveProteinBiophysics } from "@modelscript/pdb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MolstarPanel, PdbEditorProvider, renderMolstarHtml } from "../src/molstar-panel.js";

const SAMPLE_1CRN_PDB = `
HEADER    PLANT PROTEIN                           30-APR-81   1CRN
TITLE     WATER STRUCTURE OF A HYDROPHOBIC PROTEIN AT ATOMIC RESOLUTION.
ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N
ATOM      2  CA  THR A   1      16.967  12.784   4.338  1.00 10.80           C
ATOM      3  C   THR A   1      15.685  12.755   5.133  1.00  9.19           C
ATOM      4  O   THR A   1      15.268  13.825   5.594  1.00  9.85           O
ATOM      5  N   THR A   2      15.115  11.555   5.265  1.00  7.67           N
ATOM      6  CA  THR A   2      13.856  11.469   6.066  1.00  8.56           C
ATOM      7  C   THR A   2      14.164  10.785   7.379  1.00  8.00           C
ATOM      8  O   THR A   2      14.993   9.862   7.443  1.00  8.61           O
ATOM      9  N   CYS A   3      13.488  11.241   8.417  1.00  7.87           N
ATOM     10  CA  CYS A   3      13.660  10.707   9.756  1.00  8.25           C
ATOM     11  C   CYS A   3      12.269  10.428  10.366  1.00  7.91           C
ATOM     12  O   CYS A   3      11.408  11.311  10.320  1.00  9.60           O
ATOM     13  N   CYS A   4      12.062   9.208  10.884  1.00  7.24           N
ATOM     14  CA  CYS A   4      10.781   8.825  11.530  1.00  7.89           C
ATOM     15  C   CYS A   4      10.999   7.653  12.476  1.00  7.92           C
ATOM     16  O   CYS A   4      12.124   7.360  12.879  1.00  7.68           O
ATOM     17  N   PRO A   5       9.914   6.969  12.837  1.00  7.91           N
ATOM     18  CA  PRO A   5      10.024   5.787  13.722  1.00  8.85           C
ATOM     19  C   PRO A   5       9.932   4.469  12.969  1.00  8.13           C
ATOM     20  O   PRO A   5       9.060   4.316  12.115  1.00  8.79           O
END
`;

describe("Molstar 3D Macromolecular Visualizer & Ramachandran Dashboard", () => {
  it("renders rich HTML shell with 3D canvas and Ramachandran plot", () => {
    const doc = parsePdb(SAMPLE_1CRN_PDB);
    const biophysics = solveProteinBiophysics(doc);
    const html = renderMolstarHtml(doc, biophysics);

    // Verify title and structure badge
    assert.ok(html.includes("1CRN"), "Should render structure ID badge");
    assert.ok(html.includes("HYDROPHOBIC PROTEIN"), "Should render title");

    // Verify 3D canvas and buttons
    assert.ok(html.includes('id="gl-canvas"'), "Should contain 3D WebGL canvas element");
    assert.ok(html.includes("Simulate Normal Mode"), "Should contain GNM normal mode button");
    assert.ok(html.includes("Color: Structure"), "Should contain structure color toggle");

    // Verify Ramachandran canvas and tooltip
    assert.ok(html.includes('id="rama-canvas"'), "Should contain Ramachandran canvas");
    assert.ok(html.includes('id="rama-tooltip"'), "Should contain Ramachandran tooltip container");

    // Verify biophysics metric values
    assert.ok(html.includes("Molecular Weight"), "Should display molecular weight card");
    assert.ok(html.includes("Radius of Gyration"), "Should display radius of gyration card");
    assert.ok(html.includes("End-to-End Distance"), "Should display end-to-end distance card");
  });

  it("embeds C_alpha coordinates and Ramachandran phi/psi angles in client script", () => {
    const doc = parsePdb(SAMPLE_1CRN_PDB);
    const biophysics = solveProteinBiophysics(doc);
    const html = renderMolstarHtml(doc, biophysics);

    assert.ok(html.includes("const caAtoms ="), "Should embed CA atom coordinates array");
    assert.ok(html.includes("const ramaPoints ="), "Should embed Ramachandran angle points array");

    // Check that at least 5 CA atoms exist
    assert.ok(biophysics.caAtoms.length >= 5);
    assert.equal(biophysics.caAtoms[0]!.resName, "THR");
    assert.equal(biophysics.caAtoms[4]!.resName, "PRO");
  });

  it("exposes MolstarPanel and PdbEditorProvider viewType identifiers", () => {
    assert.equal(MolstarPanel.viewType, "modelscript.molstarViewer");
    assert.equal(PdbEditorProvider.viewType, "modelscript.pdbEditor");
  });

  it("renders Normal Mode Dynamic Wave Controller and residue focus indicator", () => {
    const doc = parsePdb(SAMPLE_1CRN_PDB);
    const biophysics = solveProteinBiophysics(doc);
    const html = renderMolstarHtml(doc, biophysics);

    // Dynamic wave controller controls
    assert.ok(html.includes("Normal Mode Dynamic Wave Controller"), "Should contain Wave Controller title");
    assert.ok(html.includes('id="slider-freq"'), "Should contain frequency slider");
    assert.ok(html.includes('id="slider-amp"'), "Should contain amplitude slider");
    assert.ok(html.includes('id="select-wave-mode"'), "Should contain mode selector");
    assert.ok(html.includes('id="btn-gnm-play"'), "Should contain wave play/pause button");
    assert.ok(html.includes("Mode 1: Breathing"), "Should list breathing mode");
    assert.ok(html.includes("Mode 2: Bending"), "Should list bending mode");
    assert.ok(html.includes("Mode 3: Twisting"), "Should list twisting mode");

    // Residue Focus status badge
    assert.ok(html.includes('id="selected-residue-badge"'), "Should contain residue focus badge");
    assert.ok(html.includes("Residue Focus:"), "Should contain residue focus label");
  });
});
