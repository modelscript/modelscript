// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeVibrationalSpectrum,
  convertZMatrixToCartesian,
  lintQuantumChemistry,
  parseGaussianDeck,
  renderQuantumChemistrySvg,
  type QuantumChemistryData,
  type ZMatrixEntry,
} from "../src/quantum-chemistry-builder.js";

const SAMPLE_GAUSSIAN_CARTESIAN = `
#P B3LYP/6-31G(d) Opt Freq

Water Molecule (H2O) Equilibrium Geometry & Frequencies

0 1
O    0.000000    0.000000    0.117720
H    0.000000    0.755453   -0.470880
H    0.000000   -0.755453   -0.470880

Frequencies -- 1612.3  3782.5  3906.4
IR Inten    --   75.4    12.8    48.2
Raman Activ --    8.5    92.1    34.6
`;

const SAMPLE_GAUSSIAN_ZMATRIX = `
# HF/STO-3G Opt Freq

Formaldehyde (H2CO) Z-Matrix

0 1
C
O  1  1.205
H  1  1.100  2  122.5
H  1  1.100  2  122.5  3  180.0
`;

describe("Quantum Chemistry & Molecular Spectroscopy Diagram Builders (Path G)", () => {
  it("parses Gaussian Cartesian input deck with method, basis set, charge, mult, and normal modes", () => {
    const data = parseGaussianDeck(SAMPLE_GAUSSIAN_CARTESIAN);
    assert.strictEqual(data.title, "Water Molecule (H2O) Equilibrium Geometry & Frequencies");
    assert.strictEqual(data.method, "B3LYP");
    assert.strictEqual(data.basisSet, "6-31G(d)");
    assert.strictEqual(data.charge, 0);
    assert.strictEqual(data.multiplicity, 1);
    assert.strictEqual(data.atoms.length, 3);

    const oAtom = data.atoms.find((a) => a.symbol === "O")!;
    assert.strictEqual(oAtom.atomicNumber, 8);
    assert.strictEqual(oAtom.z, 0.11772);

    assert.strictEqual(data.normalModes.length, 3);
    assert.strictEqual(data.normalModes[0]!.frequencyCm1, 1612.3);
    assert.strictEqual(data.normalModes[0]!.irIntensityKmPerMol, 75.4);
    assert.strictEqual(data.normalModes[1]!.frequencyCm1, 3782.5);
    assert.strictEqual(data.normalModes[2]!.frequencyCm1, 3906.4);
  });

  it("converts Z-matrix internal coordinates (r, theta, phi) into 3D Cartesian coordinates", () => {
    const zMatrix: ZMatrixEntry[] = [
      { index: 1, symbol: "C" },
      { index: 2, symbol: "O", bondTo: 1, bondLength: 1.205 },
      { index: 3, symbol: "H", bondTo: 1, bondLength: 1.1, angleTo: 2, angleDeg: 122.5 },
      {
        index: 4,
        symbol: "H",
        bondTo: 1,
        bondLength: 1.1,
        angleTo: 2,
        angleDeg: 122.5,
        dihedralTo: 3,
        dihedralDeg: 180.0,
      },
    ];

    const atoms = convertZMatrixToCartesian(zMatrix);
    assert.strictEqual(atoms.length, 4);
    assert.strictEqual(atoms[0]!.symbol, "C");
    assert.strictEqual(atoms[0]!.x, 0);
    assert.strictEqual(atoms[0]!.y, 0);
    assert.strictEqual(atoms[0]!.z, 0);

    // Atom 2 placed at bond length 1.205 along Z axis
    assert.strictEqual(atoms[1]!.symbol, "O");
    assert.strictEqual(atoms[1]!.z, 1.205);

    // Also test parseGaussianDeck with Z-matrix deck directly
    const deckData = parseGaussianDeck(SAMPLE_GAUSSIAN_ZMATRIX);
    assert.strictEqual(deckData.atoms.length, 4);
    assert.strictEqual(deckData.zMatrix?.length, 4);
    assert.ok(deckData.normalModes.length >= 3);
  });

  it("computes continuous infrared and Raman absorption spectrum using Lorentzian broadening", () => {
    const data = parseGaussianDeck(SAMPLE_GAUSSIAN_CARTESIAN);
    const spec = computeVibrationalSpectrum(data.normalModes, 20.0, 5.0);

    assert.ok(spec.points.length > 500, "Should generate fine-grained wavenumber grid");
    assert.ok(spec.maxAbsorbance > 0.5, "Should compute peak absorbance");
    assert.ok(spec.maxRaman > 0.5, "Should compute peak Raman activity");

    // Locate peak around 1612 cm^-1
    const pt1612 = spec.points.find((p) => Math.abs(p.wavenumber - 1612) <= 5);
    assert.ok(pt1612 !== undefined && pt1612.absorbance > 0.5);

    // Locate peak around 3780 cm^-1
    const pt3780 = spec.points.find((p) => Math.abs(p.wavenumber - 3780) <= 5);
    assert.ok(pt3780 !== undefined && pt3780.ramanIntensity > 0.5);
  });

  it("renders publication-grade SVG with 3D molecular projection, displacement vectors, and IR spectrum", () => {
    const data = parseGaussianDeck(SAMPLE_GAUSSIAN_CARTESIAN);
    const spec = computeVibrationalSpectrum(data.normalModes);

    const svg = renderQuantumChemistrySvg(data, spec, {
      width: 960,
      height: 540,
      selectedMode: 1,
      showVectors: true,
      showSpectrum: true,
      spectrumType: "ir",
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Water Molecule (H2O)"), "Should include calculation title");
    assert.ok(svg.includes("Mode #1: 1612.3 cm⁻¹"), "Should include active mode info");
    assert.ok(svg.includes("Infrared (IR) Absorption Spectrum"), "Should render IR spectrum title");
    assert.ok(svg.includes("IUPAC Descending Wavenumber"), "Should include IUPAC convention label");
    assert.ok(svg.includes("Wavenumber ν̃ (cm⁻¹)"), "Should label wavenumber axis");
  });

  it("evaluates quantum chemistry linter and catches spin parity, steric clash, and gimbal lock", () => {
    const validData = parseGaussianDeck(SAMPLE_GAUSSIAN_CARTESIAN);

    // 1. Clean data: water (10 electrons) with multiplicity 1
    const cleanDiags = lintQuantumChemistry(validData);
    assert.strictEqual(cleanDiags.filter((d) => d.severity === "error").length, 0);

    // 2. Spin parity violation: 10 electrons (even) with doublet multiplicity 2
    const badMultData: QuantumChemistryData = {
      ...validData,
      multiplicity: 2, // Even electrons cannot have even multiplicity!
    };
    const multDiags = lintQuantumChemistry(badMultData);
    assert.ok(multDiags.some((d) => d.code === "QC1001" && d.severity === "error"));

    // 3. Steric collision: atoms placed 0.2 Angstroms apart
    const clashData: QuantumChemistryData = {
      ...validData,
      atoms: [
        validData.atoms[0]!,
        { ...validData.atoms[1]!, x: 0.1, y: 0.0, z: 0.12 }, // Extremely close to O at (0, 0, 0.117)
        validData.atoms[2]!,
      ],
    };
    const clashDiags = lintQuantumChemistry(clashData);
    assert.ok(clashDiags.some((d) => d.code === "QC1002" && d.severity === "error"));

    // 4. Z-Matrix collinear gimbal lock: angle = 180 degrees
    const gimbalData: QuantumChemistryData = {
      ...validData,
      zMatrix: [
        { index: 1, symbol: "C" },
        { index: 2, symbol: "O", bondTo: 1, bondLength: 1.2 },
        { index: 3, symbol: "H", bondTo: 1, bondLength: 1.1, angleTo: 2, angleDeg: 180.0 },
      ],
    };
    const gimbalDiags = lintQuantumChemistry(gimbalData);
    assert.ok(gimbalDiags.some((d) => d.code === "QC1004" && d.severity === "warning"));
  });
});
