// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { executeAspenAction, getAspenDocumentSymbols, getAspenHover, validateAspen } from "../src/index.js";

const TEST_DECK = `TITLE 'AMMONIA FLASH SYSTEM'
IN-UNITS MET
DEF-STREAMS CONV ALL

COMPONENTS
    AMMONIA NH3
    WATER   H2O

FLOWSHEET
    BLOCK FLASH1 IN=FEED OUT=VAP LIQ

PROPERTIES NRTL

STREAM FEED
    SUBSTREAM MIXED TEMP=45.0 PRES=2.0 MOLE-FLOW=80.0
    MOLE-FRAC AMMONIA 0.6 / WATER 0.4

BLOCK FLASH1 FLASH2
    PARAM TEMP=55.0 PRES=1.5
`;

test("Aspen LSP: validateAspen returns 0 diagnostics on clean deck", () => {
  const diags = validateAspen(TEST_DECK);
  assert.equal(diags.length, 0);
});

test("Aspen LSP: validateAspen returns diagnostics on flawed deck", () => {
  const flawedDeck = `FLOWSHEET
    BLOCK FLASH1 IN=NON_EXISTENT OUT=VAP LIQ
`;
  const diags = validateAspen(flawedDeck);
  assert.ok(diags.length > 0);
  assert.equal(diags[0]?.code, "M8101");
});

test("Aspen LSP: getAspenDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getAspenDocumentSymbols(TEST_DECK);
  assert.ok(symbols.length > 0);
  assert.equal(symbols[0]?.name, "AMMONIA FLASH SYSTEM");
  assert.ok(symbols[0]?.children && symbols[0].children.length >= 3);
});

test("Aspen LSP: getAspenHover returns markdown hover info", () => {
  // Line of BLOCK FLASH1 FLASH2 is line 18 (0-indexed: 17)
  const hoverBlock = getAspenHover(TEST_DECK, { line: 17, character: 7 });
  assert.ok(hoverBlock);
  assert.match(hoverBlock.contents.value, /Aspen Unit Operation: `FLASH1`/);
  assert.match(hoverBlock.contents.value, /FLASH2/);

  // Line of FEED is line 14 (0-indexed: 13)
  const hoverStream = getAspenHover(TEST_DECK, { line: 13, character: 8 });
  assert.ok(hoverStream);
  assert.match(hoverStream.contents.value, /Aspen Stream: `FEED`/);
  assert.match(hoverStream.contents.value, /45/);
});

test("Aspen LSP: executeAspenAction executes registered actions", async () => {
  const lintRes = await executeAspenAction("aspen_lint", TEST_DECK);
  assert.ok(Array.isArray(lintRes));

  const daeRes = await executeAspenAction("aspen_to_dae", TEST_DECK);
  assert.ok(daeRes.variableCount > 0);
  assert.ok(daeRes.equationCount > 0);

  const moRes = await executeAspenAction("aspen_to_modelica", TEST_DECK);
  assert.match(moRes, /model AMMONIA_FLASH_SYSTEM/);

  const flashRes = await executeAspenAction("aspen_solve_flash", TEST_DECK);
  assert.ok(flashRes.vaporFraction >= 0.0);
  assert.equal(flashRes.kValues.length, 2);
});
