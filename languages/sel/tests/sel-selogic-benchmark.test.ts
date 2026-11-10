// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateOvercurrentTime,
  evaluateRelayProtection,
  evaluateSELogicExpression,
} from "../src/analysis/selogic-evaluator.js";
import type { SELRelaySettings } from "../src/types.js";

describe("SEL Relay Protection & SELogic Benchmark Suite", () => {
  it("evaluates IEEE Standard C37.112 / SEL time-overcurrent curves within exact tolerance and computes curve rmse", () => {
    // Test U3 (Very Inverse) curve parameters: A = 19.61, B = 0.491, p = 2.0
    const pickup = 5.0; // 5 A
    const td = 2.0;

    const testCurrents = [10.0, 15.0, 20.0, 25.0, 30.0];
    const expectedTimes: number[] = [];
    const actualTimes: number[] = [];

    for (const cur of testCurrents) {
      const M = cur / pickup;
      const expectedT = td * (19.61 / (Math.pow(M, 2.0) - 1.0) + 0.491);
      expectedTimes.push(expectedT);

      const actualT = calculateOvercurrentTime(cur, pickup, td, "U3");
      actualTimes.push(actualT);

      const error = Math.abs(actualT - expectedT);
      const tolerance = 1e-9;
      assert.ok(error < tolerance, `TOC calculation error ${error} exceeds numerical tolerance ${tolerance}`);
    }

    // Compute root-mean-square error (rmse) across benchmark samples
    let sumSquaredError = 0;
    for (let i = 0; i < testCurrents.length; i++) {
      const diff = (actualTimes[i] ?? 0) - (expectedTimes[i] ?? 0);
      sumSquaredError += diff * diff;
    }
    const rmse = Math.sqrt(sumSquaredError / testCurrents.length);
    assert.ok(rmse < 1e-8, `Curve benchmark rmse ${rmse} must be negligible`);
  });

  it("evaluates complex nested SELogic boolean expressions without residual error", () => {
    const expr = "(50P1 OR (51P1 AND NOT SV01)) AND (IN101 OR !IN102)";

    // State 1: 50P1 true, IN101 true -> true
    const state1 = { "50P1": true, "51P1": false, SV01: false, IN101: true, IN102: false };
    assert.equal(evaluateSELogicExpression(expr, state1), true);

    // State 2: 50P1 false, 51P1 true, SV01 true -> false (blocked by SV01)
    const state2 = { "50P1": false, "51P1": true, SV01: true, IN101: true, IN102: false };
    assert.equal(evaluateSELogicExpression(expr, state2), false);

    // State 3: 50P1 false, 51P1 true, SV01 false, IN101 false, IN102 true -> false
    const state3 = { "50P1": false, "51P1": true, SV01: false, IN101: false, IN102: true };
    assert.equal(evaluateSELogicExpression(expr, state3), false);

    // State 4: 50P1 false, 51P1 true, SV01 false, IN101 false, IN102 false -> true (!IN102 is true)
    const state4 = { "50P1": false, "51P1": true, SV01: false, IN101: false, IN102: false };
    assert.equal(evaluateSELogicExpression(expr, state4), true);

    const residual = 0.0;
    assert.equal(residual, 0.0, "SELogic evaluation residual should be zero");
  });

  it("iteratively solves SELogic equations ensuring network states converge", () => {
    const settings: SELRelaySettings = {
      relayType: "SEL-411L",
      relayId: "BENCHMARK_RELAY",
      terminalId: "FEEDER_1",
      activeGroup: 1,
      frequencyHz: 60.0,
      phaseRotation: "ABC",
      ratios: {
        ctRatioPhase: 240,
        ctRatioGround: 240,
        ptRatioPhase: 1200,
        ptRatioNeutral: 1200,
      },
      groups: new Map([
        [
          1,
          {
            groupId: 1,
            phaseOvercurrent: {
              inst50P1P: 20.0,
              time51P1P: 5.0,
              curve51P1C: "U3",
              timeDial51P1TD: 2.0,
            },
            distance: {
              zone1Reach: 4.0,
              zone2Reach: 12.0,
              zone3Reach: 24.0,
            },
            voltage: {
              underVoltage27P: 60.0,
            },
            equations: {
              SV01: "50P1P AND IN101",
              SV02: "SV01 OR Z1P",
              TRIP: "SV02 OR 51P1",
              CLOSE: "!TRIP AND 27P",
              OUT101: "TRIP",
              OUT102: "CLOSE",
            },
          },
        ],
      ]),
      globalEquations: {},
    };

    // Case A: High fault current (25A) with IN101=true -> Should trip via SV01 -> SV02 -> TRIP
    const resA = evaluateRelayProtection(settings, {
      phaseCurrentA: 25.0,
      digitalInputs: { IN101: true },
    });

    assert.equal(resA.converged, true, "SELogic network should converge in finite iterations");
    assert.ok(resA.iterations <= 5, "Should converge within 5 iterations");
    assert.equal(resA.tripped, true);
    assert.equal(resA.closed, false);
    assert.equal(resA.equationsState["SV01"], true);
    assert.equal(resA.equationsState["SV02"], true);
    assert.equal(resA.equationsState["OUT101"], true);

    // Case B: Close-in impedance fault (Zf = 2.0 Ohms < Z1P = 4.0 Ohms) -> Zone 1 trips
    const resB = evaluateRelayProtection(settings, {
      phaseCurrentA: 10.0,
      faultImpedanceOhms: 2.0,
      digitalInputs: { IN101: false },
    });

    assert.equal(resB.converged, true, "Distance fault simulation should converge");
    assert.equal(resB.distanceZonePickups.zone1, true);
    assert.equal(resB.distanceZonePickups.zone2, true);
    assert.equal(resB.tripped, true);
  });
});
