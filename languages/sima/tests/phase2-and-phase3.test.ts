// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFatigueDamage,
  createRationalRealization,
  evaluateOffsetLimits,
  extractTurningPoints,
  lowerSimaToDae,
  parseCardDeck,
  rainflowCount,
  simaToSysml2,
  simulateCumminsDynamics,
} from "../src/index.js";

const SAMPLE_SIMO_DECK = `
! SIMO / RIFLEX Benchmark: OC4 Semi-Submersible Floating Offshore Wind
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

describe("@modelscript/sima phase 2 & 3 verification and solvers suite", () => {
  const model = parseCardDeck(SAMPLE_SIMO_DECK);

  it("evaluates offset limits, watch circle, and touchdown clearances", () => {
    const report = evaluateOffsetLimits(model, {
      maxOffsetPercentWaterDepth: 8.0,
      maxFairleadAngleDeg: 80.0,
      minGroundedLengthMeters: 50.0,
    });

    assert.equal(report.waterDepth, 200.0);
    assert.equal(report.watchCircleRadiusMeters, 16.0); // 8% of 200m
    assert.ok(report.meanOffsetMeters.total > 0 && report.meanOffsetMeters.total < 16.0);
    assert.ok(report.excursionUtilization < 1.0);
    assert.equal(report.lines.length, 3);
    for (const l of report.lines) {
      assert.ok(l.fairleadAngleDeg > 20 && l.fairleadAngleDeg < 80);
      assert.ok(l.touchdownDistanceToAnchor > 50.0);
      assert.equal(l.anchorUpliftDeg, 0);
    }
    assert.equal(report.allPassed, true);
  });

  it("performs ASTM E1049 rainflow counting and Palmgren-Miner fatigue calculation", () => {
    // Generate sinusoidal tension history with 2 cycles of amplitude 20 MPa and 1 of 40 MPa
    const tValues: number[] = [];
    for (let t = 0; t <= 100; t++) {
      const val = 100 + 20 * Math.sin((2 * Math.PI * t) / 10) + 15 * Math.sin((2 * Math.PI * t) / 50);
      tValues.push(val);
    }

    const turningPts = extractTurningPoints(tValues);
    assert.ok(turningPts.length > 5);

    const cycles = rainflowCount(tValues);
    assert.ok(cycles.length > 0);

    const fatigue = computeFatigueDamage({
      timeSeries: tValues,
      simDurationSeconds: 100,
      curve: "studless_chain",
      designFatigueFactor: 2.5,
      designLifeYears: 25,
    });

    assert.ok(fatigue.totalCycles > 0);
    assert.ok(fatigue.maxStressRange > 10);
    assert.ok(fatigue.annualDamage > 0);
    assert.equal(fatigue.snCurve.m, 3.0);
  });

  it("synthesizes valid formal SysML v2 textual architecture", () => {
    const sysml = simaToSysml2(model);
    assert.match(sysml, /package SIMO_RIFLEX_Model/);
    assert.match(sysml, /port def FairleadMechanicalPort/);
    assert.match(sysml, /port def SeabedAnchorPort/);
    assert.match(sysml, /requirement def DnvMooringIntactRequirement/);
    assert.match(sysml, /requirement def PositiveMetacentricHeightRequirement/);
    assert.match(sysml, /part def FloaterVessel/);
    assert.match(sysml, /part def MooringLineDefinition/);
    assert.match(sysml, /part installation/);
    assert.match(sysml, /assert constraint MetacentricStability/);
  });

  it("synthesizes rational state-space realization for Cummins retardation kernel", () => {
    const realization2 = createRationalRealization(1, 2);
    assert.equal(realization2.dof, 1);
    assert.equal(realization2.order, 2);
    assert.equal(realization2.A.length, 2);
    assert.equal(realization2.B.length, 2);

    const realization4 = createRationalRealization(3, 4);
    assert.equal(realization4.dof, 3);
    assert.equal(realization4.order, 4);
    assert.equal(realization4.A.length, 4);
  });

  it("simulates 6-DOF time-domain floater Cummins dynamics", () => {
    const vessel = model.vessels[0];
    assert.ok(vessel);

    const sim = simulateCumminsDynamics(vessel, model, {
      durationSeconds: 10.0,
      timeStepSeconds: 0.1,
    });

    assert.equal(sim.time.length, 100);
    assert.equal(sim.positions.length, 6);
    assert.equal(sim.velocities.length, 6);
    assert.ok(sim.maxExcursion.surge >= 0);
    assert.ok(sim.maxExcursion.heave >= 0);
    assert.ok(sim.rmsMotion.surge >= 0);
  });

  it("lowers SIMA marine system directly into DAEBuilder linear memory arena", () => {
    const dae = lowerSimaToDae(model);

    // Verify presence of variables and equations in arena
    assert.ok(dae.varCount > 20, `Expected >20 variables, got ${dae.varCount}`);
    assert.ok(dae.eqCount >= 15, `Expected >=15 equations, got ${dae.eqCount}`);

    // Check specific variables exist
    const varNames = new Set<string>();
    for (let i = 0; i < dae.varCount; i++) {
      varNames.add(dae.getVarName(i));
    }

    assert.ok(varNames.has("surge"), "Variable 'surge' should exist");
    assert.ok(varNames.has("v_surge"), "Variable 'v_surge' should exist");
    assert.ok(varNames.has("rad_surge_1"), "Variable 'rad_surge_1' should exist");
    assert.ok(varNames.has("line_1_tension"), "Variable 'line_1_tension' should exist");
  });
});
