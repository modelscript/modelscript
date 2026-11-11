// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeVibrationalSpectrum,
  lintQuantumChemistry,
  parseGaussianDeck,
  renderQuantumChemistrySvg,
} from "@modelscript/diagram/quantum-chemistry";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QuantumChemistryEditorProvider, QuantumChemistryPanel } from "../src/quantum-chemistry-panel.js";

const SAMPLE_GAUSSIAN_FIXTURE = `
#P B3LYP/def2-TZVP Opt Freq

Carbon Dioxide (CO2) Linear Molecule

0 1
C    0.000000    0.000000    0.000000
O    0.000000    0.000000    1.160000
O    0.000000    0.000000   -1.160000

Frequencies --  667.4  1333.1  2349.2
IR Inten    --   45.0     0.0   480.0
Raman Activ --    0.0    95.0     0.0
`;

describe("Quantum Chemistry & Molecular Spectroscopy IDE Panels (Path G)", () => {
  it("exposes QuantumChemistryPanel and QuantumChemistryEditorProvider viewType identifiers", () => {
    assert.equal(QuantumChemistryPanel.viewType, "modelscript.quantumChemistryViewer");
    assert.equal(QuantumChemistryEditorProvider.viewType, "modelscript.quantumChemistryEditor");
  });

  it("constructs quantum chemical calculation from Gaussian deck and renders 3D molecule & IR spectrum", () => {
    const data = parseGaussianDeck(SAMPLE_GAUSSIAN_FIXTURE);
    assert.equal(data.title, "Carbon Dioxide (CO2) Linear Molecule");
    assert.equal(data.method, "B3LYP");
    assert.equal(data.basisSet, "def2-TZVP");
    assert.equal(data.atoms.length, 3);
    assert.equal(data.normalModes.length, 3);

    const diags = lintQuantumChemistry(data);
    assert.equal(diags.filter((d) => d.severity === "error").length, 0);

    const spectrum = computeVibrationalSpectrum(data.normalModes);
    assert.ok(spectrum.points.length > 500);

    const svg = renderQuantumChemistrySvg(data, spectrum, {
      width: 960,
      height: 520,
      selectedMode: 3, // Asymmetric stretch at 2349 cm^-1
      showVectors: true,
      showSpectrum: true,
      spectrumType: "ir",
      darkMode: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Carbon Dioxide (CO2) Linear Molecule"), "Should include calculation title");
    assert.ok(svg.includes("3D Geometry &amp; Normal Mode"), "Should include 3D geometry section");
    assert.ok(svg.includes("Mode #3: 2349.2 cm⁻¹"), "Should label active mode");
    assert.ok(svg.includes("Infrared (IR) Absorption Spectrum"), "Should include IR spectrum title");
    assert.ok(svg.includes("IUPAC Descending Wavenumber"), "Should include IUPAC convention label");
  });
});
