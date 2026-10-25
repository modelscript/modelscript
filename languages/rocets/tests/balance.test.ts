// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRocetsDeck, simulateRocetsTransient, solveRocetsBalance } from "../src/index.js";

describe("@modelscript/rocets Solvers Suite", () => {
  const sampleDeck = `DECK: StagedCombustionEngine
COMPONENTS:
  CHAMBER TYPE=CHAMBER
    PARAMS: PC=15.0E6, MR=6.0, AT=0.04, EPS=60.0, VC=0.03
  PUMP_OX TYPE=PUMP
    PARAMS: DELTA_P=22.0E6, ETA=0.78
  PUMP_FUEL TYPE=PUMP
    PARAMS: DELTA_P=30.0E6, ETA=0.75
  TURB01 TYPE=TURBINE
    PARAMS: PR=1.6, ETA=0.74, T_IN=950.0
  SHAFT01 TYPE=SHAFT
    PARAMS: SPEED_RPM=32000.0, INERTIA=0.1
CONNECTIONS:
  PUMP_OX.OUT_P -> CHAMBER.IN_OX
  PUMP_FUEL.OUT_P -> CHAMBER.IN_FUEL
  TURB01.OUT_P -> CHAMBER.IN_GAS
`;

  it("solves steady-state power and flow balance", () => {
    const model = parseRocetsDeck(sampleDeck);
    const balance = solveRocetsBalance(model);

    assert.ok(balance.converged);
    assert.strictEqual(balance.chamberPressurePa, 15.0e6);
    assert.strictEqual(balance.mixtureRatio, 6.0);
    assert.ok(balance.totalMassFlowKgS > 100.0, `Total mdot ${balance.totalMassFlowKgS} kg/s`);
    assert.ok(balance.thrustVacN > 500000.0, `Vacuum thrust ${balance.thrustVacN} N`);
    assert.ok(balance.ispVacSec > 350.0, `Isp vac ${balance.ispVacSec} s`);
    assert.ok(balance.pumpPowersW["PUMP_OX"]! > 0);
    assert.ok(balance.pumpPowersW["PUMP_FUEL"]! > 0);
  });

  it("simulates ignition start transient trajectory", () => {
    const model = parseRocetsDeck(sampleDeck);
    const sim = simulateRocetsTransient(model, {
      tStart: 0.0,
      tEnd: 1.0,
      dt: 0.01,
      valveOpenTime: 0.1,
    });

    assert.ok(sim.times.length > 50);
    assert.strictEqual(sim.times[0], 0.0);

    // Initial conditions
    assert.strictEqual(sim.speedRpm[0], 0.0);
    assert.strictEqual(sim.thrustN[0], 0.0);

    // Final reached conditions
    const lastIdx = sim.times.length - 1;
    assert.ok(sim.pcPa[lastIdx]! > 10.0e6, `Final Pc ${sim.pcPa[lastIdx]} Pa`);
    assert.ok(sim.speedRpm[lastIdx]! > 25000.0, `Final RPM ${sim.speedRpm[lastIdx]}`);
    assert.ok(sim.thrustN[lastIdx]! > 400000.0, `Final thrust ${sim.thrustN[lastIdx]} N`);
    assert.ok(sim.wallTempK[lastIdx]! > 500.0, `Final wall temp ${sim.wallTempK[lastIdx]} K`);
  });
});
