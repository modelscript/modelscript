// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  amplToModelica,
  instantiateAmpl,
  lowerAmplToDae,
  parseAmplModel,
  readSolResult,
  writeNlProblem,
} from "../src/index.js";

test("AMPL NL Writer — serializes flat problem into valid ASL .nl format", () => {
  const modelSrc = `
    var x1 >= 0, <= 10;
    var x2 >= 0, <= 10;

    maximize Profit:
      2 * x1 + 3 * x2;

    s.t. Capacity:
      x1 + 2 * x2 <= 8;
  `;

  const model = parseAmplModel(modelSrc);
  const problem = instantiateAmpl(model);
  const nlText = writeNlProblem(problem);

  // Check ASL header
  assert.ok(nlText.startsWith("g3 0 1 0"), "Should start with ASCII ASL header");
  assert.ok(nlText.includes("O0 1"), "Should include maximize objective header O0 1");
  assert.ok(nlText.includes("G0 2"), "Should include gradient with 2 entries");
  assert.ok(nlText.includes("J0 2"), "Should include constraint Jacobian with 2 entries");
  assert.ok(nlText.includes("r\n"), "Should include constraint bounds section");
  assert.ok(nlText.includes("b\n"), "Should include variable bounds section");
});

test("AMPL SOL Reader — parses .sol solution file format", () => {
  const solText = `
    optimal solution; objective 22
    Options
    3
    2
  `;

  const res = readSolResult(solText);
  assert.ok(res.message.includes("optimal solution"));
  assert.strictEqual(res.primalValues.length, 2);
  assert.strictEqual(res.primalValues[0], 3);
  assert.strictEqual(res.primalValues[1], 2);
});

test("AMPL DAE Lowering — lowers decision variables and equations to DAE arena", () => {
  const modelSrc = `
    var x >= 0;
    var y >= 0;

    minimize Cost:
      x + 2 * y;

    s.t. EqualBalance:
      x + y = 10;

    s.t. UpperBound:
      2 * x + y <= 15;
  `;

  const model = parseAmplModel(modelSrc);
  const problem = instantiateAmpl(model);
  const dae = lowerAmplToDae(problem);

  // x, y, _obj_Cost, and _slack_UpperBound
  assert.ok(dae.variables().length >= 3);
  assert.ok(dae.equations().length >= 2);
});

test("AMPL Modelica Projection — generates valid acausal Modelica optimization model", () => {
  const modelSrc = `
    var x1 >= 0, <= 10;
    var x2 >= 0, <= 10;

    maximize Profit:
      2 * x1 + 3 * x2;

    s.t. Capacity:
      x1 + 2 * x2 <= 8;
  `;

  const model = parseAmplModel(modelSrc);
  const problem = instantiateAmpl(model);
  const moText = amplToModelica(problem, { modelName: "ProductionModel" });

  assert.ok(moText.includes("model ProductionModel"));
  assert.ok(moText.includes("Real x1(min = 0, max = 10, start = 0)"));
  assert.ok(moText.includes("Real x2(min = 0, max = 10, start = 0)"));
  assert.ok(moText.includes("Real _obj_Profit"));
  assert.ok(moText.includes("equation"));
  assert.ok(moText.includes("_obj_Profit = 2 * x1 + 3 * x2;"));
  assert.ok(moText.includes("x1 + 2 * x2 <= 8;"));
  assert.ok(moText.includes("end ProductionModel;"));
});
