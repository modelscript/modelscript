// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseModflow, solveAquiferBalance } from "../src/index.js";

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
  K33 2.0
END NPF6
BEGIN WEL6
  1 2 2 -400.0
END WEL6
BEGIN RIV6
  1 1 2 48.0 200.0 45.0
END RIV6
BEGIN CHD6
  1 1 1 50.0
  1 3 3 42.0
END CHD6
`;

test("MODFLOW Aquifer Solver — computes water balance and drawdown", () => {
  const model = parseModflow(SAMPLE_MODFLOW_DECK);
  const summary = solveAquiferBalance(model);
  assert.strictEqual(summary.totalPumpingRate, 400.0);
  assert.ok(summary.maxDrawdown > 0);
  assert.strictEqual(summary.cellBudgets.length, 18);
});
