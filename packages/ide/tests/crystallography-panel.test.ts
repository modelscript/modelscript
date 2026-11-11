// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCif, renderCrystalUnitCellSvg, renderPxrdSvg, simulatePxrd } from "@modelscript/diagram/crystallography";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CrystallographyEditorProvider, CrystallographyPanel } from "../src/crystallography-panel.js";

const SAMPLE_DIAMOND_CIF = `
data_Diamond
_chemical_name_systematic 'Diamond'
_chemical_formula_sum 'C'
_symmetry_space_group_name_H-M 'F d -3 m'
_cell_length_a 3.567
_cell_length_b 3.567
_cell_length_c 3.567
_cell_angle_alpha 90.00
_cell_angle_beta 90.00
_cell_angle_gamma 90.00

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0.0000 0.0000 0.0000
C2 C 0.2500 0.2500 0.2500
`;

describe("Crystallography & Materials Structure Visualizer Panel (Path F)", () => {
  it("exposes CrystallographyPanel and CrystallographyEditorProvider viewType identifiers", () => {
    assert.equal(CrystallographyPanel.viewType, "modelscript.crystallographyViewer");
    assert.equal(CrystallographyEditorProvider.viewType, "modelscript.crystallographyEditor");
  });

  it("constructs crystal unit cell from CIF and renders 3D wireframe SVG with atomic spheres", () => {
    const structure = parseCif(SAMPLE_DIAMOND_CIF);
    assert.equal(structure.name, "Diamond");
    assert.equal(structure.spaceGroup, "F d -3 m");
    assert.equal(structure.cell.a, 3.567);

    const svg = renderCrystalUnitCellSvg(structure, {
      azimuthDeg: 45,
      elevationDeg: 30,
      millerPlane: { h: 1, k: 1, l: 0 },
      darkMode: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Diamond"), "Should render crystal title");
    assert.ok(svg.includes("F d -3 m"), "Should display space group");
    assert.ok(svg.includes("<polygon"), "Should render Miller (110) plane polygon");
    assert.ok(svg.includes("(110)"), "Should label Miller index plane");
    assert.ok(svg.includes("<circle"), "Should render atomic carbon spheres");
    assert.ok(svg.includes("C"), "Should label carbon atom elements");
  });

  it("simulates Bragg diffraction peaks and renders Powder XRD pattern SVG", () => {
    const structure = parseCif(SAMPLE_DIAMOND_CIF);
    const peaks = simulatePxrd(structure, { wavelengthAngstrom: 1.5406 });
    assert.ok(peaks.length > 0, "Diamond should produce Bragg diffraction peaks");

    const svg = renderPxrdSvg(peaks, { darkMode: true });
    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Powder X-ray Diffraction"), "Should display PXRD title");
    assert.ok(svg.includes("Diffraction Angle 2θ"), "Should include 2θ axis label");
    assert.ok(svg.includes("<path"), "Should render continuous pseudo-Voigt diffraction trace");
  });
});
