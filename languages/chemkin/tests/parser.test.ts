// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChemkin } from "../src/index.js";

const SAMPLE_DECK = `! Sandia CHEMKIN H2/O2 sample mechanism
ELEMENTS
  H O N AR/39.948/
END

SPECIES
  H2 O2 H2O OH H O HO2 N2
END

THERMO ALL
   300.000  1000.000  5000.000
H2O               L 8/89H   2O   1    0    0G   200.000  3500.000  1000.000    1
 3.03399249E+00 2.17691804E-03-1.64072518E-07-9.70419870E-11 1.68200992E-14    2
-3.00042971E+04 4.96677010E+00 4.19864056E+00-2.03643410E-03 6.52040211E-06    3
-5.48797062E-09 1.77197817E-12-3.02937267E+04-8.49032208E-01                   4
END

REACTIONS KCAL/MOLE MOLES
  ! Chain branching
  H + O2 <=> O + OH                 1.915E+14   0.00   16.44
  O + H2 = H + OH                   5.080E+04   2.67    6.29
  H2 + O2 => 2 OH                   1.700E+13   0.00   47.78
  ! Three-body recombination
  H + OH + M <=> H2O + M            2.200E+22  -2.00    0.00
    H2/2.5/ H2O/12.0/ N2/1.0/
  ! Falloff reaction with LOW + TROE
  H + O2 (+M) <=> HO2 (+M)          1.475E+12   0.60    0.00
    LOW / 6.366E+20 -1.72 0.525 /
    TROE / 0.5 1.0E-30 1.0E+30 1.0E+100 /
    H2/2.0/ H2O/11.0/
  ! Duplicate reaction pair
  HO2 + HO2 <=> H2O + O2            1.300E+11   0.00   -1.63
    DUPLICATE
  HO2 + HO2 <=> H2O + O2            4.200E+14   0.00   11.98
    DUP
  ! Explicit REV and PLOG + SRI
  O + O + M <=> O2 + M              1.890E+13   0.00   -1.788
    REV / 1.800E+18 -1.00 118.0 /
  H + O2 <=> HO2                    1.000E+12   0.00    0.00
    PLOG / 0.1 1.0E+11 0.0 0.0 /
    PLOG / 1.0 1.0E+12 0.0 0.0 /
    PLOG / 10.0 5.0E+12 0.0 0.0 /
END
`;

describe("@modelscript/chemkin — Deck Parser", () => {
  it("parses ELEMENTS, SPECIES, fixed-column NASA-7 THERMO, and REACTIONS sections", () => {
    const doc = parseChemkin(SAMPLE_DECK, "h2o2.inp");
    const m = doc.mechanism;

    assert.equal(m.name, "h2o2");
    assert.equal(m.parseErrors.length, 0);
    assert.equal(m.energyUnits, "KCAL/MOLE");
    assert.equal(m.quantityUnits, "MOLES");

    // Elements (including custom atomic weight)
    assert.deepEqual(Array.from(m.elements.keys()), ["H", "O", "N", "AR"]);
    assert.equal(m.elements.get("AR")?.atomicWeight, 39.948);

    // Species
    assert.equal(m.species.size, 8);
    assert.ok(m.species.has("H2O"));
    assert.ok(m.species.has("HO2"));

    // Default thermo temps + H2O 14-coeff NASA-7 record
    assert.deepEqual(m.defaultThermoTemps, [300, 1000, 5000]);
    const h2o = m.thermo.get("H2O");
    assert.ok(h2o);
    assert.equal(h2o.phase, "G");
    assert.deepEqual(h2o.composition, { H: 2, O: 1 });
    assert.equal(h2o.tLow, 200);
    assert.equal(h2o.tMid, 1000);
    assert.equal(h2o.tHigh, 3500);
    assert.equal(h2o.highCoeffs.length, 7);
    assert.equal(h2o.lowCoeffs.length, 7);
    assert.ok(Math.abs(h2o.highCoeffs[0] - 3.03399249) < 1e-7);
    assert.ok(Math.abs(h2o.highCoeffs[5] - -30004.2971) < 1e-3);
    assert.ok(Math.abs(h2o.lowCoeffs[6] - -0.849032208) < 1e-7);

    // Reactions
    assert.equal(m.reactions.length, 9);
    assert.equal(m.reactions[0]!.reversible, true);
    assert.equal(m.reactions[1]!.reversible, true);
    assert.equal(m.reactions[2]!.reversible, false);
    assert.equal(m.reactions[2]!.products[0]!.stoichiometry, 2);

    // Three-body efficiencies
    const r3 = m.reactions[3]!;
    assert.equal(r3.thirdBody, true);
    assert.equal(r3.efficiencies["H2"], 2.5);
    assert.equal(r3.efficiencies["H2O"], 12.0);

    // Falloff + LOW + TROE
    const r4 = m.reactions[4]!;
    assert.equal(r4.falloff, true);
    assert.ok(r4.low);
    assert.equal(r4.low.A, 6.366e20);
    assert.equal(r4.low.b, -1.72);
    assert.ok(r4.troe);
    assert.equal(r4.troe.a, 0.5);
    assert.equal(r4.troe.T2, 1e100);

    // DUPLICATE / DUP
    assert.equal(m.reactions[5]!.duplicate, true);
    assert.equal(m.reactions[6]!.duplicate, true);

    // Explicit REV
    assert.ok(m.reactions[7]!.rev);
    assert.equal(m.reactions[7]!.rev!.A, 1.8e18);

    // PLOG
    assert.equal(m.reactions[8]!.plog?.length, 3);
    assert.equal(m.reactions[8]!.plog?.[1]?.pressureAtm, 1.0);
  });

  it("supports short section aliases (ELEM, SPEC, REAC) and alternative unit keywords", () => {
    const deck = `
ELEM H O END
SPEC H2 O2 H2O END
REAC JOULES/MOLE MOLECULES
  2H2 + O2 => 2H2O  1.0E-10 0.0 40000.0
    SRI / 0.5 100.0 2000.0 1.0 0.0 /
END
`;
    const doc = parseChemkin(deck, "short.ck");
    assert.equal(doc.mechanism.energyUnits, "JOULES/MOLE");
    assert.equal(doc.mechanism.quantityUnits, "MOLECULES");
    assert.equal(doc.mechanism.elements.size, 2);
    assert.equal(doc.mechanism.species.size, 3);
    assert.equal(doc.mechanism.reactions.length, 1);
    assert.equal(doc.mechanism.reactions[0]!.reactants[0]!.stoichiometry, 2);
    assert.ok(doc.mechanism.reactions[0]!.sri);
    assert.equal(doc.mechanism.reactions[0]!.sri!.a, 0.5);
    assert.equal(doc.mechanism.reactions[0]!.sri!.d, 1.0);
  });
});
