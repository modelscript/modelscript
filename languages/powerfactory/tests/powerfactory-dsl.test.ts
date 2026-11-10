// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseDsl } from "../src/dsl/dsl-parser.js";
import { transpileDslToModelica } from "../src/dsl/dsl-transpiler.js";

const sampleDslCode = `
! Automatic Voltage Regulator (AVR) ST1 Model in DIgSILENT DSL
model AVR_ST1
  input: v_meas, v_ref
  output: efd
  parameter: Tr = 0.02, Ka = 200.0, Ta = 0.05, Vrmin = -5.0, Vrmax = 5.0
  internal: v_err, vr

  s:v_err = (v_ref - v_meas - v_err) / Tr
  s:vr = (Ka * v_err - vr) / Ta
  efd = lim(vr, Vrmin, Vrmax)
end
`;

test("parseDsl: parses inputs, outputs, parameters, internals, and equations", () => {
  const block = parseDsl(sampleDslCode);

  assert.strictEqual(block.name, "AVR_ST1");
  assert.strictEqual(block.type, "model");

  assert.deepStrictEqual(block.inputs, ["v_meas", "v_ref"]);
  assert.deepStrictEqual(block.outputs, ["efd"]);
  assert.strictEqual(block.parameters.get("Tr"), 0.02);
  assert.strictEqual(block.parameters.get("Ka"), 200.0);
  assert.strictEqual(block.parameters.get("Ta"), 0.05);

  assert.strictEqual(block.equations.length, 3);
  assert.strictEqual(block.equations[0]!.kind, "differential");
  assert.strictEqual(block.equations[0]!.lhs, "v_err");

  assert.strictEqual(block.equations[2]!.kind, "macro");
  assert.strictEqual(block.equations[2]!.macroType, "LIM");
});

test("transpileDslToModelica: produces valid Modelica block with der() and parameters", () => {
  const block = parseDsl(sampleDslCode);
  const moCode = transpileDslToModelica(block);

  assert.ok(moCode.includes("block AVR_ST1"));
  assert.ok(moCode.includes("Modelica.Blocks.Interfaces.RealInput v_meas;"));
  assert.ok(moCode.includes("Modelica.Blocks.Interfaces.RealOutput efd;"));
  assert.ok(moCode.includes("parameter Real Tr = 0.02;"));
  assert.ok(moCode.includes("der(v_err) = (v_ref - v_meas - v_err) / Tr;"));
  assert.ok(moCode.includes("der(vr) = (Ka * v_err - vr) / Ta;"));
  assert.ok(moCode.includes("smooth(0, if (vr) > (Vrmax)"));
});
