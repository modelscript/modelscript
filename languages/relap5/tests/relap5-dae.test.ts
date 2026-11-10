// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerRelap5ToDae, parseRelap5, relap5ToModelica } from "../src/index.js";

const VALID_PWR_DECK = `100 PWR Primary Loop Model
101 new transnt
1000000 CoreChannel pipe
1000101 4.5 3.8 17.1
1000501 1.55e7 580.0 0.0
1100000 UpperPlenum branch
1100101 8.0 2.5 20.0
1100501 1.54e7 595.0 0.0
1050000 CoreToUpper snglj
1050101 100 110 4.5
1050102 0.15 0.25
1050201 4.5 0.0
6000000 point 2.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
6000003 0.1110 0.001274
6000004 0.3010 0.002568
6000005 1.1400 0.000748
6000006 3.0100 0.000271
. end`;

test("RELAP5 DAE Lowering: compiles two-phase volumes and kinetics into square DAE arena", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const dae = lowerRelap5ToDae(deck);

  assert.ok(dae.variables().length >= 18);
  assert.equal(dae.variables().length, dae.equations().length, "Must be structurally square DAE");
  assert.notEqual(dae.lookupVariable("P_100"), -1);
  assert.notEqual(dae.lookupVariable("reactor_power"), -1);
});

test("RELAP5 Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const mo = relap5ToModelica(deck, "PwrPrimaryLoop");

  assert.ok(mo.includes("model PwrPrimaryLoop"));
  assert.ok(mo.includes("Real P_100(start = 15500000.0)"));
  assert.ok(mo.includes("end PwrPrimaryLoop;"));
});
