// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintIbis, parseIbis } from "../src/index.js";

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
[Pulldown]
0.0 0.000 0.000 0.000
1.0 0.050 0.030 0.070
2.0 0.020 0.010 0.030
[End]
`;

test("IBIS Linter: detects missing pin model binding (M8305)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  assert.ok(diags.some((d) => d.code === 8305), "Expected M8305 for missing pin model");
});

test("IBIS Linter: detects inverted voltage range (M8317)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  assert.ok(diags.some((d) => d.code === 8317), "Expected M8317 for inverted voltage range");
});

test("IBIS Linter: detects non-monotonic I/V curve (M8303)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  assert.ok(diags.some((d) => d.code === 8303), "Expected M8303 for non-monotonic pulldown");
});

test("IBIS Linter: detects negative package parasitics and die capacitance (M8320, M8321)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  assert.ok(diags.some((d) => d.code === 8321), "Expected M8321 for negative R_pkg");
  assert.ok(diags.some((d) => d.code === 8320), "Expected M8320 for negative C_comp");
});
