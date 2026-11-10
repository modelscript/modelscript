// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  type DistanceZoneSetting,
  evaluateDistanceRelayTrajectory,
  evaluatePointAcrossZones,
  isInsideZone,
} from "../src/solvers/protection/distance-protection.js";

const standardMhoZones: DistanceZoneSetting[] = [
  {
    zoneNumber: 1,
    characteristic: "mho",
    reachOhm: 10.0, // 80% of 12.5 Ohm line
    lineAngleDeg: 75.0,
    delaySec: 0.0, // Instantaneous
    directional: "forward",
  },
  {
    zoneNumber: 2,
    characteristic: "mho",
    reachOhm: 15.0, // 120% of 12.5 Ohm line
    lineAngleDeg: 75.0,
    delaySec: 0.3, // 300 ms delay
    directional: "forward",
  },
  {
    zoneNumber: 3,
    characteristic: "mho",
    reachOhm: 25.0, // 200% remote backup
    lineAngleDeg: 75.0,
    delaySec: 0.8, // 800 ms delay
    directional: "forward",
  },
];

test("isInsideZone: correctly evaluates Mho circle reach", () => {
  const z1 = standardMhoZones[0]!;

  // Point on line at 5 Ohm (inside Zone 1: reach = 10 Ohm)
  const rInside = 5.0 * Math.cos((75 * Math.PI) / 180);
  const xInside = 5.0 * Math.sin((75 * Math.PI) / 180);
  assert.strictEqual(isInsideZone(z1, rInside, xInside), true);

  // Point on line at 12 Ohm (outside Zone 1, inside Zone 2)
  const rOutside = 12.0 * Math.cos((75 * Math.PI) / 180);
  const xOutside = 12.0 * Math.sin((75 * Math.PI) / 180);
  assert.strictEqual(isInsideZone(z1, rOutside, xOutside), false);

  const z2 = standardMhoZones[1]!;
  assert.strictEqual(isInsideZone(z2, rOutside, xOutside), true);

  // Reverse fault (negative X) should not trip forward directional Mho
  assert.strictEqual(isInsideZone(z1, -2.0, -5.0), false);
});

test("evaluatePointAcrossZones: evaluates multi-zone status", () => {
  // Fault at 6 Ohm
  const r = 6.0 * Math.cos((75 * Math.PI) / 180);
  const x = 6.0 * Math.sin((75 * Math.PI) / 180);
  const evals = evaluatePointAcrossZones(standardMhoZones, r, x);

  assert.strictEqual(evals.length, 3);
  assert.strictEqual(evals[0]!.inside, true); // Inside Zone 1
  assert.strictEqual(evals[1]!.inside, true); // Inside Zone 2
  assert.strictEqual(evals[2]!.inside, true); // Inside Zone 3
});

test("evaluateDistanceRelayTrajectory: triggers instantaneous Zone 1 trip", () => {
  const trajectory = [
    { tSec: 0.0, rOhm: 50.0, xOhm: 30.0 }, // Normal pre-fault load
    { tSec: 0.02, rOhm: 50.0, xOhm: 30.0 },
    { tSec: 0.04, rOhm: 1.2, xOhm: 4.5 }, // Close-in fault (inside Zone 1)
    { tSec: 0.06, rOhm: 1.2, xOhm: 4.5 },
  ];

  const result = evaluateDistanceRelayTrajectory(standardMhoZones, trajectory);
  assert.strictEqual(result.tripped, true);
  assert.strictEqual(result.tripZone, 1);
  assert.strictEqual(result.tripTimeSec, 0.04);
  assert.ok(result.clearingTimeSec && result.clearingTimeSec > 0.04);
});

test("evaluateDistanceRelayTrajectory: triggers delayed Zone 2 trip for remote fault", () => {
  // Fault inside Zone 2 (reach = 15 Ohm, delay = 0.3s)
  const trajectory = [
    { tSec: 0.0, rOhm: 50.0, xOhm: 30.0 },
    { tSec: 0.05, rOhm: 3.0, xOhm: 11.5 }, // In Zone 2, outside Zone 1
    { tSec: 0.15, rOhm: 3.0, xOhm: 11.5 },
    { tSec: 0.25, rOhm: 3.0, xOhm: 11.5 },
    { tSec: 0.36, rOhm: 3.0, xOhm: 11.5 }, // Dwell time reaches 0.3s -> Zone 2 trip!
  ];

  const result = evaluateDistanceRelayTrajectory(standardMhoZones, trajectory);
  assert.strictEqual(result.tripped, true);
  assert.strictEqual(result.tripZone, 2);
  assert.ok(result.tripTimeSec !== undefined && result.tripTimeSec >= 0.35);
});
