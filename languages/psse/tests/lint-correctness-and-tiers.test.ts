// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLikelyDyrContent,
  lintPsse,
  lintPsseSoa,
  lintPsseWorkspace,
  parseDyr,
  parseRaw,
  parseRawToSoa,
  parseSeq,
  validatePsse,
  verifyGridOntologyCompliance,
  verifyPocketInfeasibilityHc4,
  verifyPssePscadEquivalence,
  verifyRasSpsBmc,
  verifyTrueSteadyStateInit,
  verifyVoltageCollapseMarginPalc,
} from "../src/index.js";

describe("PSS/E P0 Correctness, Tiered Execution & Structural/SMT Upgrades", () => {
  it("parses standard 12-column transformer Line 1 with CZ without shifting STAT onto NAME", () => {
    const raw = `0, 100.00, 33, 0, 0, 60.00
XFMR CZ COLUMN TEST
LINE 2
1, 'SLACK', 230.0, 3, 1, 1, 1, 1.00, 0.0
2, 'ISO_BUS', 138.0, 4, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 0.0, 100.0, -100.0, 1.0, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
0 / END OF BRANCH DATA
1, 2, 0, '1 ', 1, 2, 1, 0.0, 0.0, 2, 'XFMR_OUT', 0, 1, 1.0
0.001, 0.08, 100.0
1.0, 230.0, 0.0, 100.0, 120.0, 140.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0
1.0, 138.0
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const parsed = parseRaw(raw);
    assert.equal(parsed.transformers.length, 1);
    const t = parsed.transformers[0]!;
    assert.equal(t.cw, 1);
    assert.equal(t.cz, 2);
    assert.equal(t.cm, 1);
    assert.equal(t.name, "XFMR_OUT");
    assert.equal(t.stat, 0, "Out-of-service transformer STAT=0 must be parsed accurately");

    // Out-of-service transformer connected to Type 4 bus must NOT emit P2006
    const diags = lintPsse(parsed);
    assert.ok(
      !diags.some((d) => d.code === "P2006"),
      `Did not expect P2006 for STAT=0 transformer, got: ${diags.map((d) => d.code).join(", ")}`,
    );
  });

  it("populates TwoTerminalDcRecord.name so named HVDC DYR links pass P5019 and workspace P5010", () => {
    const raw = `0, 100.00, 33, 0, 0, 60.00
HVDC NAME TEST
LINE 2
1, 'RECT', 230.0, 3, 1, 1, 1, 1.00, 0.0
2, 'INV', 230.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 0.0, 100.0, -100.0, 1.0, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.05, 0.0, 100.0, 120.0, 140.0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
'DC1', 1, 2.5, 100.0, 500.0, 0.0, 0.0, 0.0
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const dyr = `'DC1' 'CDC4T' 15.0 18.0 0.05 0.05 0.1 0.5 0.2 0.2 1.2 0.0 /\n`;
    const parsed = parseRaw(raw);
    assert.equal(parsed.twoTerminalDc[0]?.name, "DC1");
    parsed.dyr = parseDyr(dyr);

    const diags = lintPsse(parsed);
    assert.ok(!diags.some((d) => d.code === "P5019"), "Named 2T-DC 'DC1' must match DYR CDC4T without P5019");

    const wsDiags = lintPsseWorkspace(
      new Map([
        ["file:///grid/base.raw", raw],
        ["file:///grid/base.dyr", dyr],
      ]),
      "file:///grid/base.raw",
    );
    assert.ok(!wsDiags.some((d) => d.code === "P5010"), "Device-named DYR record must not trigger P5010");
    assert.ok(!wsDiags.some((d) => d.code === "P5019"), "Workspace lint must not trigger P5019 on 'DC1'");
  });

  it("avoids false positives on CW=2 kV taps (P4003), series-compensated lines (P4001), and negative metered J (P7003)", () => {
    const raw = `0, 100.00, 33, 0, 0, 60.00
EDGE CASES TEST
LINE 2
1, 'SLACK', 230.0, 3, 1, 1, 1, 1.00, 0.0
2, 'LOAD', 230.0, 1, 1, 1, 1, 1.00, 0.0
3, 'SUB', 138.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, 100.0, -100.0, 1.0, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
1, -2, '1 ', 0.005, -0.04, 0.0, 200.0, 220.0, 250.0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
2, 3, 0, '1 ', 2, 1, 1, 0.0, 0.0, 2, 'KV_TAP', 1, 1, 1.0
0.002, 0.06, 100.0
230.0, 230.0, 0.0, 100.0, 120.0, 140.0, 0, 0, 250.0, 210.0, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0
138.0, 138.0
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const diags = lintPsse(parseRaw(raw));
    assert.ok(!diags.some((d) => d.code === "P4001"), "Series-compensated line (X < 0) must not emit P4001");
    assert.ok(!diags.some((d) => d.code === "P4003"), "CW=2 kV tap (230.0 kV) must not emit P4003");
    assert.ok(!diags.some((d) => d.code === "P7003"), "Negative metered end J=-2 must not cause false P7003");
  });

  it("supports fast vs deep vs formal execution tiers and auto-extracted DYR protection SMT (P8001)", () => {
    const raw = `0, 100.00, 33, 0, 0, 60.00
TIER TEST
LINE 2
1, 'SLACK', 230.0, 3, 1, 1, 1, 1.00, 0.0
2, 'IBR_POI', 230.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 20.0, 5.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 20.0, 5.0, 100.0, -100.0, 1.0, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
2, '1 ', 150.0, 0.0, 100.0, -100.0, 1.0, 0, 200.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.02, 0.90, 0.0, 200.0, 220.0, 250.0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const dyr = `2 'FRQTPAT' 1 60.5 59.5 0.1 0.05 /\n`;
    const parsed = parseRaw(raw);
    parsed.dyr = parseDyr(dyr);

    const fastDiags = lintPsse(parsed, { tier: "fast" });
    assert.ok(!fastDiags.some((d) => d.code === "P6003"), "Fast tier must skip sparse Z_bus LU (P6003)");
    assert.ok(!fastDiags.some((d) => d.code === "P8001"), "Fast tier must skip formal SMT (P8001)");

    const deepDiags = lintPsse(parsed, { tier: "deep" });
    assert.ok(
      deepDiags.some((d) => d.code === "P6003"),
      "Deep tier must detect weak-grid IBR SCR (P6003)",
    );

    const formalDiags = lintPsse(parsed, { tier: "formal" });
    const p8001 = formalDiags.find((d) => d.code === "P8001");
    assert.ok(p8001, "Formal tier must auto-detect inverted FRQTPAT under/over trip band (P8001)");
    assert.equal(p8001.rigor, "rigorous");

    // Verify numeric disjoint RAS triggers are proven UNSAT (safe)
    const disjointRas = verifyRasSpsBmc([
      { id: "UV_TRIP", triggerTag: "V<0.85", actions: [{ kind: "open_branch", target: "L_1_2" }] },
      { id: "OV_CLOSE", triggerTag: "V>1.15", actions: [{ kind: "close_branch", target: "L_1_2" }] },
    ]);
    assert.equal(disjointRas.length, 0, "Disjoint numeric triggers (V<0.85 vs V>1.15) must not false-positive P8001");

    // Verify RAW syntax errors use P1007 (not colliding with P1001 BUS_NOT_FOUND)
    const synDiags = validatePsse("0, 100.0, 33, 0, 0, 60.0\nT1\nT2\nBADBUS, 'X', 138, 1, 1, 1, 1, 1.0, 0.0\n0 /\n");
    assert.ok(
      synDiags.some((d) => d.code === "P1007"),
      "RAW syntax errors must use registered code P1007",
    );
  });

  it("supports zero-GC lintPsseSoa fast-path, zero-alloc isLikelyDyrContent, and exact SEQ spans", () => {
    const raw = `0, 100.00, 33, 0, 0, 60.00
SOA LINT TEST
LINE 2
1, 'SLACK', 138.0, 3, 1, 1, 1, 1.00, 0.0
2, 'LOWV', 138.0, 1, 1, 1, 1, 0.72, 0.0
3, 'ISOL', 138.0, 1, 1, 1, 1, 1.00, 0.0
4, 'ISL_A', 138.0, 1, 1, 1, 1, 1.00, 0.0
5, 'ISL_B', 138.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', -10.0, 0.0, 50.0, 100.0, 1.0, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.05, 0.0, 0.0, 0.0, 0.0, 0, 0, 0, 0, 1, 1, 0.0
4, 5, '1 ', 0.01, 0.05, 0.0, 100.0, 120.0, 140.0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const soa = parseRawToSoa(raw);
    const soaCodes = new Set(lintPsseSoa(soa).map((d) => d.code));
    for (const expected of ["P1002", "P2001", "P2004", "P3001", "P4004", "P6001"]) {
      assert.ok(
        soaCodes.has(expected),
        `Expected ${expected} from lintPsseSoa, got ${Array.from(soaCodes).join(", ")}`,
      );
    }

    assert.equal(isLikelyDyrContent(`1 'GENROU' 1 6.0 0.05 /`), true);
    assert.equal(isLikelyDyrContent(`'DC1' 'CDC4T' 15.0 /`), true);
    assert.equal(isLikelyDyrContent(raw), false);

    const seqText = `0, 33 / SEQ
1, '1 ', 0.0, 0.15, 0.0, 0.15, 0.0, 0.08, 0.0, 0.0
0 /
0 /
1, 2, '1 ', 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
0 /
0 /
1, 2, 0, '1 ', 99, 0.0, 0.0, 0.01, 0.05
0 /
`;
    const seq = parseSeq(seqText);
    assert.equal(seq.generators[0]?.span?.line, 2);
    assert.equal(seq.branches[0]?.span?.line, 5);
    assert.equal(seq.transformers[0]?.span?.line, 8);
    const seqDiags = validatePsse(seqText, "case.seq");
    const xfDiag = seqDiags.find((d) => d.code === "P5103");
    assert.equal(
      xfDiag?.range.start.line,
      7,
      "Transformer P5103 diagnostic must point to line 8 (0-indexed 7), not generator line 2",
    );
  });

  it("enforces P2 SOTA checks (P4011 ZBR loop, P5005 q-axis/Xl, P5021 DELT underflow, P5022 .mon/.sub) and backfills P1003/P2002/P3003/P4002", () => {
    const raw = `0, 100.00, 33, 0, 0, 60.00
P2 SOTA TEST
LINE 2
1, 'BUS1', 230.0, 2, 1, 1, 1, 1.00, 0.0
2, 'BUS2', 230.0, 1, 1, 1, 1, 1.00, 0.0
3, 'BUS3', 138.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 0.0, 100.0, -100.0, 1.35, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
1, '1 ', 50.0, 0.0, 100.0, -100.0, 1.00, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.0, 0.00005, 0.0, 100.0, 120.0, 140.0, 0, 0, 0, 0, 1, 1, 0.0
2, 3, '1 ', 0.0, 0.00005, 0.0, 100.0, 120.0, 140.0, 0, 0, 0, 0, 1, 1, 0.0
3, 1, '1 ', 0.0, 0.00005, 0.0, 100.0, 120.0, 140.0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    // GENROU with Xq (0.40) < X'q (0.60), X''d (0.10) < Xl (0.15), and T''d0 (0.0005) < 2 ms
    const dyr = `1 'GENROU' 1 6.0 0.0005 0.5 0.06 4.0 0.0 1.8 0.40 0.30 0.60 0.10 0.15 0.05 0.10 /\n`;
    const parsed = parseRaw(raw);
    parsed.dyr = parseDyr(dyr);
    const diags = lintPsse(parsed);
    const codes = new Set(diags.map((d) => d.code));
    for (const expected of ["P1003", "P2002", "P3003", "P4002", "P4011", "P5005", "P5021"]) {
      assert.ok(codes.has(expected), `Expected ${expected}, got: ${Array.from(codes).join(", ")}`);
    }

    const subText = `SUBSYSTEM 'EAST'\n  BUS 999\nEND\n`;
    const monText = `MONITOR VOLTAGE RANGE BUS 1 1.10 0.90\nMONITOR BRANCH FROM BUS 1 TO BUS 888\nMONITOR BRANCHES IN SUBSYSTEM 'NO_SUCH_SUB'\nEND\n`;
    const seqText = `0, 33 / SEQ\n0 /\n0 /\n1, 777, '1 ', 0.05, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0\n0 /\n`;
    const wsDiags = lintPsseWorkspace(
      new Map([
        ["file:///grid/base.raw", raw],
        ["file:///grid/base.sub", subText],
        ["file:///grid/base.mon", monText],
        ["file:///grid/base.seq", seqText],
      ]),
      "file:///grid/base.raw",
    );
    assert.ok(
      wsDiags.some((d) => d.code === "P5012" && d.message.includes("777")),
      "Expected P5012 for missing .seq branch bus 777",
    );
    assert.ok(wsDiags.filter((d) => d.code === "P5022").length >= 3, "Expected P5022 for .sub/.mon unresolved targets");
  });

  it("P3 formal checks: HC4 pocket infeasibility, true steady-state init, PALC margin, NERC/IEEE 2800 ontology, and cross-domain equivalence", () => {
    // 1. HC4 pocket infeasibility (P7003, rigorous): 2-bus radial pocket with huge load exceeding Pmax = V1*V2/X
    const infeasibleRaw = `0, 100.0, 33, 0, 1, 60.0 /
HC4 INFEASIBLE POCKET
TEST
1, 'SLACK', 230.0, 3, 1, 1, 1, 1.0, 0.0, 1.1, 0.9, 1.1, 0.9
2, 'LOAD ', 230.0, 1, 1, 1, 1, 1.0, 0.0, 1.1, 0.9, 1.1, 0.9
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 800.0, 0.0, 500.0, -500.0, 1.0, 0, 100.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1, 100.0, 900.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.0, 0.5, 0.0, 100.0, 120.0, 140.0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const infeasibleCase = parseRaw(infeasibleRaw);
    const hc4Diags = verifyPocketInfeasibilityHc4(infeasibleCase);
    assert.ok(
      hc4Diags.some((d) => d.code === "P7003" && d.rigor === "rigorous"),
      `Expected rigorous P7003 from HC4 contractor, got: ${JSON.stringify(hc4Diags)}`,
    );

    // 2. PALC voltage collapse margin (P6004): stressed 2-bus case near nose point
    const stressedRaw = infeasibleRaw.replace("800.0, 0.0", "195.0, 0.0").replace("1, '1 ', 800.0", "1, '1 ', 195.0");
    const stressedCase = parseRaw(stressedRaw);
    const palcRes = verifyVoltageCollapseMarginPalc(stressedCase);
    assert.ok(Array.isArray(palcRes.diagnostics), "verifyVoltageCollapseMarginPalc should return diagnostics array");
    assert.ok(Number.isFinite(palcRes.lambdaMax), "verifyVoltageCollapseMarginPalc should return finite lambdaMax");

    // 3. True steady-state init (P7001, float-sound) + NERC/IEEE 2800 ontology (P8005)
    const ontoRaw = `0, 100.0, 33, 0, 1, 60.0 /
ONTOLOGY AND STEADY STATE TEST
TEST
1, 'SLACK', 230.0, 3, 1, 1, 1, 1.0, 0.0, 1.1, 0.9, 1.1, 0.9
2, 'IBR  ', 230.0, 2, 1, 1, 1, 1.0, 0.0, 1.1, 0.9, 1.1, 0.9
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 100.0, 20.0, 100.0, -50.0, 1.0, 0, 100.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1, 100.0, 150.0, 0.0
2, '1 ', 50.0, 0.0, 40.0, -40.0, 1.0, 0, 50.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1, 100.0, 60.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.1, 0.0, 100.0, 120.0, 140.0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;
    const ontoCase = parseRaw(ontoRaw);
    // Bus 1: GENROU >= 20 MVA without exciter; Bus 2: REGCA1 without REEC; plus VTGTPAT relay at 0.85/1.15 pu
    ontoCase.dyr = parseDyr(
      [
        `1 'GENROU' 1 6.0 0.03 0.5 0.06 4.0 0.0 1.8 1.7 0.30 0.55 0.25 0.20 0.05 0.10 /`,
        `2 'REGCA1' 1 0 0.02 10.0 0.9 0.5 1.22 1.2 0.8 0.4 -1.3 0.02 0.7 999.0 -999.0 1.0 /`,
        `1 'VTGTPAT' 1 1 0.85 1.15 0.5 0.05 /`,
      ].join("\n"),
    );

    const ontoDiags = verifyGridOntologyCompliance(ontoCase);
    assert.ok(
      ontoDiags.some((d) => d.code === "P8005" && d.message.includes("MOD-026")),
      `Expected P8005 MOD-026 missing exciter diagnostic, got: ${JSON.stringify(ontoDiags)}`,
    );
    assert.ok(
      ontoDiags.some((d) => d.code === "P8005" && d.message.includes("IEEE 2800")),
      `Expected P8005 IEEE 2800 missing REEC diagnostic, got: ${JSON.stringify(ontoDiags)}`,
    );

    const ssDiags = verifyTrueSteadyStateInit(ontoCase);
    assert.ok(Array.isArray(ssDiags), "verifyTrueSteadyStateInit should execute cleanly");

    // 4. Cross-domain PSS/E <-> PSCAD equivalence (X7001, X7002, X7003)
    const eqDiags = verifyPssePscadEquivalence(
      ontoCase,
      {
        frequencyHz: 50.0,
        poiBaseKv: 138.0,
        underVoltageTripPu: 0.75,
        overVoltageTripPu: 1.25,
      },
      1,
    );
    const eqCodes = new Set(eqDiags.map((d) => d.code));
    assert.ok(eqCodes.has("X7001"), "Expected X7001 for 60 Hz vs 50 Hz mismatch");
    assert.ok(eqCodes.has("X7002"), "Expected X7002 for 230 kV vs 138 kV POI mismatch");
    assert.ok(eqCodes.has("X7003"), "Expected X7003 for protection threshold drift vs VTGTPAT");
  });
});
