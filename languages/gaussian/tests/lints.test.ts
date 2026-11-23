// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintGaussianText } from "../src/index.js";

describe("@modelscript/gaussian — Lints & Diagnostics (GAU1001–GAU5006)", () => {
  it("reports zero errors on a valid closed-shell Water Z-matrix", () => {
    const valid = `%chk=h2o.chk
%mem=2GB
%nprocshared=4
#p B3LYP/6-31G(d) opt freq

Water molecule

0 1
O
H 1 rOH
H 1 rOH 2 aHOH
Variables:
rOH = 0.9572
aHOH = 104.52
`;
    const diags = lintGaussianText(valid);
    const errors = diags.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.map((e) => e.message).join("; ")}`);
  });

  it("reports GAU1002 when route section '#' is missing", () => {
    const missingRoute = `%chk=test.chk

Title without route

0 1
H 0.0 0.0 0.0
H 0.0 0.0 0.74
`;
    const diags = lintGaussianText(missingRoute);
    assert.ok(
      diags.some((d) => d.id === "GAU1002"),
      "Expected GAU1002 missing-route-section",
    );
  });

  it("enforces charge/spin multiplicity electron-count parity (GAU3001 & GAU3002)", () => {
    // Water has 10 electrons (even): multiplicity 2 (even) is illegal -> GAU3001
    const badEvenParity = `# HF/STO-3G

Invalid Water doublet

0 2
O 0.0 0.0 0.0
H 0.0 0.75 0.58
H 0.0 -0.75 0.58
`;
    const d1 = lintGaussianText(badEvenParity);
    assert.ok(
      d1.some((d) => d.id === "GAU3001"),
      "Expected GAU3001 for 10-electron doublet",
    );

    // Hydroxyl radical OH has 9 electrons (odd): multiplicity 1 (odd) is illegal -> GAU3001
    const badOddParity = `# HF/STO-3G

Invalid OH singlet

0 1
O 0.0 0.0 0.0
H 0.0 0.0 0.97
`;
    const d2 = lintGaussianText(badOddParity);
    assert.ok(
      d2.some((d) => d.id === "GAU3001"),
      "Expected GAU3001 for 9-electron singlet",
    );

    // Valid OH radical (9 electrons, doublet mult=2) -> no GAU3001
    const validRadical = `# HF/STO-3G

Valid OH radical doublet

0 2
O 0.0 0.0 0.0
H 0.0 0.0 0.97
`;
    const d3 = lintGaussianText(validRadical);
    assert.equal(d3.filter((d) => d.severity === "error").length, 0);

    // Valid OH- anion (10 electrons, singlet mult=1) -> no GAU3001
    const validAnion = `# HF/STO-3G

Valid OH- anion singlet

-1 1
O 0.0 0.0 0.0
H 0.0 0.0 0.97
`;
    const d4 = lintGaussianText(validAnion);
    assert.equal(d4.filter((d) => d.severity === "error").length, 0);

    // Multiplicity <= 0 -> GAU3002
    const badMultZero = `# HF/STO-3G

Zero multiplicity

0 0
H 0.0 0.0 0.0
H 0.0 0.0 0.74
`;
    const d5 = lintGaussianText(badMultZero);
    assert.ok(
      d5.some((d) => d.id === "GAU3002"),
      "Expected GAU3002 for multiplicity 0",
    );
  });

  it("detects unknown element (GAU2001), undefined variable (GAU2002), invalid Z-matrix ref (GAU4001), and non-positive bond length (GAU4004)", () => {
    const badZmat = `# B3LYP/6-31G(d)

Broken Z-Matrix

0 1
Zz
H 1 -0.5
H 3 rMissing 1 104.5
`;
    const diags = lintGaussianText(badZmat);
    assert.ok(
      diags.some((d) => d.id === "GAU2001"),
      "Expected GAU2001 unknown-element",
    );
    assert.ok(
      diags.some((d) => d.id === "GAU4004"),
      "Expected GAU4004 non-positive-bond-length",
    );
    assert.ok(
      diags.some((d) => d.id === "GAU4001"),
      "Expected GAU4001 zmatrix-invalid-atom-ref",
    );
    assert.ok(
      diags.some((d) => d.id === "GAU2002"),
      "Expected GAU2002 undefined-zmatrix-variable",
    );
  });

  it("detects collinear Z-matrix reference atoms for dihedral angle (GAU4003)", () => {
    const collinear = `# HF/STO-3G

Collinear dihedral ref

0 1
C
C 1 1.20
H 2 1.06 1 180.0
H 1 1.06 2 120.0 3 0.0
`;
    const diags = lintGaussianText(collinear);
    assert.ok(
      diags.some((d) => d.id === "GAU4003"),
      "Expected GAU4003 zmatrix-collinear-reference",
    );
    assert.ok(
      diags.some((d) => d.id === "GAU4005"),
      "Expected GAU4005 invalid-bond-angle for 180 deg",
    );
  });

  it("validates %mem (GAU5001) and %nproc/%nprocshared (GAU5002) and overlapping atoms (GAU5006)", () => {
    const badDirectives = `%mem=invalid_size
%nprocshared=0
%nproc=-2
# HF/STO-3G

Bad directives and overlapping atoms

0 1
H 0.0 0.0 0.0
H 0.0 0.0 0.1
`;
    const diags = lintGaussianText(badDirectives);
    assert.ok(
      diags.some((d) => d.id === "GAU5001"),
      "Expected GAU5001 invalid-mem-directive",
    );
    assert.equal(
      diags.filter((d) => d.id === "GAU5002").length,
      2,
      "Expected two GAU5002 diagnostics for %nprocshared=0 and %nproc=-2",
    );
    assert.ok(
      diags.some((d) => d.id === "GAU5006"),
      "Expected GAU5006 overlapping-atoms",
    );
  });
});
