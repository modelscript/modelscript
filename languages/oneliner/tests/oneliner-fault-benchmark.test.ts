// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateBusFaultCurrents, calculateOvercurrentTripTime } from "../src/analysis/fault-solver.js";
import type { OneLinerCase, OneLinerOvercurrentRelay } from "../src/types.js";

describe("ASPEN OneLiner Symmetrical Components & Protection Benchmark Suite", () => {
  const sampleCase: OneLinerCase = {
    title: "500kV Transmission Interconnection Fault Benchmark",
    baseMva: 100.0,
    frequencyHz: 60.0,
    busses: [
      { id: "BUS500", name: "Substation 500kV", baseKv: 500.0 },
      { id: "BUS230", name: "Substation 230kV", baseKv: 230.0 },
    ],
    branches: [
      {
        id: "XF500-230",
        bus1: "BUS500",
        bus2: "BUS230",
        z1: { r: 0.002, x: 0.08 },
        z0: { r: 0.002, x: 0.08 },
      },
    ],
    mutuals: [],
    generators: [
      {
        id: "GEN_500",
        busId: "BUS500",
        mvaRating: 1200.0,
        z1Subtransient: { r: 0.001, x: 0.15 },
        z0: { r: 0.001, x: 0.08 },
      },
    ],
    overcurrentRelays: [],
    distanceRelays: [],
  };

  it("calculates 3-phase and SLG short circuit currents converging within tolerance and residual bounds", () => {
    const tolerance = 1e-3;
    const result = calculateBusFaultCurrents(sampleCase, "BUS500", { tolerance });

    assert.equal(result.converged, true, "Fault sequence network calculations should converge");
    assert.ok(result.i3PhaseA > 0, "3-Phase fault current must be positive");
    assert.ok(result.iSlgA > 0, "Single line-to-ground fault current must be positive");

    assert.ok(
      result.residualMax < tolerance,
      `Max residual ${result.residualMax} must be within tolerance ${tolerance}`,
    );
    assert.ok(result.rmse < tolerance, `RMSE ${result.rmse} must remain within tolerance`);

    // Thevenin impedance magnitude sanity
    assert.ok(result.z1Thevenin.mag > 0);
    assert.ok(result.z0Thevenin.mag > 0);
  });

  it("evaluates IEEE Standard C37.112 Time-Overcurrent (TOC) relay curves with exact precision", () => {
    const relay: OneLinerOvercurrentRelay = {
      id: "RELAY_51",
      name: "Feeder 51 Protection",
      branchId: "XF500-230",
      busId: "BUS500",
      pickupA: 1000.0,
      ctRatio: 240.0,
      timeDial: 2.0,
      curve: "IEEE_Very_Inverse", // A=19.61, B=0.491, p=2.0
      instantaneousPickupA: 10000.0,
    };

    // 1. Below pickup: current = 800A (< 1000A) -> should not trip (Infinity)
    const tripBelow = calculateOvercurrentTripTime(relay, 800.0);
    assert.equal(tripBelow.tripTimeSec, Infinity);

    // 2. Over pickup: current = 2000A (M = 2.0)
    // Formula: t = 2.0 * (19.61 / (2.0^2 - 1) + 0.491) = 2.0 * (19.61 / 3 + 0.491) = 2.0 * (6.53666 + 0.491) = 14.055 s
    const tripAt2M = calculateOvercurrentTripTime(relay, 2000.0);
    const expectedTime = 2.0 * (19.61 / (Math.pow(2.0, 2.0) - 1.0) + 0.491);
    const tolerance = 1e-4;
    assert.ok(Math.abs(tripAt2M.tripTimeSec - expectedTime) < tolerance);
    assert.equal(tripAt2M.isInstantaneous, false);

    // 3. Instantaneous trip: current = 12000A (>= 10000A) -> 1 cycle (~0.016 s)
    const tripInst = calculateOvercurrentTripTime(relay, 12000.0);
    assert.equal(tripInst.isInstantaneous, true);
    assert.ok(tripInst.tripTimeSec <= 0.02);
  });
});
