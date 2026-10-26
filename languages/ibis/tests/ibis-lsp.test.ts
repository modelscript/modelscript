// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { executeIbisAction, getIbisDocumentSymbols, getIbisHover, LspSymbolKind, validateIbis } from "../src/index.js";

const VALID_IBIS = `[IBIS Ver] 3.2
[Component] TX_CHIP
[Package]
R_pkg 0.15 0.08 0.25
L_pkg 3.2nH 1.5nH 5.0nH
C_pkg 1.2pF 0.6pF 2.0pF
[Pin]
1 DATA LVCMOS_OUT

[Model] LVCMOS_OUT
Model_type Output
C_comp 2.5pF 1.8pF 3.2pF
[Voltage Range] 3.3V 3.0V 3.6V
[Pulldown]
0.0 0.000 0.000 0.000
0.4 0.016 0.010 0.024
3.3 0.050 0.035 0.070
[Pullup]
0.0 0.000 0.000 0.000
0.4 0.015 0.009 0.022
3.3 0.048 0.032 0.065
[End]
`;

const FLAWED_IBIS = `[IBIS Ver] 3.2
[Component] BROKEN_CHIP
[Package]
R_pkg -0.5 -0.8 -0.2
L_pkg 2.0nH 1.0nH 3.0nH
C_pkg 1.0pF 0.5pF 1.5pF
[Pin]
1 DATA UNDEFINED_MODEL_NAME

[Model] BAD_RANGE_MODEL
Model_type Output
C_comp -1.0pF -1.5pF -0.5pF
[Voltage Range] 3.3V 3.6V 3.0V
[End]
`;

test("IBIS LSP: validateIbis returns 0 diagnostics on clean deck", () => {
  const diags = validateIbis(VALID_IBIS);
  assert.strictEqual(diags.length, 0);
});

test("IBIS LSP: validateIbis returns diagnostics on flawed deck", () => {
  const diags = validateIbis(FLAWED_IBIS);
  assert(diags.length >= 3, `Expected at least 3 diagnostics, got ${diags.length}`);
  const pinDiag = diags.find((d) => d.code === "M8305");
  const vDiag = diags.find((d) => d.code === "M8317");
  assert(pinDiag !== undefined);
  assert(vDiag !== undefined);
});

test("IBIS LSP: getIbisDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getIbisDocumentSymbols(VALID_IBIS);
  assert.strictEqual(symbols.length, 1);
  const root = symbols[0]!;
  assert.strictEqual(root.kind, LspSymbolKind.Package);
  assert(root.children !== undefined && root.children.length >= 2);
});

test("IBIS LSP: getIbisHover returns markdown hover info", () => {
  // Line 2 (0-indexed: line 1 is [Component] TX_CHIP)
  const compHover = getIbisHover(VALID_IBIS, { line: 1, character: 2 });
  assert(compHover !== undefined);
  assert(compHover.contents.value.includes("TX_CHIP"));

  // Line 10 in 1-based indexing (0-indexed: line 9 is [Model] LVCMOS_OUT)
  const modHover = getIbisHover(VALID_IBIS, { line: 9, character: 2 });
  assert(modHover !== undefined);
  assert(modHover.contents.value.includes("LVCMOS_OUT"));
  assert(modHover.contents.value.includes("Output Resistance"));
});

test("IBIS LSP: executeIbisAction executes registered actions", async () => {
  const lintRes = await executeIbisAction("ibis_lint", VALID_IBIS);
  assert(Array.isArray(lintRes));

  const daeRes = await executeIbisAction("ibis_to_dae", VALID_IBIS);
  assert.strictEqual(daeRes.modelName, "IbisBufferModule");
  assert(daeRes.variableCount >= 8);

  const moRes = await executeIbisAction("ibis_to_modelica", VALID_IBIS);
  assert(typeof moRes === "string");
  assert(moRes.includes("model LVCMOS_OUT"));

  const evalRes = await executeIbisAction("ibis_eval_buffer", VALID_IBIS);
  assert.strictEqual(evalRes.modelName, "LVCMOS_OUT");
  assert(evalRes.resistance.rOnLow > 0);
});
