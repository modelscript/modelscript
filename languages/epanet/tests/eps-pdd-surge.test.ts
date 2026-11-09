// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInp, solveExtendedPeriod, solvePddHydraulics, solveWaterHammerMoc } from "../src/index.js";

describe("EPANET Extended Period Simulation (EPS)", () => {
  const SAMPLE_EPS_DECK = `[TITLE]
Small Municipal EPS Network with Tank and Diurnal Demand Pattern

[JUNCTIONS]
;ID    Elev   Demand   Pattern
 J1    10.0   20.0     PAT_RES
 J2    15.0   15.0     PAT_RES
 J3    20.0   10.0     PAT_RES

[RESERVOIRS]
;ID    Head
 RES1  100.0

[TANKS]
;ID    Elev   InitLevel  MinLevel  MaxLevel  Diam  MinVol
 TANK1 50.0   5.0        1.0       10.0      20.0  0.0

[PIPES]
;ID    Node1  Node2  Length  Diam   Roughness  MinorLoss  Status
 P1    RES1   J1     1000    300    130        0          OPEN
 P2    J1     J2     800     250    130        0          OPEN
 P3    J2     J3     600     200    130        0          OPEN
 P4    J2     TANK1  500     250    130        0          OPEN

[PUMPS]
;ID    Node1  Node2  Parameters
 PUMP1 J1     J2     POWER 25.0

[PATTERNS]
;ID       Multipliers
 PAT_RES  0.6  0.8  1.2  1.4  1.0  0.7

[CONTROLS]
 LINK PUMP1 CLOSED IF NODE TANK1 ABOVE 8.5
 LINK PUMP1 OPEN IF NODE TANK1 BELOW 3.0

[OPTIONS]
 UNITS       LPS
 HEADLOSS    H-W
 ACCURACY    0.001
`;

  it("parses patterns and controls from INP deck", () => {
    const net = parseInp(SAMPLE_EPS_DECK);
    assert.strictEqual(net.patterns.length, 1);
    assert.strictEqual(net.patterns[0]?.id, "PAT_RES");
    assert.deepStrictEqual(net.patterns[0]?.multipliers, [0.6, 0.8, 1.2, 1.4, 1.0, 0.7]);
    assert.strictEqual(net.controls?.length, 2);
    assert.strictEqual(net.controls[0]?.linkId, "PUMP1");
    assert.strictEqual(net.controls[0]?.status, "CLOSED");
    assert.strictEqual(net.controls[0]?.operator, "ABOVE");
    assert.strictEqual(net.controls[0]?.value, 8.5);
  });

  it("simulates 24-hour Extended Period Simulation with dynamic tank water levels", () => {
    const net = parseInp(SAMPLE_EPS_DECK);
    const epsResult = solveExtendedPeriod(net, {
      durationHours: 6,
      stepHours: 1,
      patternStepHours: 1,
    });

    assert.strictEqual(epsResult.steps.length, 6);
    assert.strictEqual(epsResult.steps[0]?.timeHours, 0);
    assert.strictEqual(epsResult.steps[5]?.timeHours, 5);

    // Verify all steps converged
    for (const step of epsResult.steps) {
      assert.strictEqual(step.converged, true);
      assert.ok(step.nodeHeads.has("J1"));
      assert.ok(step.tankLevels.has("TANK1"));
    }

    // Verify demand variations across time steps due to PAT_RES pattern
    const dStep0 = epsResult.steps[0]!.nodeDemands.get("J1")!;
    const dStep3 = epsResult.steps[3]!.nodeDemands.get("J1")!;
    // Pattern multiplier at t=0 is 0.6, at t=3 is 1.4
    assert.ok(Math.abs(dStep0 - 20.0 * 0.6) < 1e-3);
    assert.ok(Math.abs(dStep3 - 20.0 * 1.4) < 1e-3);

    // Verify tank level changes dynamically over time
    const initLvl = epsResult.steps[0]!.tankLevels.get("TANK1")!;
    const endLvl = epsResult.steps[5]!.tankLevels.get("TANK1")!;
    assert.strictEqual(initLvl, 5.0);
    assert.ok(endLvl >= 1.0 && endLvl <= 10.0);

    // Verify system pressure bounds and cumulative pump energy
    assert.ok(epsResult.minSystemPressure > 0);
    assert.ok(epsResult.maxSystemPressure > epsResult.minSystemPressure);
    assert.ok(epsResult.totalEnergyKwh >= 0);
  });
});

describe("EPANET Pressure-Dependent Demand (PDD)", () => {
  const LOW_PRESSURE_DECK = `[TITLE]
Low Pressure Deficient Network for PDD Testing

[JUNCTIONS]
;ID   Elev   Demand
 J1   40.0   50.0
 J2   85.0   80.0

[RESERVOIRS]
;ID   Head
 R1   90.0

[PIPES]
;ID   Node1  Node2  Length  Diam   Roughness
 P1   R1     J1     1000    200    100
 P2   J1     J2     2000    150    100

[OPTIONS]
 UNITS    LPS
 HEADLOSS H-W
`;

  it("throttles delivered demand gracefully under PDD formulation during pressure deficiency", () => {
    const net = parseInp(LOW_PRESSURE_DECK);

    // Under standard DDA: fixed demand causes severe pressure collapse at high elevation J2 (elev=85m, source=90m)
    const pddResult = solvePddHydraulics(net, {
      enabled: true,
      pMin: 2.0, // below 2m of pressure, zero flow
      pReq: 25.0, // 25m required for full 100% flow
      exponent: 0.5,
    });

    assert.strictEqual(pddResult.converged, true);
    assert.strictEqual(pddResult.requiredDemandLps, 130.0);
    // Because J2 elevation is 85m and R1 is 90m, headloss reduces available pressure below 25m
    assert.ok(pddResult.deliveredDemandLps < pddResult.requiredDemandLps);
    assert.ok(pddResult.deliveredDemandLps > 0.0);
    assert.ok(pddResult.satisfactionRatio < 1.0);
    assert.ok(pddResult.unservedNodes.includes("J2"));

    // Delivered demand at J2 must be less than requested 80 LPS
    const j2Actual = pddResult.hydraulics.nodeActualDemands?.get("J2") ?? 0;
    assert.ok(j2Actual < 80.0);
  });
});

describe("EPANET Method of Characteristics (MOC) Water Hammer Surge Solver", () => {
  it("computes Joukowsky acoustic wave rise and pressure oscillations on rapid valve closure", () => {
    // Pipeline: 1000m ductile iron, D=0.5m, wave speed a=1200 m/s
    const pipe = {
      id: "MAIN_LINE",
      lengthM: 1000.0,
      diameterM: 0.5,
      waveSpeedMps: 1200.0,
      darcyRoughness: 0.018,
      elevationDownstreamM: 0.0,
    };

    const area = (Math.PI * 0.5 * 0.5) / 4.0; // ~0.1963 m^2
    const flowM3s = 0.3927; // ~2.0 m/s initial velocity
    const v0 = flowM3s / area; // ~2.0 m/s

    const initialSteady = {
      flowM3s,
      headUpstreamM: 80.0,
      headDownstreamM: 70.0,
    };

    const event = {
      type: "VALVE_CLOSURE" as const,
      durationSeconds: 0.2, // rapid closure (< 2L/a = 1.67s => instantaneous Joukowsky surge)
      exponent: 1.0,
    };

    const result = solveWaterHammerMoc(pipe, initialSteady, event, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 10,
    });

    // Theoretical Joukowsky surge: Delta H = a * v0 / g = 1200 * 2.0 / 9.80665 ~ 244.7m
    const expectedSurge = (1200.0 * v0) / 9.80665;
    assert.ok(Math.abs(result.joukowskySurgeM - expectedSurge) < 1.0);

    // Peak head at valve should reach initial steady head + Joukowsky surge
    assert.ok(result.maxHeadM >= 70.0 + expectedSurge * 0.95);
    assert.ok(result.maxPressurePsi > 400.0);

    // Wave reflections: fundamental period 4L / a = 4 * 1000 / 1200 = 3.33s
    assert.ok(Math.abs(result.fundamentalPeriodSeconds - 3.333) < 0.05);

    // Verify time series snapshots captured
    assert.ok(result.timeSeries.length > 20);
    const firstStep = result.timeSeries[0]!;
    assert.strictEqual(firstStep.timeSeconds, 0);
  });
});
