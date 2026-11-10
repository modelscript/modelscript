// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseModflow } from "../src/index.js";

const SAMPLE_MODFLOW_DECK = `
# MODFLOW 6 Simulation Model
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
  SS 1.0e-5
  SY 0.18
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

test("MODFLOW Parser — parses DIS, NPF, WEL, RIV, CHD blocks", () => {
  const model = parseModflow(SAMPLE_MODFLOW_DECK);
  assert.strictEqual(model.dis.nlay, 2);
  assert.strictEqual(model.dis.nrow, 3);
  assert.strictEqual(model.dis.ncol, 3);
  assert.strictEqual(model.dis.top, 50.0);
  assert.strictEqual(model.dis.botm.length, 2);
  assert.strictEqual(model.dis.botm[0], 20.0);
  assert.strictEqual(model.dis.botm[1], 0.0);

  assert.strictEqual(model.npf.k, 15.0);
  assert.strictEqual(model.npf.k33, 2.0);
  assert.strictEqual(model.npf.ss, 1.0e-5);
  assert.strictEqual(model.npf.sy, 0.18);

  assert.strictEqual(model.wells.length, 1);
  assert.strictEqual(model.wells[0]?.cell.layer, 1);
  assert.strictEqual(model.wells[0]?.cell.row, 2);
  assert.strictEqual(model.wells[0]?.cell.col, 2);
  assert.strictEqual(model.wells[0]?.q, -400.0);

  assert.strictEqual(model.rivers.length, 1);
  assert.strictEqual(model.rivers[0]?.stage, 48.0);
  assert.strictEqual(model.rivers[0]?.cond, 200.0);
  assert.strictEqual(model.rivers[0]?.rbot, 45.0);

  assert.strictEqual(model.chds.length, 2);
});
