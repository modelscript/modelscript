// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { executeSwmmAction, getSwmmDocumentSymbols, getSwmmHover, validateSwmm } from "../src/index.js";

const TEST_SWMM_INP = `[TITLE]
Stormwater Drainage Subsystem

[OPTIONS]
FLOW_UNITS          CMS
FLOW_ROUTING        DYNWAVE

[JUNCTIONS]
J101             20.00      3.00       0.50

[OUTFALLS]
OUTFALL_BAY      10.00      FREE

[CONDUITS]
LINK1            J101       OUTFALL_BAY      200.00     0.015

[XSECTIONS]
LINK1            CIRCULAR   1.50
`;

test("SWMM LSP: validateSwmm returns 0 diagnostics on clean deck", () => {
  const diags = validateSwmm(TEST_SWMM_INP);
  assert.equal(diags.length, 0);
});

test("SWMM LSP: validateSwmm returns diagnostics on flawed deck", () => {
  const badDeck = `[JUNCTIONS]
J1 10.0 2.0

[CONDUITS]
C1 J1 MISSING_NODE 100.0 0.013
`;
  const diags = validateSwmm(badDeck);
  assert.ok(diags.length > 0);
  assert.equal(diags[0]?.code, "M8201");
});

test("SWMM LSP: getSwmmDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getSwmmDocumentSymbols(TEST_SWMM_INP);
  assert.ok(symbols.length > 0);
  assert.equal(symbols[0]?.name, "Stormwater Drainage Subsystem");
  assert.ok(symbols[0]?.children && symbols[0].children.length >= 3);
});

test("SWMM LSP: getSwmmHover returns markdown hover info", () => {
  // Line of LINK1 is line 15 (0-indexed: 14)
  const hoverConduit = getSwmmHover(TEST_SWMM_INP, { line: 14, character: 2 });
  assert.ok(hoverConduit);
  assert.match(hoverConduit.contents.value, /SWMM Conduit: `LINK1`/);
  assert.match(hoverConduit.contents.value, /J101/);

  // Line of J101 is line 9 (0-indexed: 8)
  const hoverJunction = getSwmmHover(TEST_SWMM_INP, { line: 8, character: 2 });
  assert.ok(hoverJunction);
  assert.match(hoverJunction.contents.value, /SWMM Junction: `J101`/);
  assert.match(hoverJunction.contents.value, /20/);
});

test("SWMM LSP: executeSwmmAction executes registered actions", async () => {
  const lintRes = await executeSwmmAction("swmm_lint", TEST_SWMM_INP);
  assert.ok(Array.isArray(lintRes));

  const daeRes = await executeSwmmAction("swmm_to_dae", TEST_SWMM_INP);
  assert.ok(daeRes.variableCount > 0);
  assert.ok(daeRes.equationCount > 0);

  const moRes = await executeSwmmAction("swmm_to_modelica", TEST_SWMM_INP);
  assert.match(moRes, /model Stormwater_Drainage_Subsystem/);

  const routeRes = await executeSwmmAction("swmm_route_flow", TEST_SWMM_INP);
  assert.ok(routeRes.conduits.size > 0);
  assert.equal(routeRes.isFlooding, false);
});
