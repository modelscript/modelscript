// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { simulateTelecomMicrogrid } from "../simulate_microgrid.js";

test("Telecom Central Office -48V DC Microgrid Simulation", async (t) => {
  await t.test("simulates hitless battery takeover and ATS diesel generator transfer", () => {
    const trajectory = simulateTelecomMicrogrid(20.0, 0.1);

    // Initial state: grid healthy, float charging at -54.0V
    const initialState = trajectory[0]!;
    assert.equal(initialState.vDcBus, -54.0);
    assert.equal(initialState.iBattery, 0.0);
    assert.ok(initialState.iRectifier < -250.0);

    // Outage state at t = 5.0s: grid lost, diesel starting, battery discharging
    const outageState = trajectory.find((s) => Math.abs(s.time - 5.0) < 0.05);
    assert.ok(outageState !== undefined);
    assert.equal(outageState.gridAvailable, false);
    assert.equal(outageState.atsGeneratorConnected, false);
    assert.equal(outageState.iRectifier, 0.0);
    // Instantaneous battery discharge takeover (~323 A)
    assert.ok(outageState.iBattery > 300.0 && outageState.iBattery < 350.0);
    // ETSI EN 300 132-2 voltage tolerance: -40.5V to -57.0V
    assert.ok(outageState.vDcBus > -57.0 && outageState.vDcBus < -40.5);

    // Restored state at t = 15.0s: generator on, ATS switched
    const restoredState = trajectory.find((s) => Math.abs(s.time - 15.0) < 0.05);
    assert.ok(restoredState !== undefined);
    assert.equal(restoredState.atsGeneratorConnected, true);
    assert.equal(restoredState.vDcBus, -54.0);
    assert.equal(restoredState.iBattery, 0.0);
  });
});
