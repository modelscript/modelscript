// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { instantiateAmpl, parseAmplData, parseAmplModel, SetEvaluator } from "../src/index.js";

test("AMPL Instantiator — evaluates set algebra (cross, union, inter, diff)", () => {
  const model = parseAmplModel(`
    set A := { 1, 2, 3 };
    set B := { 2, 3, 4 };
    set C := A union B;
    set D := A inter B;
    set E := A diff B;
  `);

  const setEval = new SetEvaluator(model, { sets: new Map(), params: new Map() });

  assert.deepStrictEqual(setEval.getSet("A"), [1, 2, 3]);
  assert.deepStrictEqual(setEval.getSet("B"), [2, 3, 4]);
  assert.deepStrictEqual(setEval.getSet("C"), [1, 2, 3, 4]);
  assert.deepStrictEqual(setEval.getSet("D"), [2, 3]);
  assert.deepStrictEqual(setEval.getSet("E"), [1]);
});

test("AMPL Instantiator — unrolls indexed variables and equations", () => {
  const modSrc = `
    set PLANTS;
    set MARKETS;
    param dist{PLANTS, MARKETS};
    var ship{PLANTS, MARKETS} >= 0;

    minimize Cost:
      sum {p in PLANTS, m in MARKETS} dist[p, m] * ship[p, m];

    s.t. SupplyCap {p in PLANTS}:
      sum {m in MARKETS} ship[p, m] <= 100;
  `;

  const datSrc = `
    set PLANTS := P1 P2;
    set MARKETS := M1 M2 M3;
    param dist : M1 M2 M3 :=
      P1         10 20 30
      P2         15 25 35;
  `;

  const model = parseAmplModel(modSrc);
  const data = parseAmplData(datSrc);
  const instantiated = instantiateAmpl(model, data);

  // 2 plants * 3 markets = 6 variables
  assert.strictEqual(instantiated.variables.length, 6);
  assert.ok(instantiated.varNameMap.has("ship[P1,M1]"));
  assert.ok(instantiated.varNameMap.has("ship[P2,M3]"));

  // 2 supply constraints (one per plant)
  assert.strictEqual(instantiated.constraints.length, 2);
  assert.strictEqual(instantiated.constraints[0]!.name, "SupplyCap[P1]");
  assert.strictEqual(instantiated.constraints[1]!.name, "SupplyCap[P2]");

  // Objective has 6 linear terms
  assert.strictEqual(instantiated.objective.expr.linearTerms.length, 6);
  assert.strictEqual(instantiated.problemClass, "LP");
});
