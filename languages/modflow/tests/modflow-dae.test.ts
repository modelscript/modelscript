// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerModflowToDae, parseModflow } from "../src/index.js";

const SAMPLE_MODFLOW_DECK = `
BEGIN DIS6
  NLAY 2
  NROW 3
  NCOL 3
  DELR 100.0
  DELC 100.0
  TOP 50.0
  BOTM 20.0 0.0
END DIS6
BEGIN NPF6
  K 15.0
END NPF6
`;

test("MODFLOW DAE Lowering — lowers grid cells and Darcy flow equations to DAE arena", () => {
  const model = parseModflow(SAMPLE_MODFLOW_DECK);
  const arena = lowerModflowToDae(model);
  const vars = arena.variables();
  assert.strictEqual(vars.length, 18);
  const eqs = arena.equations();
  assert.ok(eqs.length > 0);
});
