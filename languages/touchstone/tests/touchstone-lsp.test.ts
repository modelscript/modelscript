// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  executeTouchstoneAction,
  getTouchstoneDocumentSymbols,
  getTouchstoneHover,
  LspSymbolKind,
  validateTouchstone,
} from "../src/index.js";

const VALID_TOUCHSTONE = `! 2-Port Bandpass Chebyshev Filter
# MHz S DB R 50
100.00  -25.0   15.0    -1.2   -30.0   -1.2   -30.0   -25.0   15.0
200.00  -22.0   -10.0   -1.5   -70.0   -1.5   -70.0   -22.0   -10.0
300.00  -2.1    -160.0  -18.0  -150.0  -18.0  -150.0  -2.1    -160.0
`;

const FLAWED_TOUCHSTONE = `! Flawed Touchstone Deck
# GHz S MA R -50
1.0 0.1 0.0  3.5 0.0  0.0 0.0  0.1 0.0
`;

test("Touchstone LSP: validateTouchstone returns 0 diagnostics on clean deck", () => {
  const diags = validateTouchstone(VALID_TOUCHSTONE);
  assert.strictEqual(diags.length, 0);
});

test("Touchstone LSP: validateTouchstone returns diagnostics on flawed deck", () => {
  const diags = validateTouchstone(FLAWED_TOUCHSTONE);
  assert(diags.length >= 2, `Expected at least 2 diagnostics, got ${diags.length}`);
  const passivityDiag = diags.find((d) => d.code === "M8301");
  const rDiag = diags.find((d) => d.code === "M8309");
  assert(passivityDiag !== undefined);
  assert(rDiag !== undefined);
});

test("Touchstone LSP: getTouchstoneDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getTouchstoneDocumentSymbols(VALID_TOUCHSTONE);
  assert.strictEqual(symbols.length, 1);
  const root = symbols[0]!;
  assert.strictEqual(root.kind, LspSymbolKind.Package);
  assert(root.name.includes("2-Port"));
  assert(root.children !== undefined && root.children.length >= 3);
});

test("Touchstone LSP: getTouchstoneHover returns markdown hover info", () => {
  // Line 1 (0-indexed: line 1 is option line)
  const optHover = getTouchstoneHover(VALID_TOUCHSTONE, { line: 1, character: 2 });
  assert(optHover !== undefined);
  assert(optHover.contents.value.includes("Touchstone Options"));
  assert(optHover.contents.value.includes("50 Ω"));

  // Line 2 (0-indexed: line 2 is first frequency sample: 100.00 MHz)
  const dataHover = getTouchstoneHover(VALID_TOUCHSTONE, { line: 2, character: 5 });
  assert(dataHover !== undefined);
  assert(dataHover.contents.value.includes("Frequency Sample"));
  assert(dataHover.contents.value.includes("Spectral Norm"));
});

test("Touchstone LSP: executeTouchstoneAction executes registered actions", async () => {
  const lintRes = await executeTouchstoneAction("touchstone_lint", VALID_TOUCHSTONE);
  assert(Array.isArray(lintRes));

  const passivityRes = await executeTouchstoneAction("touchstone_passivity", VALID_TOUCHSTONE);
  assert.strictEqual(passivityRes.isPassive, true);

  const daeRes = await executeTouchstoneAction("touchstone_to_dae", VALID_TOUCHSTONE);
  assert.strictEqual(daeRes.modelName, "NPortMacromodel");
  assert(daeRes.variableCount >= 8);

  const moRes = await executeTouchstoneAction("touchstone_to_modelica", VALID_TOUCHSTONE);
  assert(typeof moRes === "string");
  assert(moRes.includes("model TouchstoneNPort"));
});
