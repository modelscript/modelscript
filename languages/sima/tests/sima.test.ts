// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lintSimaProject,
  parseCardDeck,
  parseHydFile,
  parseSimaFile,
  parseSimaXml,
  simaLanguage,
  simaToModelica,
  simaToSsp,
  SimaWorkspaceIndex,
  solveCatenary,
  verifyDnvMooringCompliance,
} from "../src/index.js";

const SAMPLE_SIMO_DECK = `
! SIMO / RIFLEX Benchmark: OC4 Semi-Submersible Floating Offshore Wind
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

const SAMPLE_SIMA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sima:Model name="FloatingWindPlatform">
  <environment waterDepth="200.0" density="1025.0" friction="0.5"/>
  <wave hs="6.0" tp="11.5" gamma="3.3" direction="0.0"/>
  <wind speed="18.0" direction="0.0"/>
  <vessel id="vessel_1" name="SparFloater" mass="8000000" displacement="8200" gmt="3.2" gml="3.5" cgx="0" cgy="0" cgz="-25" rxx="28" ryy="28" rzz="15">
    <fairlead id="fl_1" x="10.0" y="0.0" z="-12.0"/>
    <fairlead id="fl_2" x="-5.0" y="8.66" z="-12.0"/>
    <fairlead id="fl_3" x="-5.0" y="-8.66" z="-12.0"/>
  </vessel>
  <mooringLine id="line_1" name="MooringLine_1" type="catenary" fairleadId="fl_1" anchorX="600.0" anchorY="0.0" anchorZ="-200.0">
    <segment id="seg_1" length="700.0" diameter="0.12" dryMass="290.0" subWeight="2500.0" ea="1.0e9" ei="1.0e5" mbl="1.5e7" cd="1.2" cm="2.0"/>
  </mooringLine>
</sima:Model>
`;

const SAMPLE_HYD_TEXT = `
! Hydrodynamic Transfer Functions
FREQUENCIES
0.2 0.4 0.6 0.8 1.0 1.2 1.4 1.6 1.8 2.0
HEADINGS
0.0 45.0 90.0
RAO
0 1 1.20 15.0 1.45 25.0 1.80 40.0
0 3 0.85 -10.0 0.95 -5.0 1.02 0.0
0 5 0.05 60.0 0.08 75.0 0.12 90.0
`;

describe("@modelscript/sima parser suite", () => {
  it("parses classical SIMO / RIFLEX card deck correctly", () => {
    const model = parseCardDeck(SAMPLE_SIMO_DECK, "test.inp");
    assert.equal(model.vessels.length, 1);
    const v = model.vessels[0]!;
    assert.equal(v.name, "OC4_Semi");
    assert.equal(v.mass, 13444000);
    assert.equal(v.gmTransverse, 4.5);
    assert.equal(v.gmLongitudinal, 5.0);
    assert.equal(v.fairleads.length, 3);
    assert.equal(v.fairleads[0]?.id, "fl_1");

    assert.equal(model.lines.length, 3);
    const line1 = model.lines[0]!;
    assert.equal(line1.id, "line_1");
    assert.equal(line1.totalLength, 835.5);
    assert.equal(line1.segments.length, 1);
    assert.equal(line1.segments[0]?.mbl, 1.8e7);

    assert.equal(model.environment.waterDepth, 200.0);
    assert.equal(model.environment.wave.hs, 8.0);
    assert.equal(model.environment.wave.tp, 12.5);
    assert.equal(model.environment.wind.speed, 20.0);
    assert.equal(model.simulation.timeStep, 0.05);
  });

  it("parses modern SIMA XML archive correctly", () => {
    const model = parseSimaXml(SAMPLE_SIMA_XML, "case.sima");
    assert.equal(model.vessels.length, 1);
    const v = model.vessels[0]!;
    assert.equal(v.name, "SparFloater");
    assert.equal(v.mass, 8000000);
    assert.equal(v.fairleads.length, 3);

    assert.equal(model.lines.length, 1);
    const l1 = model.lines[0]!;
    assert.equal(l1.id, "line_1");
    assert.equal(l1.totalLength, 700.0);
    assert.equal(l1.segments[0]?.mbl, 1.5e7);
    assert.equal(model.environment.waterDepth, 200.0);
  });

  it("parses SINTEF .hyd hydrodynamic transfer functions", () => {
    const hyd = parseHydFile(SAMPLE_HYD_TEXT);
    assert.equal(hyd.frequencies.length, 10);
    assert.equal(hyd.headings.length, 3);
    assert.ok(hyd.raos[0]);
    assert.ok(hyd.raos[0]!.length >= 3);
  });

  it("universal parser detects XML vs Card Deck format automatically", () => {
    const m1 = parseSimaFile(SAMPLE_SIMO_DECK);
    assert.equal(m1.vessels[0]?.name, "OC4_Semi");
    const m2 = parseSimaFile(SAMPLE_SIMA_XML);
    assert.equal(m2.vessels[0]?.name, "SparFloater");
  });
});

describe("@modelscript/sima catenary solver suite", () => {
  it("solves catenary tension and suspended profile accurately", () => {
    const res = solveCatenary({
      waterDepth: 200,
      horizontalSpan: 700,
      lineLength: 850,
      submergedWeight: 2500,
      axialStiffnessEA: 1e9,
    });

    assert.ok(res.horizontalTension > 0, "Horizontal tension must be positive");
    assert.ok(res.fairleadVerticalTension > 0, "Vertical tension must be positive");
    assert.ok(res.fairleadTotalTension > res.horizontalTension, "Total tension exceeds horizontal");
    assert.ok(res.suspendedLength > 200 && res.suspendedLength <= 850);
    assert.ok(res.groundedLength >= 0);
    assert.ok(res.profile.length > 20);
    assert.equal(res.isLiftedOff, false);
  });

  it("handles straight-line taut line stretch when length < diagonal", () => {
    const res = solveCatenary({
      waterDepth: 100,
      horizontalSpan: 200,
      lineLength: 220, // diagonal is sqrt(100^2 + 200^2) = 223.6 > 220
      submergedWeight: 1000,
      axialStiffnessEA: 1e8,
    });
    assert.equal(res.isLiftedOff, true);
    assert.ok(res.fairleadTotalTension > 0);
  });
});

describe("@modelscript/sima pre-flight linter suite", () => {
  it("passes clean benchmark without errors", () => {
    const model = parseCardDeck(SAMPLE_SIMO_DECK);
    const diags = lintSimaProject(model);
    const errors = diags.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(errors)}`);
  });

  it("detects M7001 negative metacentric height", () => {
    const badDeck = `
SYS 200 1025
BODY bad_vessel UnstableHull 10000000 10000 0 0 -5 30 30 35 -1.5 5.0
`;
    const model = parseCardDeck(badDeck);
    const diags = lintSimaProject(model);
    const gmDiag = diags.find((d) => d.id === "M7001");
    assert.ok(gmDiag, "Must report M7001 for negative GMt");
  });

  it("detects M7002 line length underflow", () => {
    const badDeck = `
SYS 300 1025
BODY v1 Hull 10000000 10000 0 0 -5 30 30 35 4.5 5.0
FAIRLEAD fl1 v1 0 0 0
CRS c1 0.1 200 2000 1e9 1e5 1e7 1.2 2.0
LINE l1 catenary fl1 500 0 -300
SEGM c1 150
`;
    const model = parseCardDeck(badDeck);
    const diags = lintSimaProject(model);
    const lenDiag = diags.find((d) => d.id === "M7002");
    assert.ok(lenDiag, "Must report M7002 when length (150m) < water depth (300m)");
  });

  it("detects M7004 unconnected attachment node", () => {
    const badDeck = `
SYS 200 1025
BODY v1 Hull 10000000 10000 0 0 -5 30 30 35 4.5 5.0
FAIRLEAD fl_real v1 0 0 0
CRS c1 0.1 200 2000 1e9 1e5 1e7 1.2 2.0
LINE l1 catenary fl_phantom 500 0 -200
SEGM c1 600
`;
    const model = parseCardDeck(badDeck);
    const diags = lintSimaProject(model);
    const connDiag = diags.find((d) => d.id === "M7004");
    assert.ok(connDiag, "Must report M7004 for unresolved fairlead 'fl_phantom'");
  });

  it("detects M7006 invalid non-physical stiffness", () => {
    const badDeck = `
SYS 200 1025
BODY v1 Hull 10000000 10000 0 0 -5 30 30 35 4.5 5.0
FAIRLEAD fl1 v1 0 0 0
CRS c1 0.1 200 2000 -5.0 1e5 1e7 1.2 2.0
LINE l1 catenary fl1 500 0 -200
SEGM c1 600
`;
    const model = parseCardDeck(badDeck);
    const diags = lintSimaProject(model);
    const stiffDiag = diags.find((d) => d.id === "M7006");
    assert.ok(stiffDiag, "Must report M7006 for negative axial stiffness EA");
  });
});

describe("@modelscript/sima DNV compliance verification suite", () => {
  it("verifies DNV-OS-E301 safety factors on OC4 semi benchmark", () => {
    const model = parseCardDeck(SAMPLE_SIMO_DECK);
    const report = verifyDnvMooringCompliance(model, 2);
    assert.equal(report.standard, "DNV-OS-E301");
    assert.equal(report.lines.length, 3);
    for (const lineRes of report.lines) {
      assert.ok(lineRes.safetyFactorIntact >= 1.67, `Line ${lineRes.lineId} intact SF must be >= 1.67`);
      assert.ok(lineRes.safetyFactorDamaged >= 1.25, `Line ${lineRes.lineId} damaged SF must be >= 1.25`);
      assert.equal(lineRes.passedIntact, true);
      assert.equal(lineRes.passedDamaged, true);
    }
    assert.equal(report.summary.allPassed, true);
  });
});

describe("@modelscript/sima workspace index & projections suite", () => {
  it("indexes SIMA models into symbol table correctly", () => {
    const idx = new SimaWorkspaceIndex();
    const syms = idx.indexFile("sima://workspace/case.inp", SAMPLE_SIMO_DECK);
    assert.ok(syms.symbols.size >= 7);
    assert.ok(idx.has("sima://workspace/case.inp"));
    const m = idx.getModel("sima://workspace/case.inp");
    assert.equal(m?.vessels[0]?.name, "OC4_Semi");
  });

  it("synthesizes valid Modelica acausal physical model", () => {
    const model = parseCardDeck(SAMPLE_SIMO_DECK);
    const mo = simaToModelica(model, "OC4_Platform");
    assert.ok(mo.includes("model OC4_Platform"));
    assert.ok(mo.includes("der(surge) = v_surge;"));
    assert.ok(mo.includes("F_mooring_x"));
    assert.ok(mo.includes("end OC4_Platform;"));
  });

  it("synthesizes valid SystemStructure.ssd co-simulation manifest", () => {
    const model = parseCardDeck(SAMPLE_SIMO_DECK);
    const ssd = simaToSsp(model);
    assert.ok(ssd.includes("<ssd:SystemStructureDescription"));
    assert.ok(ssd.includes("OC4_Semi.fmu"));
    assert.ok(ssd.includes("MooringSystem.fmu"));
    assert.ok(ssd.includes("<ssd:Connection"));
  });

  it("exposes DSL simaLanguage specification", () => {
    assert.equal(simaLanguage.name, "sima");
    assert.ok(simaLanguage.fileExtensions.includes(".inp"));
    assert.ok(simaLanguage.fileExtensions.includes(".sima"));
  });
});
