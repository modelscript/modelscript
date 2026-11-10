// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOutputResistance,
  evaluateBufferCurrent,
  parseIbis,
  simulateIbisChannel,
} from "../src/index.js";

const SOLVER_IBIS = `[IBIS Ver] 4.0
[Component] SOLVER_CHIP
[Package]
R_pkg 0.10 0.05 0.15
L_pkg 1.0nH 0.5nH 1.5nH
C_pkg 0.8pF 0.5pF 1.2pF
[Pin]
1 OUT BUF_OUT

[Model] BUF_OUT
Model_type Output
Polarity Non-Inverting
C_comp 1.2pF 0.8pF 1.5pF
[Voltage Range] 1.8V 1.6V 2.0V
[Pulldown]
-1.8 -0.040 -0.030 -0.050
 0.0  0.000  0.000  0.000
 0.3  0.012  0.008  0.015
 1.8  0.036  0.025  0.045
[Pullup]
-1.8 -0.040 -0.030 -0.050
 0.0  0.000  0.000  0.000
 0.3  0.012  0.008  0.015
 1.8  0.036  0.025  0.045
[Ramp]
dV/dt_r 0.9V/50ps 0.7V/60ps 1.0V/40ps
dV/dt_f 0.9V/50ps 0.7V/60ps 1.0V/40ps
R_load 50
[End]
`;

test("IBIS Solver: calculates output resistance and non-linear dynamic currents", () => {
  const deck = parseIbis(SOLVER_IBIS);
  const outModel = deck.models.get("BUF_OUT")!;

  const { rOnLow, rOnHigh } = calculateOutputResistance(outModel);
  assert.ok(rOnLow > 5 && rOnLow < 100, `Expected realistic R_on low: ${rOnLow}`);
  assert.ok(rOnHigh > 5 && rOnHigh < 100, `Expected realistic R_on high: ${rOnHigh}`);

  const currHigh = evaluateBufferCurrent(outModel, 1.5, 1);
  assert.ok(currHigh.iTotal > 0, "Expected positive sourcing current at high state");

  const currLow = evaluateBufferCurrent(outModel, 0.3, 0);
  assert.ok(currLow.iTotal < 0, "Expected negative sinking current at low state");
});

test("IBIS Channel Solver: simulates lossy channel eye diagram", () => {
  const deck = parseIbis(SOLVER_IBIS);
  const outModel = deck.models.get("BUF_OUT")!;

  const sim = simulateIbisChannel(outModel, {
    dataRateGbps: 5,
    channelLossDb: 8,
    txTapWeights: [1.0],
  });

  assert.ok(sim.eyeHeightV > 0, "Eye height should be positive");
  assert.ok(sim.eyeWidthPs > 0, "Eye width should be positive");
  assert.ok(sim.worstCaseIsiV >= 0, "Worst case ISI should be non-negative");
  assert.ok(sim.eyeHeightBer1e12V >= 0, "Statistical eye height should be non-negative");
});
