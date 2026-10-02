// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ModelScriptCompiler } from "../src/index.js";
import { extractModelicaModel } from "../src/polyglot/resolver.js";

test("ModelScript polyglot query over a Modelica model using FLWOR", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const modelicaSource = `
model ElectricalCircuit
  parameter Real R1 = 100.0;
  parameter Real R2 = 220.0;
  parameter Real R3 = 47.0;
  parameter Real C1 = 0.001;
  parameter Real L1 = 0.05;
equation
  // equations...
end ElectricalCircuit;
`;

  // 1. In ModelScript polyglot runtime, importing "./Circuit.mo" resolves the Modelica model:
  const circuit = extractModelicaModel(null, modelicaSource);
  assert.equal(circuit.components.length, 5);

  // 2. Query the imported Modelica model using ModelScript FLWOR:
  const modelScriptCode = `
import { ElectricalCircuit } from "./models/ElectricalCircuit.mo";

let largeResistors = 
  for comp in circuit.components
  where comp.name.startsWith("R") && comp.value > 50.0
  order by comp.value descending
  return {
    component: comp.name,
    resistance: comp.value,
    type: comp.type
  };

return largeResistors;
`;

  const results = compiler.executeJs(modelScriptCode, { circuit }) as any[];

  assert.ok(Array.isArray(results), "Results should be an array");
  assert.equal(results.length, 2, "Should match R1 (100) and R2 (220)");
  assert.deepEqual(results, [
    { component: "R2", resistance: 220.0, type: "Real" },
    { component: "R1", resistance: 100.0, type: "Real" },
  ]);
});
