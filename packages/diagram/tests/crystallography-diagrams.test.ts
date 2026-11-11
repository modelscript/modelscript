// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDSpacing,
  calculateUnitCellVolume,
  fractionalToCartesian,
  lintCrystalStructure,
  parseCif,
  renderCrystalUnitCellSvg,
  renderPxrdSvg,
  simulatePxrd,
  type CrystalStructure,
  type CrystalUnitCell,
} from "../src/crystallography-builder.js";

describe("Materials Science & Crystallography Diagram Builders (Path F)", () => {
  const SAMPLE_NACL_CIF = `
data_NaCl
_chemical_name_systematic 'Sodium Chloride'
_chemical_formula_sum 'Cl Na'
_symmetry_space_group_name_H-M 'F m -3 m'
_cell_length_a 5.6402
_cell_length_b 5.6402
_cell_length_c 5.6402
_cell_angle_alpha 90.00
_cell_angle_beta 90.00
_cell_angle_gamma 90.00

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na1 Na 0.0000 0.0000 0.0000
Na2 Na 0.5000 0.5000 0.0000
Na3 Na 0.5000 0.0000 0.5000
Na4 Na 0.0000 0.5000 0.5000
Cl1 Cl 0.5000 0.0000 0.0000
Cl2 Cl 0.0000 0.5000 0.0000
Cl3 Cl 0.0000 0.0000 0.5000
Cl4 Cl 0.5000 0.5000 0.5000
`;

  it("parses CIF document and computes unit cell volume and orthogonal Cartesian coordinates", () => {
    const structure = parseCif(SAMPLE_NACL_CIF);
    assert.strictEqual(structure.name, "NaCl");
    assert.strictEqual(structure.spaceGroup, "F m -3 m");
    assert.strictEqual(structure.cell.a, 5.6402);
    assert.strictEqual(structure.cell.b, 5.6402);
    assert.strictEqual(structure.cell.c, 5.6402);
    assert.strictEqual(structure.atoms.length, 8);

    // V = a^3 for cubic
    const expectedV = 5.6402 ** 3;
    assert.ok(Math.abs(structure.cell.volume - expectedV) < 0.1, `Volume should be approx ${expectedV.toFixed(2)}`);

    // Verify fractional to Cartesian conversion of Cl4 (0.5, 0.5, 0.5)
    const [x, y, z] = fractionalToCartesian(0.5, 0.5, 0.5, structure.cell);
    assert.ok(Math.abs(x - 2.8201) < 1e-3);
    assert.ok(Math.abs(y - 2.8201) < 1e-3);
    assert.ok(Math.abs(z - 2.8201) < 1e-3);
  });

  it("calculates unit cell volume for non-orthogonal monoclinic and triclinic lattices", () => {
    // Monoclinic cell: a=5, b=6, c=7, alpha=90, beta=110, gamma=90
    const vMono = calculateUnitCellVolume(5, 6, 7, 90, 110, 90);
    // V = a*b*c*sin(beta)
    const expectedMono = 5 * 6 * 7 * Math.sin((110 * Math.PI) / 180);
    assert.ok(Math.abs(vMono - expectedMono) < 1e-3, `Monoclinic volume must match a*b*c*sin(beta)`);

    // Orthogonal cubic cell: a=b=c=10, alpha=beta=gamma=90
    const vCubic = calculateUnitCellVolume(10, 10, 10, 90, 90, 90);
    assert.ok(Math.abs(vCubic - 1000.0) < 1e-3);
  });

  it("renders 3D depth-sorted unit cell SVG with atomic spheres, wireframe, and Miller plane (111)", () => {
    const structure = parseCif(SAMPLE_NACL_CIF);
    const svg = renderCrystalUnitCellSvg(structure, {
      elevationDeg: 25,
      azimuthDeg: 35,
      millerPlane: { h: 1, k: 1, l: 1 },
      darkMode: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("NaCl"), "Should render crystal title");
    assert.ok(svg.includes("F m -3 m"), "Should render space group badge");
    assert.ok(svg.includes("<line"), "Should render unit cell wireframe edges");
    assert.ok(svg.includes("<polygon"), "Should render Miller (111) plane polygon");
    assert.ok(svg.includes("(111)"), "Should label Miller index plane");
    assert.ok(svg.includes("<circle"), "Should render atomic spheres with CPK radial gradients");
    assert.ok(svg.includes("Na"), "Should display elemental text inside sodium sphere");
    assert.ok(svg.includes("Cl"), "Should display elemental text inside chlorine sphere");
  });

  it("simulates Powder X-ray Diffraction (PXRD) Bragg peaks and renders pattern SVG", () => {
    const structure = parseCif(SAMPLE_NACL_CIF);
    const peaks = simulatePxrd(structure, {
      wavelengthAngstrom: 1.5406, // Cu K_alpha
      minTwoTheta: 10,
      maxTwoTheta: 75,
    });

    assert.ok(peaks.length > 0, "Should generate Bragg reflection peaks");
    // Interplanar spacing for (111) reflection in NaCl: d = a / sqrt(3) = 5.6402 / 1.732 = 3.256 Å
    const d111 = calculateDSpacing(1, 1, 1, structure.cell);
    assert.ok(Math.abs(d111 - 3.256) < 0.05, `d(111) should be approx 3.256 Å, got ${d111}`);

    const svg = renderPxrdSvg(peaks, { darkMode: true });
    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Powder X-ray Diffraction"), "Should render PXRD title");
    assert.ok(svg.includes("Diffraction Angle 2θ"), "Should render 2θ axis label");
    assert.ok(svg.includes("<path"), "Should render continuous pseudo-Voigt diffraction profile");
  });

  it("evaluates materials science crystallographic linter and detects steric clash and bad bounds", () => {
    const validStructure = parseCif(SAMPLE_NACL_CIF);
    const cleanDiag = lintCrystalStructure(validStructure);
    assert.strictEqual(cleanDiag.length, 0, "Valid NaCl crystal should trigger 0 diagnostics");

    const cell: CrystalUnitCell = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90, volume: 64 };
    const badStructure: CrystalStructure = {
      id: "broken_crystal",
      name: "Broken Crystal",
      formula: "Fe2",
      spaceGroup: "", // Missing space group!
      cell,
      atoms: [
        { label: "Fe1", element: "Fe", fractX: 0.1, fractY: 0.1, fractZ: 0.1, cartX: 0.4, cartY: 0.4, cartZ: 0.4 },
        {
          label: "Fe2",
          element: "Fe",
          fractX: 0.105,
          fractY: 0.105,
          fractZ: 0.105,
          cartX: 0.42,
          cartY: 0.42,
          cartZ: 0.42,
        }, // Steric clash! d < 0.1 Å
        { label: "Fe3", element: "Fe", fractX: 3.5, fractY: 0.0, fractZ: 0.0 }, // Out of bounds fractX!
      ],
    };

    const diagnostics = lintCrystalStructure(badStructure);
    assert.ok(
      diagnostics.some((d) => d.code === "MAT1001"),
      "Should detect missing space group",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "MAT1002"),
      "Should detect fractional coordinate out of bounds",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "MAT1003"),
      "Should detect atomic steric clash",
    );
  });
});
