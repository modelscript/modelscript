// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATCOM_AIRCRAFT_TEMPLATES } from "../src/catalog/datcom-std-schemas.js";
import { parseDatcomDeck } from "../src/parser/deck-parser.js";

describe("DATCOM Deck Parser", () => {
  it("parses Cessna-172 template with all NAMELISTs and control cards", () => {
    const deck = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.cases.length, 1);

    const c = deck.cases[0]!;
    assert.strictEqual(c.caseId, "CESSNA 172 CLASS TRAINER");
    assert.strictEqual(c.dim, "M");
    assert.strictEqual(c.deriv, "DEG");
    assert.strictEqual(c.damp, true);
    assert.strictEqual(c.build, true);

    assert.ok(c.fltcon);
    assert.strictEqual(c.fltcon.NMACH, 1);
    assert.deepStrictEqual(c.fltcon.MACH, [0.18]);
    assert.strictEqual(c.fltcon.NALPHA, 7);
    assert.deepStrictEqual(c.fltcon.ALSCHD, [-4, -2, 0, 2, 4, 6, 8]);
    assert.strictEqual(c.fltcon.WT, 10230);

    assert.ok(c.optins);
    assert.strictEqual(c.optins.SREF, 16.17);
    assert.strictEqual(c.optins.CBARR, 1.49);
    assert.strictEqual(c.optins.BLREF, 10.92);

    assert.ok(c.synths);
    assert.strictEqual(c.synths.XCG, 2.55);
    assert.strictEqual(c.synths.VERTUP, true);

    assert.ok(c.wgplnf);
    assert.strictEqual(c.wgplnf.CHRDR, 1.63);
    assert.strictEqual(c.wgplnf.CHRDTP, 1.12);
    assert.strictEqual(c.wgplnf.SSPN, 5.46);

    assert.strictEqual(c.nacaCards.length, 3);
    assert.strictEqual(c.nacaCards[0]!.surface, "W");
    assert.strictEqual(c.nacaCards[0]!.series, 4);
    assert.strictEqual(c.nacaCards[0]!.designation, "2412");
  });

  it("handles multi-case decks with SAVE inheritance and NEXT CASE", () => {
    const src = [
      "CASEID BASELINE CASE",
      "DIM FT",
      "DERIV RAD",
      "SAVE",
      " $FLTCON NMACH=1.0, MACH(1)=0.3, NALPHA=3.0, ALSCHD(1)=0.0,2.0,4.0$",
      " $WGPLNF CHRDR=6.0, CHRDTP=3.0, SSPN=18.0, SAVSI=10.0, CHSTAT=0.25$",
      "NACA-W-4-0012",
      "NEXT CASE",
      "CASEID HIGH MACH CASE",
      " $FLTCON NMACH=1.0, MACH(1)=0.7$",
      "PLOT",
    ].join("\n");

    const deck = parseDatcomDeck(src);
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.cases.length, 2);

    const c1 = deck.cases[0]!;
    const c2 = deck.cases[1]!;
    assert.strictEqual(c1.caseId, "BASELINE CASE");
    assert.strictEqual(c2.caseId, "HIGH MACH CASE");
    assert.strictEqual(c2.dim, "FT");
    assert.strictEqual(c2.deriv, "RAD");
    assert.strictEqual(c2.plot, true);
    assert.deepStrictEqual(c2.fltcon?.MACH, [0.7]);
    // Inherited from SAVE
    assert.strictEqual(c2.wgplnf?.CHRDR, 6.0);
    assert.strictEqual(c2.nacaCards.length, 1);
  });

  it("parses Fortran repeat counts, D exponents, comments, and $END terminators", () => {
    const src = [
      "* Comment line",
      "! Another comment",
      "CASEID BODY AND FLAP TEST",
      " $FLTCON NMACH=1.0, MACH(1)=2.5D-1, NALPHA=3.0, ALSCHD(1)=3*0.0 $END",
      " $BODY NX=3.0, X(1)=0.0, 5.0, 10.0, S(1)=0.0, 2.0, 0.5 $",
      " $SYMFLP FTYPE=1.0, NDELTA=2.0, DELTA(1)=0.0, 15.0, CHRDFI=0.4, CHRDFO=0.3 $",
      " $ASYFLP STYPE=4.0, NDELTA=2.0, DELTAL(1)=-10.0, 10.0, DELTAR(1)=10.0, -10.0 $",
      " $WGSCHR TYPEIN=1.0, NPTS=2.0, X(1)=0.0, 1.0, TOVC=0.12 $",
    ].join("\n");

    const deck = parseDatcomDeck(src);
    assert.strictEqual(deck.parseErrors.length, 0);
    const c = deck.cases[0]!;
    assert.strictEqual(c.fltcon?.MACH?.[0], 0.25);
    assert.deepStrictEqual(c.fltcon?.ALSCHD, [0, 0, 0]);
    assert.deepStrictEqual(c.body?.X, [0, 5, 10]);
    assert.deepStrictEqual(c.symflp?.DELTA, [0, 15]);
    assert.deepStrictEqual(c.asyflp?.DELTAL, [-10, 10]);
    assert.strictEqual(c.wgschr?.TOVC, 0.12);
  });

  it("reports unterminated NAMELIST blocks", () => {
    const src = " $FLTCON NMACH=1.0, MACH(1)=0.2\n";
    const deck = parseDatcomDeck(src);
    assert.ok(deck.parseErrors.some((e) => e.code === "DAT1002"));
  });
});
