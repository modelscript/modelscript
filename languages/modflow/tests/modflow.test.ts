// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  lintModflow,
  lowerModflowToDae,
  parseModflow,
  solveAquiferBalance,
  ModflowWorkspaceIndex,
  validateModflow,
  getModflowDocumentSymbols,
} from "../src/index.js";

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

test("MODFLOW Linter — validates clean model without errors", () => {
  const model = parseModflow(SAMPLE_MODFLOW_DECK);
  const diags = lintModflow(model);
  assert.strictEqual(diags.length, 0);
});

test("MODFLOW Linter — detects out-of-bounds well and inverted layer", () => {
  const badDeck = `
BEGIN DIS6
  NLAY 1
  NROW 2
  NCOL 2
  TOP 10.0
  BOTM 20.0
END DIS6
BEGIN NPF6
  K -5.0
  K33 1.0
  SS -0.01
  SY 1.5
END NPF6
BEGIN WEL6
  1 5 5 -100.0
END WEL6
BEGIN RIV6
  1 1 1 30.0 100.0 35.0
END RIV6
`;
  const model = parseModflow(badDeck);
  const diags = lintModflow(model);
  assert.ok(diags.length >= 4);

  const rules = diags.map((d) => d.rule);
  assert.ok(rules.includes("modflow-invalid-conductivity"));
  assert.ok(rules.includes("modflow-layer-elevation-inversion"));
  assert.ok(rules.includes("modflow-cell-out-of-bounds"));
  assert.ok(rules.includes("modflow-river-stage-below-bottom"));
});

test("MODFLOW Aquifer Solver — computes water balance and drawdown", () => {
  const model = parseModflow(SAMPLE_MODFLOW_DECK);
  const summary = solveAquiferBalance(model);
  assert.strictEqual(summary.totalPumpingRate, 400.0);
  assert.ok(summary.maxDrawdown > 0);
  assert.strictEqual(summary.cellBudgets.length, 18); // 2 layers * 3 rows * 3 cols
});

test("MODFLOW DAE Lowering — lowers grid cells and Darcy flow equations to DAE arena", () => {
  const model = parseModflow(SAMPLE_MODFLOW_DECK);
  const arena = lowerModflowToDae(model);
  const vars = arena.variables();
  assert.strictEqual(vars.length, 18); // 18 cells
  const eqs = arena.equations();
  assert.ok(eqs.length > 0);
});

test("MODFLOW Workspace Index — indexes grid and boundary symbols", () => {
  const indexer = new ModflowWorkspaceIndex();
  const idx = indexer.indexFile("file:///aquifer.dis", SAMPLE_MODFLOW_DECK);
  assert.ok(idx.symbols.size > 0);
  assert.ok(idx.byName.has("MODFLOW_Aquifer"));
});

test("MODFLOW LSP — validates diagnostics and document symbols", () => {
  const diags = validateModflow(SAMPLE_MODFLOW_DECK);
  assert.strictEqual(diags.length, 0);

  const symbols = getModflowDocumentSymbols(SAMPLE_MODFLOW_DECK);
  assert.ok(symbols.length >= 2);
});
