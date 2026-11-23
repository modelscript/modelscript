// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATCOM_AIRCRAFT_TEMPLATES } from "../src/catalog/datcom-std-schemas.js";
import { lintDatcom } from "../src/lints/index.js";
import { parseDatcomDeck } from "../src/parser/deck-parser.js";

describe("DATCOM Semantic Lints (DAT1001-DAT5006)", () => {
  it("produces zero errors on clean Cessna-172 and Citation templates", () => {
    const c172 = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    const diagsC172 = lintDatcom(c172);
    assert.strictEqual(diagsC172.filter((d) => d.severity === "error").length, 0);

    const cit = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CITATION_JET);
    const diagsCit = lintDatcom(cit);
    assert.strictEqual(diagsCit.filter((d) => d.severity === "error").length, 0);
  });

  it("detects unknown NAMELIST group (DAT2001) and missing $FLTCON/$WGPLNF (DAT3001, DAT3002)", () => {
    const deck = parseDatcomDeck(" $BOGUS X=1.0$\n");
    const diags = lintDatcom(deck);
    const ids = diags.map((d) => d.id);
    assert.ok(ids.includes("DAT2001"));
    assert.ok(ids.includes("DAT3001"));
    assert.ok(ids.includes("DAT3002"));
  });

  it("detects invalid NACA designation (DAT2002)", () => {
    const deck = parseDatcomDeck(
      [" $FLTCON NMACH=1.0, MACH(1)=0.2$", " $WGPLNF CHRDR=1.5, CHRDTP=1.5, SSPN=5.0$", "NACA-W-4-99"].join("\n"),
    );
    const diags = lintDatcom(deck);
    assert.ok(diags.some((d) => d.id === "DAT2002"));
  });

  it("detects mismatched NMACH/NALPHA/NALT array lengths (DAT3003)", () => {
    const deck = parseDatcomDeck(
      [
        " $FLTCON NMACH=2.0, MACH(1)=0.2, NALPHA=3.0, ALSCHD(1)=0.0,2.0, NALT=2.0, ALT(1)=0.0$",
        " $WGPLNF CHRDR=1.5, CHRDTP=1.5, SSPN=5.0$",
      ].join("\n"),
    );
    const diags = lintDatcom(deck);
    const mismatches = diags.filter((d) => d.id === "DAT3003");
    assert.strictEqual(mismatches.length, 3);
  });

  it("detects non-positive SREF/CBARR/BLREF (DAT4001-DAT4003), bad taper (DAT4004), and bad sweep (DAT4005)", () => {
    const deck = parseDatcomDeck(
      [
        " $FLTCON NMACH=1.0, MACH(1)=0.2$",
        " $OPTINS SREF=-10.0, CBARR=0.0, BLREF=-5.0$",
        " $WGPLNF CHRDR=1.0, CHRDTP=2.0, SSPN=5.0, SAVSI=85.0$",
      ].join("\n"),
    );
    const diags = lintDatcom(deck);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("DAT4001"));
    assert.ok(ids.has("DAT4002"));
    assert.ok(ids.has("DAT4003"));
    assert.ok(ids.has("DAT4004"));
    assert.ok(ids.has("DAT4005"));
  });

  it("warns when CG is aft of neutral point (DAT5001) and on transonic Mach (DAT5003)", () => {
    const deck = parseDatcomDeck(
      [
        "DIM M",
        " $FLTCON NMACH=1.0, MACH(1)=0.95, NALPHA=2.0, ALSCHD(1)=0.0,2.0$",
        " $SYNTHS XCG=6.0, XW=2.0, XH=6.5$",
        " $WGPLNF CHRDR=1.6, CHRDTP=1.2, SSPN=5.5, SAVSI=0.0, CHSTAT=0.25$",
        " $HTPLNF CHRDR=1.0, CHRDTP=0.7, SSPN=1.7, SAVSI=5.0, CHSTAT=0.25$",
      ].join("\n"),
    );
    const diags = lintDatcom(deck);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("DAT5001"), "Expected DAT5001 static instability warning for aft CG");
    assert.ok(ids.has("DAT5003"), "Expected DAT5003 transonic Mach info");
  });

  it("warns when flap chord exceeds wing root chord (DAT5006)", () => {
    const deck = parseDatcomDeck(
      [
        "DIM M",
        " $FLTCON NMACH=1.0, MACH(1)=0.2$",
        " $WGPLNF CHRDR=1.5, CHRDTP=1.0, SSPN=5.0$",
        " $SYMFLP FTYPE=1.0, CHRDFI=2.0$",
      ].join("\n"),
    );
    const diags = lintDatcom(deck);
    assert.ok(diags.some((d) => d.id === "DAT5006"));
  });
});
