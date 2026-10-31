// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  computePreissmannSection,
  computeSubcatchmentRunoff,
  lintSwmm,
  lowerSwmmToDae,
  parseSwmm,
  routeNetworkFlow,
  serializeSwmm,
  solveSwmmDynamicWave,
  solveSwmmHydraulics,
  swmmToModelica,
  SwmmWorkspaceIndex,
} from "../src/index.js";

const VALID_SWMM_INP = `[TITLE]
;; Example Urban Stormwater Network
Example 3-Node Stormwater Network

[OPTIONS]
FLOW_UNITS          CMS
FLOW_ROUTING        DYNWAVE
INFILTRATION        HORTON

[JUNCTIONS]
;;Name           Elevation  MaxDepth   InitDepth  SurDepth   Apond
J1               15.00      2.50       0.50       0.00       0.00
J2               12.00      2.50       0.40       0.00       0.00

[OUTFALLS]
;;Name           Elevation  Type       Stage Data       Gated
OF1              8.00       FREE                        NO

[CONDUITS]
;;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset
C1               J1               J2               100.00     0.013      0.00       0.00
C2               J2               OF1              150.00     0.013      0.00       0.00

[XSECTIONS]
;;Link           Shape        Geom1      Geom2      Geom3      Geom4      Barrels
C1               CIRCULAR     1.20       0.00       0.00       0.00       1
C2               CIRCULAR     1.50       0.00       0.00       0.00       1

[SUBCATCHMENTS]
;;Name           RainGage         Outlet           Area     PctImperv Width    PctSlope
SC1              GAGE1            J1               2.50     60.00     150.00   1.50
`;

test("SWMM Parser: parses valid SWMM network deck into structured AST", () => {
  const deck = parseSwmm(VALID_SWMM_INP);

  assert.match(deck.title ?? "", /Example 3-Node Stormwater Network/);
  assert.equal(deck.flowUnits, "CMS");
  assert.equal(deck.routingModel, "DYNWAVE");

  // Junctions
  assert.equal(deck.junctions.size, 2);
  const j1 = deck.junctions.get("J1");
  assert.ok(j1);
  assert.equal(j1.elevation, 15.0);
  assert.equal(j1.maxDepth, 2.5);
  assert.equal(j1.initDepth, 0.5);

  // Outfalls
  assert.equal(deck.outfalls.size, 1);
  const of1 = deck.outfalls.get("OF1");
  assert.ok(of1);
  assert.equal(of1.elevation, 8.0);
  assert.equal(of1.type, "FREE");

  // Conduits
  assert.equal(deck.conduits.size, 2);
  const c1 = deck.conduits.get("C1");
  assert.ok(c1);
  assert.equal(c1.inletNode, "J1");
  assert.equal(c1.outletNode, "J2");
  assert.equal(c1.length, 100.0);
  assert.equal(c1.roughness, 0.013);

  // Cross Sections
  assert.equal(deck.crossSections.size, 2);
  const x1 = deck.crossSections.get("C1");
  assert.ok(x1);
  assert.equal(x1.shape, "CIRCULAR");
  assert.equal(x1.geom1, 1.2);

  // Subcatchments
  assert.equal(deck.subcatchments.size, 1);
  const sc1 = deck.subcatchments.get("SC1");
  assert.ok(sc1);
  assert.equal(sc1.outlet, "J1");
  assert.equal(sc1.area, 2.5);
});

test("SWMM Serializer: round-trips deck back to valid SWMM .inp format", () => {
  const deck = parseSwmm(VALID_SWMM_INP);
  const serialized = serializeSwmm(deck);
  const reParsed = parseSwmm(serialized);

  assert.equal(reParsed.flowUnits, deck.flowUnits);
  assert.equal(reParsed.routingModel, deck.routingModel);
  assert.equal(reParsed.junctions.size, deck.junctions.size);
  assert.equal(reParsed.outfalls.size, deck.outfalls.size);
  assert.equal(reParsed.conduits.size, deck.conduits.size);
  assert.equal(reParsed.crossSections.size, deck.crossSections.size);
});

test("SWMM Linter: detects dangling node reference (M8201)", () => {
  const badDeckText = `[JUNCTIONS]
J1 10.0 2.0

[CONDUITS]
C1 J1 MISSING_NODE 50.0 0.013

[XSECTIONS]
C1 CIRCULAR 1.0
`;
  const deck = parseSwmm(badDeckText);
  const diags = lintSwmm(deck);

  const m8201 = diags.find((d) => d.code === "M8201");
  assert.ok(m8201, "Expected M8201 for dangling node");
  assert.match(m8201.message, /Link 'C1' references undefined outlet node 'MISSING_NODE'/);
});

test("SWMM Linter: detects adverse conduit slope (M8202)", () => {
  const adverseDeckText = `[JUNCTIONS]
J1 5.0 2.0
J2 15.0 2.0

[CONDUITS]
C1 J1 J2 100.0 0.013

[XSECTIONS]
C1 CIRCULAR 1.0
`;
  const deck = parseSwmm(adverseDeckText);
  const diags = lintSwmm(deck);

  const m8202 = diags.find((d) => d.code === "M8202");
  assert.ok(m8202, "Expected M8202 for adverse slope");
  assert.match(m8202.message, /Conduit 'C1' has adverse slope/);
});

test("SWMM Linter: detects missing cross-section (M8203)", () => {
  const missingXsecText = `[JUNCTIONS]
J1 10.0 2.0
J2 5.0 2.0

[CONDUITS]
C1 J1 J2 100.0 0.013
`;
  const deck = parseSwmm(missingXsecText);
  const diags = lintSwmm(deck);

  const m8203 = diags.find((d) => d.code === "M8203");
  assert.ok(m8203, "Expected M8203 for missing cross-section");
  assert.match(m8203.message, /Conduit 'C1' has no hydraulic cross-section definition in '\[XSECTIONS\]'/);
});

test("SWMM Linter: detects negative Manning roughness (M8208) and zero length (M8209)", () => {
  const badConduitText = `[JUNCTIONS]
J1 10.0 2.0
J2 5.0 2.0

[CONDUITS]
C1 J1 J2 0.0 -0.015

[XSECTIONS]
C1 CIRCULAR 1.0
`;
  const deck = parseSwmm(badConduitText);
  const diags = lintSwmm(deck);

  const m8208 = diags.find((d) => d.code === "M8208");
  assert.ok(m8208, "Expected M8208 for negative roughness");

  const m8209 = diags.find((d) => d.code === "M8209");
  assert.ok(m8209, "Expected M8209 for zero length");
});

test("SWMM Linter: detects isolated junction (M8210)", () => {
  const isolatedText = `[JUNCTIONS]
J_ISOLATED 10.0 2.0
`;
  const deck = parseSwmm(isolatedText);
  const diags = lintSwmm(deck);

  const m8210 = diags.find((d) => d.code === "M8210");
  assert.ok(m8210, "Expected M8210 for isolated node");
  assert.match(m8210.message, /Junction 'J_ISOLATED' has no connected conduits/);
});

test("SWMM Hydraulic Solver: routes network flows using Manning equation", () => {
  const deck = parseSwmm(VALID_SWMM_INP);
  const result = routeNetworkFlow(deck);

  assert.equal(result.isFlooding, false);
  assert.ok(result.totalInflow > 0.0);
  assert.ok(result.conduits.size === 2);

  const c1 = result.conduits.get("C1");
  assert.ok(c1);
  assert.ok(c1.flowRate > 0.0);
  assert.ok(c1.velocity > 0.0);
  assert.equal(c1.status, "NORMAL");

  const c2 = result.conduits.get("C2");
  assert.ok(c2);
  assert.ok(c2.flowRate > 0.0);
});

test("SWMM DAE Lowering: compiles network into linear memory DAEBuilder arena", () => {
  const deck = parseSwmm(VALID_SWMM_INP);
  const dae = lowerSwmmToDae(deck);

  assert.ok(dae.variables().length >= 10, "Expected at least 10 state variables");
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  // Verify node variables
  assert.ok(dae.lookupVariable("H_J1") !== -1);
  assert.ok(dae.lookupVariable("d_J1") !== -1);
  assert.ok(dae.lookupVariable("H_OF1") !== -1);

  // Verify conduit variables
  assert.ok(dae.lookupVariable("Q_C1") !== -1);
  assert.ok(dae.lookupVariable("A_C1") !== -1);
  assert.ok(dae.lookupVariable("V_C1") !== -1);
  assert.ok(dae.lookupVariable("Sf_C1") !== -1);
});

test("SWMM Linter: detects M8204, M8205, M8206, and M8207 diagnostics", () => {
  const inp = `[JUNCTIONS]
J1  10.0  0.5  0.1
J1  12.0  0.5  0.1

[OUTFALLS]
OF1  5.0  WEIRD_TYPE

[CONDUITS]
C1  J1  OF1  100.0  0.013
C1  J1  OF1  120.0  0.013

[XSECTIONS]
C1  CIRCULAR  1.5
`;
  const deck = parseSwmm(inp);
  const diags = lintSwmm(deck);
  assert.ok(
    diags.some((d) => d.code === "M8204"),
    "Should emit M8204 for unsupported outfall type",
  );
  assert.ok(
    diags.some((d) => d.code === "M8205"),
    "Should emit M8205 for surcharge overflow risk",
  );
  assert.ok(
    diags.some((d) => d.code === "M8206"),
    "Should emit M8206 for duplicate node ID",
  );
  assert.ok(
    diags.some((d) => d.code === "M8207"),
    "Should emit M8207 for duplicate link ID",
  );
});

test("SWMM Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseSwmm(VALID_SWMM_INP);
  const moCode = swmmToModelica(deck);

  assert.match(moCode, /model Example_3_Node_Stormwater_Network/);
  assert.match(moCode, /import Modelica\.Units\.SI;/);
  assert.match(moCode, /parameter SI\.Length z_invert_J1/);
  assert.match(moCode, /head_J1 = z_invert_J1 \+ depth_J1;/);
  assert.match(moCode, /aPond_J1 \* der\(depth_J1\) = Q_in_J1 - Q_out_J1;/);
  assert.match(moCode, /end Example_3_Node_Stormwater_Network;/);
});

test("SWMM Workspace Index: indexes multi-file symbols accurately", () => {
  const index = new SwmmWorkspaceIndex();
  const uri = "file:///workspace/network.inp";
  const symIdx = index.indexFile(uri, VALID_SWMM_INP);

  assert.ok(index.has(uri));
  assert.ok(symIdx.symbols.size > 0);

  // Name based lookup
  assert.ok(symIdx.byName.has("J1"));
  assert.ok(symIdx.byName.has("OF1"));
  assert.ok(symIdx.byName.has("C1"));
  assert.ok(symIdx.byName.has("SC1"));
});

test("SWMM Subcatchment Runoff: computes nonlinear reservoir overland flow and parses [SUBAREAS]", () => {
  const inpWithSubareas = `${VALID_SWMM_INP}
[SUBAREAS]
;;Subcatchment   N-Imperv   N-Perv     S-Imperv   S-Perv     PctZero    RouteTo
SC1              0.014      0.120      1.80       4.50       25.0       OUTLET
`;
  const deck = parseSwmm(inpWithSubareas);
  const sc1 = deck.subcatchments.get("SC1")!;
  assert.equal(sc1.nImperv, 0.014);
  assert.equal(sc1.nPerv, 0.12);
  assert.equal(sc1.dstoreImperv, 1.8);
  assert.equal(sc1.dstorePerv, 4.5);

  // Below depression storage (d <= d_p), runoff must be 0
  const qDry = computeSubcatchmentRunoff(sc1, 0.001, { depressionStorage: 0.002, manningN: 0.015 });
  assert.equal(qDry, 0.0);

  // Above depression storage: Q = W * (1/n) * (d - d_p)^(5/3) * S^(1/2)
  const d = 0.012;
  const dp = 0.002;
  const n = 0.015;
  const qWet = computeSubcatchmentRunoff(sc1, d, { depressionStorage: dp, manningN: n });
  const expectedQ = 150.0 * (1.0 / 0.015) * Math.pow(0.01, 5.0 / 3.0) * Math.sqrt(0.015);
  assert.ok(Math.abs(qWet - expectedQ) < 1e-6, `Expected ${expectedQ}, got ${qWet}`);
});

test("SWMM Preissmann Slot & 1D Saint-Venant Dynamic Wave (DYNWAVE): simulates unsteady flow and pressurized surcharge", () => {
  const openSec = computePreissmannSection(1.0, 0.5, 25.0);
  assert.equal(openSec.isSurcharged, false);

  const surSec = computePreissmannSection(1.0, 1.8, 25.0);
  assert.equal(surSec.isSurcharged, true);
  assert.ok(surSec.area > (Math.PI * 1.0 * 1.0) / 4.0, "Surcharged area must include Preissmann slot area above crown");
  assert.ok(surSec.topWidth > 0, "Preissmann slot topWidth must be positive");

  // Run unsteady 1D Saint-Venant Dynamic Wave on storm event
  const deck = parseSwmm(VALID_SWMM_INP);
  const dynRes = solveSwmmDynamicWave(deck, {
    durationSeconds: 60.0,
    timeStepSeconds: 2.0,
    rainfallIntensityMmPerHr: 80.0,
    infiltrationRateMmPerHr: 5.0,
  });

  assert.ok(dynRes.timeSeries.length === 31, `Expected 31 time steps, got ${dynRes.timeSeries.length}`);
  assert.ok((dynRes.subcatchmentRunoff.get("SC1") ?? 0) > 0, "Subcatchment SC1 should generate positive runoff");
  assert.ok((dynRes.peakConduitFlows["C1"] ?? 0) > 0, "Conduit C1 should experience positive unsteady flow");
  assert.ok((dynRes.peakConduitFlows["C2"] ?? 0) > 0, "Conduit C2 should experience positive unsteady flow");

  // Dispatch via solveSwmmHydraulics when routingModel === "DYNWAVE"
  const dispatched = solveSwmmHydraulics(deck, { durationSeconds: 30.0, timeStepSeconds: 5.0 });
  assert.ok(dispatched.totalInflow > 0);
  assert.ok(dispatched.conduits.get("C1")!.flowRate > 0);

  // Pressurized surcharge test with high initial depth above conduit crown
  const surchargedInp = `[OPTIONS]
FLOW_UNITS          CMS
FLOW_ROUTING        DYNWAVE

[JUNCTIONS]
J1               15.00      3.00       1.50       1.00       5.00
J2               12.00      3.00       1.40       1.00       5.00

[OUTFALLS]
OF1              8.00       FREE                        NO

[CONDUITS]
C1               J1               J2               80.00      0.013      0.00       0.00
C2               J2               OF1              80.00      0.013      0.00       0.00

[XSECTIONS]
C1               CIRCULAR     0.80       0.00       0.00       0.00       1
C2               CIRCULAR     0.80       0.00       0.00       0.00       1
`;
  const surDeck = parseSwmm(surchargedInp);
  const surDyn = solveSwmmDynamicWave(surDeck, { durationSeconds: 20.0, timeStepSeconds: 2.0 });
  assert.ok(
    surDyn.surchargedConduits.includes("C1"),
    "Conduit C1 (D=0.8m, d_init=1.5m) must be surcharged via Preissmann slot",
  );
  assert.equal(surDyn.conduits.get("C1")?.status, "SURCHARGED");
});
