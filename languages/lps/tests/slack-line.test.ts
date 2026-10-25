// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { LiquidSurgeSolver } from "../src/solver/transient/liquid-surge-dae.js";
import { SlackLineSolver } from "../src/solver/transient/slack-line-solver.js";
import type { LpsModel, LpsPipe } from "../src/types.js";

test("SlackLineSolver: Solves open-channel Manning gravity flow filling depth and void fraction", () => {
  const diameter = 0.508; // 20-inch pipeline (m)
  const flowM3s = 0.35; // 350 L/s liquid throughput
  const slope = 0.035; // 3.5% downward mountain gradient
  const manningN = 0.012; // Steel pipe

  const result = SlackLineSolver.solveOpenChannelDepth(diameter, flowM3s, slope, manningN);

  assert.ok(result.fillingDepthMeters > 0.05, "Depth should be positive");
  assert.ok(result.fillingDepthMeters < diameter, "Pipe should not be completely submerged");
  assert.ok(result.fillingFraction > 0.1 && result.fillingFraction < 0.9, "Filling fraction reasonable");
  assert.ok(result.voidFraction > 0.1 && result.voidFraction < 0.9, "Void fraction should exist in slack condition");
  assert.ok(result.velocityMS > 1.0 && result.velocityMS < 8.0, "Open-channel gravity velocity reasonable");
});

test("SlackLineSolver: Detects pressurized vs slack open-channel transition across mountain descent", () => {
  const downhillPipe: LpsPipe = {
    name: "TransAndean_Downhill_Segment",
    fromNode: "Pass_Summit",
    toNode: "Valley_Terminal",
    length: 25000, // 25 km
    diameter: 0.61, // 24-inch pipe
    roughness: 4.5e-5,
    maop: 100e5,
    wallThickness: 0.0127,
  };

  const crudeProps = {
    densityKgM3: 860.0,
    vaporPressurePa: 45e3, // 45 kPa (0.45 bar)
    bulkModulusPa: 1.45e9,
  };

  // Case A: High pressure (Pressurized flow)
  const pressurizedResult = SlackLineSolver.evaluateSegment(
    downhillPipe,
    2800, // Summit elevation (m)
    600, // Valley elevation (m)
    40e5, // 40 bar pressure
    0.5, // 500 L/s
    crudeProps,
  );
  assert.equal(pressurizedResult.isSlackFlow, false);
  assert.equal(pressurizedResult.voidFraction, 0.0);
  assert.equal(pressurizedResult.voidVolumeM3, 0.0);
  assert.equal(pressurizedResult.slackCollapseSurgePa, 0.0);

  // Case B: Cavitated / Slack pressure (line pressure drops to vapor pressure)
  const slackResult = SlackLineSolver.evaluateSegment(
    downhillPipe,
    2800,
    600,
    40e3, // 40 kPa <= vapor pressure 45 kPa
    0.5,
    crudeProps,
  );
  assert.equal(slackResult.isSlackFlow, true);
  assert.ok(slackResult.voidFraction > 0.1, "Slack line must have vapor void fraction");
  assert.ok(slackResult.voidVolumeM3 > 50.0, "Void volume across 25km pipe must be significant");
  assert.ok(slackResult.slackCollapseSurgePa > 1e5, "Collapse surge pressure should be computed");
  assert.ok(slackResult.gravityVelocityMS > slackResult.pressurizedVelocityMS, "Gravity stream accelerates");
});

test("LiquidSurgeSolver: Evaluates column separation and slack line segment upon rapid ESD valve closure", () => {
  const model: LpsModel = {
    id: "slack-transient-test",
    title: "Downhill Surge Slack Study",
    type: "TLNET",
    nodes: [
      { name: "Ridge_Station", type: "SUPPLY", elevation: 2200, pressure: 25e5 },
      { name: "Valley_Station", type: "DELIVERY", elevation: 400, pressure: 5e5 },
    ],
    pipes: [
      {
        name: "Mountain_Penstock",
        fromNode: "Ridge_Station",
        toNode: "Valley_Station",
        length: 12000,
        diameter: 0.508,
        roughness: 4.5e-5,
        maop: 90e5,
        wallThickness: 0.0127,
      },
    ],
    compressors: [],
    pumps: [],
    regulators: [],
    valves: [
      {
        name: "ESD_Valve_1",
        fromNode: "Ridge_Station",
        toNode: "Valley_Station",
        opening: 1.0,
        closingTimeSeconds: 5.0,
      },
    ],
    batches: {
      products: [
        {
          id: "diesel",
          name: "Ultra-Low Sulfur Diesel",
          densityAtRef: 830.0,
          viscosityAtRef: 0.003,
          bulkModulus: 1.35e9,
          vaporPressure: 35e3,
        },
      ],
      injections: [],
    },
    simulationControls: {
      startTime: 0,
      endTime: 100,
      timeStep: 0.1,
      steadyStateFirst: true,
      equationOfState: "IDEAL",
    },
  };

  const pipe = model.pipes[0]!;
  const valve = model.valves[0]!;
  const surge = LiquidSurgeSolver.evaluateValveClosureSurge(model, pipe, valve, 0.4);

  assert.ok(surge.peakSurgePressure > 30e5, "Surge pressure should exceed base pressure");
  assert.ok(surge.waveSpeed > 900 && surge.waveSpeed < 1400, "Liquid wave speed realistic");
  if (surge.cavitationOccurred) {
    assert.ok(surge.slackSegment != null, "Slack segment should be populated when cavitation occurs");
    assert.equal(surge.slackSegment.isSlackFlow, true);
  }
});
