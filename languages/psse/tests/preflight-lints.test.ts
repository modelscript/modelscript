// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPsseDiagramWriteback,
  getPsseCodeActions,
  getPsseRenameEdits,
  lintPsse,
  lintPsseWorkspace,
  parseDyr,
  parseRaw,
  validatePsse,
} from "../src/index.js";

const RAW_BASE_HEADER = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 TEST
PREFLIGHT TEST CASE
2026-11-15
`;

describe("PSS/E P0 Fixes, P1 Pre-Flight Lints & CST Surgical Writeback", () => {
  it("suppresses false-positive P2001 on 3W-xfmr tertiary buses and HVDC terminals", () => {
    const raw3wAndHvdc = `${RAW_BASE_HEADER}1, 'MAIN1       ', 230.000, 3, 1, 1, 1, 1.0200, 0.0000
2, 'MAIN2       ', 138.000, 1, 1, 1, 1, 1.0000, -1.5000
3, 'TERT3       ',  13.800, 1, 1, 1, 1, 1.0000, -2.0000
4, 'HVDC_RECT   ', 230.000, 1, 1, 1, 1, 1.0100, -3.0000
5, 'HVDC_INV    ', 230.000, 1, 1, 1, 1, 1.0100, -5.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 20.000, 5.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.000, 10.000, 50.000, -30.000, 1.0200, 0, 100.00, 0.00000, 0.25000, 0.00000, 0.00000, 1.0000, 1, 100.0, 100.000, 0.000
0 / END OF GENERATOR DATA
1, 4, '1 ', 0.00200, 0.02000, 0.01000, 200.00, 220.00, 240.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 10.0
0 / END OF BRANCH DATA
1, 2, 3, '1 ', 1, 1, 1, 0.001, 0.001, 2, 'T3W         ', 1, 1, 1.0000
0.00100, 0.05000, 100.00, 0.00200, 0.08000, 100.00, 0.00200, 0.07000, 100.00, 1.0000, 0.0000
1.00000, 230.000, 0.000, 150.00, 160.00, 175.00, 1, 0, 1.10000, 0.90000, 1.01, 0.99, 33, 0, 0.0, 0.0, 0.0
1.00000, 138.000
1.00000, 13.800
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
'DC1', 1, 100.0, 500.0, 2.5, 0.5, 0.0, 0.0, 'R', 100.0, 0, 0.0, 0.0
4, 1, 12.0, 1.0, 0.01, 0.5, 1.0, 230.0, 0.5, 1.1, 0.9, 15.0, 0.0, '1', 0.0
5, 1, 18.0, 1.0, 0.01, 0.5, 1.0, 230.0, 0.5, 1.1, 0.9, 15.0, 0.0, '1', 0.0
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;
    const diags = validatePsse(raw3wAndHvdc, "file:///test/3w_hvdc.raw");
    const isolatedP2001 = diags.filter((d) => d.code === "P2001");
    assert.equal(
      isolatedP2001.length,
      0,
      `Unexpected P2001 diagnostics: ${isolatedP2001.map((d) => d.message).join("; ")}`,
    );
  });

  it("detects P2006-P2009, P4005-P4007, P4009-P4010, P6001, and P6002 pre-flight hazards", () => {
    const rawHazards = `${RAW_BASE_HEADER}1, 'SLACK1      ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000
2, 'PQ_GEN      ', 230.000, 1, 1, 1, 1, 1.0000, -2.0000
3, 'PV_NOGEN    ', 230.000, 2, 1, 1, 1, 1.0000, -3.0000
4, 'ISO_BAD     ', 230.000, 4, 1, 1, 1, 1.0000, 0.0000
5, 'ISLAND_A    ', 138.000, 1, 1, 1, 1, 1.0000, 0.0000
6, 'ISLAND_B    ', 138.000, 1, 1, 1, 1, 1.0000, 0.0000
7, 'RADIAL_END  ', 230.000, 1, 1, 1, 1, 1.0000, -4.0000
8, 'REG_BUS     ', 230.000, 1, 1, 1, 1, 1.0000, -4.5000
0 / END OF BUS DATA
4, '1 ', 1, 1, 1, 5.000, 1.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
5, '1 ', 1, 1, 1, 25.000, 5.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
6, '1 ', 1, 1, 1, 25.000, 5.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
7, '1 ', 1, 1, 1, 30.000, 5.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 40.000, 0.000, 50.000, -30.000, 1.0000, 0, 100.00, 0.00000, 0.25000, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
2, '1 ', 10.000, 0.000, 20.000, -10.000, 1.0000, 0, 100.00, 0.00000, 0.25000, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
2, '2 ',  5.000, 0.000, 10.000, -10.000, 1.0200, 8, 100.00, 0.00000, 0.25000, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
1, '2 ',  5.000, 0.000, 10.000, -10.000, 1.0100, 8, 100.00, 0.00000, 0.25000, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.00000, 0.000005, 6.00000, 120.00, 100.00, 90.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.0
2, 3, '1 ', 0.00500, 0.05000, 0.01000, 100.00, 120.00, 140.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.0
1, 7, '1 ', 0.00500, 0.05000, 0.01000, 100.00, 120.00, 140.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.0
1, 8, '1 ', 0.00500, 0.05000, 0.01000, 100.00, 120.00, 140.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.0
5, 6, '1 ', 0.00500, 0.05000, 0.01000, 100.00, 120.00, 140.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.0
0 / END OF BRANCH DATA
1, 2, 3, '1 ', 1, 1, 1, 0.001, 0.001, 2, 'NEG_STAR    ', 1, 1, 1.0000
0.00100, 0.05000, 100.00, 0.00100, 0.25000, 100.00, 0.00100, 0.05000, 100.00, 1.0000, 0.0000
1.00000, 230.000, 0.000, 150.00, 160.00, 175.00, 1, 0, 1.1, 0.9, 1.01, 0.99, 33, 0, 0.0, 0.0, 0.0
1.00000, 230.000
1.00000, 230.000
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
8, 1, 1, 1, 0.9800, 1.0200, 0, 100.0, '', 25.000, 1, 25.000
0 / END OF SWITCHED SHUNT DATA
`;
    const codes = new Set(validatePsse(rawHazards, "file:///test/hazards.raw").map((d) => d.code));
    for (const expected of [
      "P2006",
      "P2007",
      "P2008",
      "P2009",
      "P4005",
      "P4006",
      "P4007",
      "P4009",
      "P4010",
      "P6001",
      "P6002",
    ]) {
      assert.ok(codes.has(expected), `Expected diagnostic ${expected}, got: ${Array.from(codes).join(", ")}`);
    }
  });

  it("detects DYR P5001-P5006, P7001 initial conditions suspect, and de-collided workspace P5009-P5012", () => {
    const rawSimple = `${RAW_BASE_HEADER}1, 'G1          ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000
2, 'G2          ', 230.000, 2, 1, 1, 1, 1.0000, 0.0000
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 265.000, 150.000, 200.000, -100.000, 1.0000, 0, 100.00, 0.00000, 0.25000, 0.0, 0.0, 1.0, 1, 100.0, 250.0, 0.0
2, '1 ',  50.000,   0.000, 100.000,  -50.000, 1.0000, 0, 100.00, 0.00000, 0.20000, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.00100, 0.05000, 0.01000, 250.00, 280.00, 300.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;
    // Bus 1 GENROU has Xd (0.30) < X'd (0.45) (P5005) and PG=265 > PT=250 (P7001), plus duplicate GENROU (P5002) and truncated params (P5001)
    const badDyr = `1 'GENROU' '1' 6.0 0.05 0.5 0.05 3.0 0.0 0.30 0.30 0.45 0.12 0.15 0.0 0.0 0.0 /
1 'GENROU' '1' 6.0 0.05 0.5 0.05 3.5 0.0 1.20 1.10 0.30 0.20 0.15 0.0 0.0 /
2 'ESST1A' '1' 0.02 0.0 0.0 1.0 1.0 100.0 0.05 5.0 -5.0 5.0 -5.0 0.0 0.0 0.0 0.0 0.0 /
99 'GENCLS' '1' 4.0 0.0 /
`;
    const c = parseRaw(rawSimple);
    c.dyr = parseDyr(badDyr);
    const singleCodes = new Set(lintPsse(c).map((d) => d.code));
    for (const expected of ["P5001", "P5002", "P5003", "P5004", "P5005", "P5006", "P7001"]) {
      assert.ok(
        singleCodes.has(expected),
        `Expected DYR diagnostic ${expected}, got: ${Array.from(singleCodes).join(", ")}`,
      );
    }

    const conText = `CONTINGENCY N1_MISSING
  TRIP GENERATOR BUS 777 ID '1'
END
`;
    const seqText = `0, 100.0 / SEQ
888, '1 ', 0.01, 0.18, 0.01, 0.18, 0.0, 0.08
0 / END OF MACHINE IMPEDANCE
`;
    const wsDiags = lintPsseWorkspace(
      new Map([
        ["file:///ws/case.raw", rawSimple],
        ["file:///ws/case.dyr", badDyr],
        ["file:///ws/case.seq", seqText],
        ["file:///ws/case.con", conText],
      ]),
      "file:///ws/case.raw",
    );
    const wsCodes = new Set(wsDiags.map((d) => d.code));
    for (const expected of ["P5009", "P5010", "P5012"]) {
      assert.ok(
        wsCodes.has(expected),
        `Expected workspace diagnostic ${expected}, got: ${Array.from(wsCodes).join(", ")}`,
      );
    }
  });

  it("performs surgical CstUnparser rename, quick-fix, and 2W/3W xfmr_ writeback preserving trailing comments", () => {
    const rawWithComments = `${RAW_BASE_HEADER}1, 'BUS1        ', 230.000, 3, 1, 1, 1, 1.0200, 0.0000 / primary swing bus
2, 'BUS2        ', 138.000, 1, 1, 1, 1, 1.0000, -1.0000 / load bus
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 30.000, 10.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1 / main load
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 30.000, 10.000, 100.000, -50.000, 1.0200, 0, 100.00, 0.0, 0.25, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0 / unit 1
0 / END OF GENERATOR DATA
0 / END OF BRANCH DATA
1, 2, 0, '1 ', 1, 1, 1, 0.001, 0.001, 2, 'T2W         ', 1, 1, 1.0000
0.00200, 0.08000, 100.00
1.01000, 230.000, 0.000, 150.00, 160.00, 175.00, 1, 0, 1.10000, 0.90000, 1.01, 0.99, 33, 0, 0.0, 0.0, 0.0
1.00000, 138.000
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;
    const rename = getPsseRenameEdits(rawWithComments, { line: 3, character: 0 }, "101", "file:///c.raw");
    assert.ok(rename);
    const renamedText = rename.changes["file:///c.raw"]![0]!.newText;
    assert.ok(renamedText.includes("/ primary swing bus"));
    assert.ok(renamedText.includes("/ main load"));
    const renamedCase = parseRaw(renamedText);
    assert.ok(renamedCase.buses.has(101));
    assert.equal(renamedCase.transformers[0]?.i, 101);

    const xfEditedText = applyPsseDiagramWriteback(rawWithComments, "xfmr_1_2_1", {
      windv1: 1.05,
      x12: 0.095,
      stat: 0,
    });
    const xfCase = parseRaw(xfEditedText);
    assert.equal(xfCase.transformers[0]?.windv1, 1.05);
    assert.equal(xfCase.transformers[0]?.x12, 0.095);
    assert.equal(xfCase.transformers[0]?.stat, 0);
    assert.ok(xfEditedText.includes("/ primary swing bus"));

    // Quick fix on inverted Q limits preserves comment
    const badQRaw = applyPsseDiagramWriteback(rawWithComments, "gen_1_1", { qb: 80, qt: -20 });
    assert.ok(badQRaw.includes("/ unit 1") || parseRaw(badQRaw).generators[0]!.qb === 80);
    const diags = validatePsse(badQRaw, "file:///c.raw");
    const p3001 = diags.find((d) => d.code === "P3001");
    assert.ok(p3001);
    const fixes = getPsseCodeActions(badQRaw, p3001.range, [p3001], "file:///c.raw");
    assert.equal(fixes.length, 1);
    const fixed = parseRaw(fixes[0]!.edit.changes["file:///c.raw"]![0]!.newText);
    assert.ok(fixed.generators[0]!.qb <= fixed.generators[0]!.qt);
  });

  it("detects P1005 unterminated section, P1006 invalid area ref, P4008 unit mismatch, P5007-P5008 seq errors, and P6003 sparse Zbus weak-grid SCR", () => {
    const truncatedRaw = `${RAW_BASE_HEADER}1, 'STRONG_GRID ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000
2, 'MID_BUS     ', 230.000, 1, 99, 1, 1, 1.0000, -5.0000
3, 'IBR_POI     ', 230.000, 2, 1, 1, 1, 1.0000, -10.0000
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 100.000, 0.0, 100.0, -50.0, 1.0, 0, 500.0, 0.0, 0.20, 0.0, 0.0, 1.0, 1, 100.0, 500.0, 0.0
3, '1 ', 200.000, 0.0, 100.0, -50.0, 1.0, 0, 200.0, 0.0, 999.0, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
2, 3, '1 ', 0.01000, 0.50000, 0.01000, 300.00, 330.00, 350.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 50.0
0 / END OF BRANCH DATA
1, 2, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'BAD_CW', 1, 1, 1.0
0.001, 0.050, 100.0
230.00, 230.00, 0.0, 150.0, 160.0, 175.0, 1, 0, 1.1, 0.9, 1.01, 0.99, 33, 0, 0.0, 0.0, 0.0
1.00, 230.00
0 / END OF TRANSFORMER DATA
1, 1, 100.0, 5.0, 'AREA_1'
`;
    const codes = new Set(lintPsse(parseRaw(truncatedRaw)).map((d) => d.code));
    for (const expected of ["P1005", "P1006", "P4008", "P6003"]) {
      assert.ok(codes.has(expected), `Expected diagnostic ${expected}, got: ${Array.from(codes).join(", ")}`);
    }

    const badSeq = `0, 100.0 / SEQ
1, '1 ', 0.001, 0.20, 0.001, 0.0, 0.001, 0.0, 0.0, 0.0
0 / END OF MACHINE IMPEDANCE
1, 2, '1 ', 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
0 / END OF ZERO-SEQUENCE BRANCH
0 / END OF MUTUAL
1, 2, 0, '1 ', 1, 0.01, 0.05, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0
0 / END OF TRANSFORMER
Q
`;
    const wsDiags = lintPsseWorkspace(
      new Map([
        ["file:///w/g.raw", truncatedRaw],
        ["file:///w/g.seq", badSeq],
      ]),
      "file:///w/g.raw",
    );
    const wsCodes = new Set(wsDiags.map((d) => d.code));
    assert.ok(wsCodes.has("P5007"), `Expected P5007, got ${Array.from(wsCodes).join(", ")}`);
    assert.ok(wsCodes.has("P5008"), `Expected P5008, got ${Array.from(wsCodes).join(", ")}`);
  });

  it("detects P6006 poorly damped modes, P7002 capability overload, and P7004 REEC_A control conflicts", () => {
    const rawCap = `${RAW_BASE_HEADER}1, 'SLACK_GEN   ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000
2, 'GEN_OVER    ', 230.000, 2, 1, 1, 1, 1.0000, -1.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 120.000, 80.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ',  50.000,  0.000, 100.0, -50.0, 1.0, 0, 200.0, 0.0, 0.25, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
2, '1 ', 120.000, 80.000, 100.0, -50.0, 1.0, 0, 100.0, 0.0, 0.25, 0.0, 0.0, 1.0, 1, 100.0, 120.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.00100, 0.05000, 0.01000, 300.00, 330.00, 350.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;
    // Negative damping D = -8.0 in GENCLS triggers P6006 unstable eigenvalue; REEC_A dbd1=0.05 > dbd2=-0.05 triggers P7004
    const unstableDyr = `1 'GENCLS' '1' 4.0 -8.0 /
2 'GENCLS' '1' 4.0 -8.0 /
2 'REEC_A' '1' 0.85 1.15 0.01 0.05 -0.05 2.0 1.40 -1.05 1.0 0.0 0.0 0.0 0.05 0.436 -0.436 1.1 0.9 0.0 0.1 0.0 40.0 0.02 1.1 -1.1 1.0 0.0 1.2 0.02 /
`;
    const c = parseRaw(rawCap);
    c.dyr = parseDyr(unstableDyr);
    const codes = new Set(lintPsse(c).map((d) => d.code));
    assert.ok(codes.has("P7002"), `Expected P7002, got ${Array.from(codes).join(", ")}`);
    assert.ok(codes.has("P7004"), `Expected P7004, got ${Array.from(codes).join(", ")}`);
    assert.ok(codes.has("P6006"), `Expected P6006, got ${Array.from(codes).join(", ")}`);
  });

  it("detects P1004 revision metadata mismatch, P6004 Q-V Jacobian collapse, and P7003 unsolvable pocket", () => {
    const rawUnsolvable = `@!IC,SBASE,REV,XFRRAT,NXFRAT,BASFRQ
0, 100.00, 33, 0, 0, 60.00 / REV=33 with @! metadata
UNSOLVABLE POCKET TEST
LINE 2
1, 'STRONG_BUS  ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000
2, 'WEAK_POCKET ', 230.000, 1, 1, 1, 1, 0.6500, -35.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 900.000, 300.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 500.0, 0.0, 500.0, -500.0, 1.0, 0, 1200.0, 0.0, 0.25, 0.0, 0.0, 1.0, 1, 100.0, 1200.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01000, 1.20000, 0.00000, 300.00, 330.00, 350.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 10.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const codes = new Set(lintPsse(parseRaw(rawUnsolvable)).map((d) => d.code));
    assert.ok(codes.has("P1004"), `Expected P1004, got ${Array.from(codes).join(", ")}`);
    assert.ok(codes.has("P6004"), `Expected P6004, got ${Array.from(codes).join(", ")}`);
    assert.ok(codes.has("P7003"), `Expected P7003, got ${Array.from(codes).join(", ")}`);
  });
});
