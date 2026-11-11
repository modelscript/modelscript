// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { amplLanguage, getAmplData, getAmplModel, parseAmplData, parseAmplModel } from "../src/index.js";

test("AMPL Parser — parses standard model declarations (.mod)", () => {
  const modelSrc = `
    # Transportation Problem
    set ORIG;
    set DEST;

    param supply {ORIG} >= 0;
    param demand {DEST} >= 0;
    param cost {ORIG, DEST} >= 0;

    var Trans {ORIG, DEST} >= 0;

    minimize Total_Cost:
      sum {i in ORIG, j in DEST} cost[i,j] * Trans[i,j];

    subject to Supply {i in ORIG}:
      sum {j in DEST} Trans[i,j] = supply[i];

    subject to Demand {j in DEST}:
      sum {i in ORIG} Trans[i,j] = demand[j];
  `;

  const model = parseAmplModel(modelSrc);

  assert.strictEqual(model.sets.size, 2);
  assert.ok(model.sets.has("ORIG"));
  assert.ok(model.sets.has("DEST"));

  assert.strictEqual(model.params.size, 3);
  assert.ok(model.params.has("supply"));
  assert.ok(model.params.has("demand"));
  assert.ok(model.params.has("cost"));

  assert.strictEqual(model.vars.size, 1);
  const transVar = model.vars.get("Trans")!;
  assert.strictEqual(transVar.name, "Trans");
  assert.strictEqual(transVar.type, "continuous");
  assert.strictEqual(transVar.indexing?.iterators.length, 2);

  assert.strictEqual(model.objectives.size, 1);
  const obj = model.objectives.get("Total_Cost")!;
  assert.strictEqual(obj.direction, "minimize");
  assert.strictEqual(obj.expr.kind, "reduction");

  assert.strictEqual(model.constraints.size, 2);
  assert.ok(model.constraints.has("Supply"));
  assert.ok(model.constraints.has("Demand"));
});

test("AMPL Parser — parses 2D matrix and tabular data (.dat)", () => {
  const dataSrc = `
    set ORIG := GARY CLEV PITT ;
    set DEST := FRA  DET  LAN ;

    param supply :=
      GARY 1400
      CLEV 2600
      PITT 2900 ;

    param demand :=
      FRA   900
      DET  1200
      LAN   600 ;

    param cost :
              FRA  DET  LAN :=
      GARY     39   14   11
      CLEV     27    9   12
      PITT     24   14   17 ;
  `;

  const data = parseAmplData(dataSrc);

  assert.strictEqual(data.sets.size, 2);
  assert.deepStrictEqual(data.sets.get("ORIG"), ["GARY", "CLEV", "PITT"]);
  assert.deepStrictEqual(data.sets.get("DEST"), ["FRA", "DET", "LAN"]);

  assert.strictEqual(data.params.size, 3);
  const supplyMap = data.params.get("supply")!;
  assert.strictEqual(supplyMap.get("GARY"), 1400);
  assert.strictEqual(supplyMap.get("CLEV"), 2600);
  assert.strictEqual(supplyMap.get("PITT"), 2900);

  const costMap = data.params.get("cost")!;
  assert.strictEqual(costMap.get("GARY,FRA"), 39);
  assert.strictEqual(costMap.get("GARY,DET"), 14);
  assert.strictEqual(costMap.get("CLEV,LAN"), 12);
  assert.strictEqual(costMap.get("PITT,FRA"), 24);
});

test("AMPL Parser — parses nonlinear functions and double-sided constraints", () => {
  const nlpSrc = `
    var x >= -10, <= 10;
    var y >= -10, <= 10;

    minimize Rosenbrock:
      (1 - x)^2 + 100 * (y - x^2)^2;

    s.t. CircleRange:
      0 <= x^2 + y^2 <= 25;
  `;

  const model = parseAmplModel(nlpSrc);
  assert.strictEqual(model.vars.size, 2);
  assert.strictEqual(model.objectives.size, 1);
  assert.strictEqual(model.constraints.size, 1);
  const c = model.constraints.get("CircleRange")!;
  assert.ok(c.rhsUpper !== undefined);
});

test("AMPL UnifiedWorkspace — indexes .mod and .dat documents", () => {
  const ws = new UnifiedWorkspace(amplLanguage);
  ws.setDocument(
    "file:///project/transp.mod",
    `
    set ORIG;
    param supply {ORIG} >= 0;
    var Trans {ORIG} >= 0;
    minimize Total_Cost: sum {i in ORIG} Trans[i];
    subject to Supply {i in ORIG}: Trans[i] = supply[i];
  `,
  );
  ws.setDocument(
    "file:///project/transp.dat",
    `
    set ORIG := GARY CLEV ;
    param supply := GARY 1400 CLEV 2600 ;
  `,
  );

  const idx = ws.getIndex();
  assert.ok(idx.byName.has("AMPL_Model"));
  assert.ok(idx.byName.has("AMPL_Data"));
  assert.ok(idx.byName.has("Trans"));
  assert.ok(idx.byName.has("Total_Cost"));
  assert.ok(getAmplModel(ws, "file:///project/transp.mod")?.vars.has("Trans"));
  assert.deepStrictEqual(getAmplData(ws, "file:///project/transp.dat")?.sets.get("ORIG"), ["GARY", "CLEV"]);
});
