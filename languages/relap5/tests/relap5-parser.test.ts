// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseRelap5, serializeRelap5 } from "../src/index.js";

const VALID_PWR_DECK = `* ====================================================================
* PWR Primary Loop Thermal-Hydraulics & Point Kinetics Model
* ====================================================================
100 PWR 4-Loop Reactor Primary System
101 new transnt
* Time step control: endTime, minDt, maxDt, minorFreq, majorFreq
201 10.0 1.0e-5 0.01 100 1000
* Trips
2060001 p-100010000 gt 1.60e7 l
2060002 time gt 5.0 l
2060003 1 or 2 l
* Hydrodynamic Volumes (300-series)
* 1. Reactor Core Channel
1000000 CoreChannel pipe
1000101 4.5 3.8 17.1
1000201 0.0 3.8
1000301 1.5e-5 0.012
1000501 1.55e7 580.0 0.0
* 2. Upper Plenum
1100000 UpperPlenum branch
1100101 8.0 2.5 20.0
1100201 0.0 2.5
1100301 2.0e-5 0.50
1100501 1.54e7 595.0 0.0
* Hydrodynamic Junctions
1050000 CoreToUpper snglj
1050101 100 110 4.5
1050102 0.15 0.25
1050201 4.5 0.0
* Heat Structures (Fuel Cladding)
10100000 5 1
10100101 16.5 2.1e6
10100201 100 100
* Reactor Point Kinetics (600-series)
6000000 point 2.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
6000003 0.1110 0.001274
6000004 0.3010 0.002568
6000005 1.1400 0.000748
6000006 3.0100 0.000271
6000010 -2.5e-5 -1.0e-4
. end`;

test("RELAP5 Parser: parses PWR primary loop deck into structured AST", () => {
  const deck = parseRelap5(VALID_PWR_DECK, "pwr.i");
  assert.equal(deck.title, "PWR 4-Loop Reactor Primary System");
  assert.equal(deck.executionType, "new");
  assert.equal(deck.problemType, "transnt");
  assert.equal(deck.volumes.size, 2);
  assert.equal(deck.junctions.size, 1);
  assert.equal(deck.heatStructures.size, 1);
  assert.ok(deck.kinetics);
  assert.equal(deck.kinetics.initialPower, 3000.0e6);
  assert.equal(deck.kinetics.delayedGroups.length, 6);
});

test("RELAP5 Serializer: round-trips parsed AST back to valid card deck", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const text = serializeRelap5(deck);
  assert.ok(text.includes("100 PWR 4-Loop Reactor Primary System"));
  assert.ok(text.includes("1000000 CoreChannel pipe"));
  assert.ok(text.includes("6000000 point"));
  assert.ok(text.includes(". end"));

  const reloaded = parseRelap5(text);
  assert.equal(reloaded.volumes.size, 2);
  assert.equal(reloaded.junctions.size, 1);
});
