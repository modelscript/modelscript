// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseRelap5, solvePointKinetics } from "../src/index.js";

const VALID_PWR_DECK = `100 PWR Kinetics Model
101 new transnt
201 10.0 1.0e-5 0.01 100 1000
1000000 CoreChannel pipe
1000101 4.5 3.8 17.1
1000501 1.55e7 580.0 0.0
6000000 point 2.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
6000003 0.1110 0.001274
6000004 0.3010 0.002568
6000005 1.1400 0.000748
6000006 3.0100 0.000271
6000010 -2.5e-5 -1.0e-4
. end`;

test("RELAP5 Solver: solves 6-group delayed neutron point kinetics during SCRAM", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const res = solvePointKinetics(deck, { duration: 5.0, tripScramTime: 1.0, stepSize: 0.001 });

  assert.equal(res.initialPowerMW, 3000.0);
  assert.ok(res.stepsCount > 50);
  assert.ok(res.finalPowerMW < 3000.0 * 0.2);
});

test("RELAP5 Solver: evaluates Doppler fuel temperature negative reactivity feedback", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const res = solvePointKinetics(deck, { duration: 2.0, externalReactivity: 0.001, stepSize: 0.001 });

  assert.ok(res.peakPowerMW > 3000.0);
  assert.ok(res.peakFuelTempK > 850.0);
});
