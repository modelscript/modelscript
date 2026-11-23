// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintChemkin, parseChemkin } from "../src/index.js";

describe("@modelscript/chemkin — Lints & Diagnostics (CK1001–CK5006)", () => {
  it("reports zero errors on a well-formed, balanced CHEMKIN mechanism", () => {
    const deck = `
ELEMENTS H O END
SPECIES H2 O2 H2O END
THERMO ALL
  300.0 1000.0 5000.0
H2    H 2 G 200.0 3500.0 1000.0 1
  3.337E+00 -4.940E-05 4.994E-07 -1.795E-10 2.002E-14 2
  -9.501E+02 -3.205E+00 2.344E+00 7.980E-03 -1.947E-05 3
  2.015E-08 -7.376E-12 -9.179E+02 6.830E-01 4
O2    O 2 G 200.0 3500.0 1000.0 1
  3.282E+00 1.483E-03 -7.579E-07 2.094E-10 -2.167E-14 2
  -1.088E+03 5.453E+00 3.782E+00 -2.996E-03 9.847E-06 3
  -9.681E-09 3.243E-12 -1.063E+03 3.657E+00 4
H2O   H 2 O 1 G 200.0 3500.0 1000.0 1
  3.033E+00 2.176E-03 -1.640E-07 -9.704E-11 1.682E-14 2
  -3.000E+04 4.966E+00 4.198E+00 -2.036E-03 6.520E-06 3
  -5.487E-09 1.771E-12 -3.029E+04 -8.490E-01 4
END
REACTIONS
  2 H2 + O2 <=> 2 H2O  1.0E+13 0.0 40000.0
END
`;
    const diags = lintChemkin(parseChemkin(deck));
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects duplicate elements (CK2001) and duplicate species (CK2002)", () => {
    const deck = `
ELEMENTS H O H END
SPECIES H2 O2 H2 END
REACTIONS
  H2 + O2 => H2 + O2  1.0E+10 0.0 0.0
END
`;
    const diags = lintChemkin(parseChemkin(deck));
    assert.ok(
      diags.some((d) => d.code === "CK2001"),
      "Expected CK2001 duplicate element",
    );
    assert.ok(
      diags.some((d) => d.code === "CK2002"),
      "Expected CK2002 duplicate species",
    );
  });

  it("detects undeclared species in REACTIONS (CK2003) and undeclared element in THERMO (CK2004)", () => {
    const deck = `
ELEMENTS H O END
SPECIES H2 O2 CH4 END
THERMO ALL
  300.0 1000.0 5000.0
CH4   C 1 H 4 G 200.0 3500.0 1000.0 1
  7.485E-02 1.339E-02 -5.732E-06 1.222E-09 -1.018E-13 2
  -9.468E+03 1.843E+01 5.149E+00 -1.367E-02 4.918E-05 3
  -4.847E-08 1.666E-11 -1.024E+04 -4.641E+00 4
END
REACTIONS
  H2 + OH => H2O + H  1.0E+13 0.0 5000.0
END
`;
    const diags = lintChemkin(parseChemkin(deck));
    assert.ok(
      diags.some((d) => d.code === "CK2003" && d.message.includes("OH")),
      "Expected CK2003 for OH",
    );
    assert.ok(
      diags.some((d) => d.code === "CK2004" && d.message.includes("'C'")),
      "Expected CK2004 for C",
    );
  });

  it("detects stoichiometric element imbalance (CK3001) and duplicate reaction without DUPLICATE (CK3002)", () => {
    const deck = `
ELEMENTS H O END
SPECIES H2 O2 H2O END
REACTIONS
  H2 + O2 => H2O       1.0E+13 0.0 10000.0
  2 H2 + O2 <=> 2 H2O  1.0E+13 0.0 20000.0
  2 H2 + O2 <=> 2 H2O  2.0E+14 0.0 30000.0
END
`;
    const diags = lintChemkin(parseChemkin(deck));
    assert.ok(
      diags.some((d) => d.code === "CK3001"),
      "Expected CK3001 stoichiometric imbalance",
    );
    assert.ok(
      diags.some((d) => d.code === "CK3002"),
      "Expected CK3002 duplicate reaction without DUPLICATE",
    );
  });

  it("detects missing THERMO (CK4001), invalid NASA-7 temperature range (CK4002), negative A (CK5001), and missing LOW (CK5002)", () => {
    const deck = `
ELEMENTS H O END
SPECIES H2 O2 H2O END
THERMO ALL
  300.0 1000.0 5000.0
H2O   H 2 O 1 G 1500.0 3500.0 1000.0 1
  3.033E+00 2.176E-03 -1.640E-07 -9.704E-11 1.682E-14 2
  -3.000E+04 4.966E+00 4.198E+00 -2.036E-03 6.520E-06 3
  -5.487E-09 1.771E-12 -3.029E+04 -8.490E-01 4
END
REACTIONS
  2 H2 + O2 <=> 2 H2O        -1.0E+13 0.0 10000.0
  2 H2 + O2 (+M) <=> 2 H2O (+M)  1.0E+12 0.0 0.0
END
`;
    const diags = lintChemkin(parseChemkin(deck));
    assert.ok(
      diags.some((d) => d.code === "CK4001" && d.message.includes("H2")),
      "Expected CK4001 missing thermo",
    );
    assert.ok(
      diags.some((d) => d.code === "CK4002"),
      "Expected CK4002 invalid thermo range",
    );
    assert.ok(
      diags.some((d) => d.code === "CK5001"),
      "Expected CK5001 negative pre-exponential A",
    );
    assert.ok(
      diags.some((d) => d.code === "CK5002"),
      "Expected CK5002 falloff missing LOW",
    );
  });

  it("detects syntax errors (CK1001) and empty mechanisms (CK5006)", () => {
    const emptyDiags = lintChemkin(parseChemkin("! empty file\n"));
    assert.ok(
      emptyDiags.some((d) => d.code === "CK5006"),
      "Expected CK5006 on empty mechanism",
    );

    const badRxn = `
ELEMENTS H END
SPECIES H2 END
REACTIONS
  H2 => H2 NOT_A_NUMBER
END
`;
    const syntaxDiags = lintChemkin(parseChemkin(badRxn));
    assert.ok(
      syntaxDiags.some((d) => d.code === "CK1001"),
      "Expected CK1001 on malformed reaction line",
    );
  });
});
