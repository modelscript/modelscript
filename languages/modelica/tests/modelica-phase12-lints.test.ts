// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 12 CST helper memoization and fast-path optimizations:
 * - `findTargetElementInClass` memoization across multiple `class_modification`s (`M4005`)
 * - `getFlowVariableCount` memoization & cycle safety across `connect` equations (`M5004` / `M4055`)
 * - `constantHasNoValue` (`M4042`) fast-path on initialized vs uninitialized constants
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { facade } = await createWasmParser(modelicaWasm);

function getCstDiagnostics(source: string): { code: number; severity: number; message: string }[] {
  const root = facade.parseIncremental(source, 0, 0, source.length, "file:///phase12_cst.mo");
  assert.ok(root > 0, "Expected facade.parseIncremental root");
  return facade.getDiagnostics(root, 0, 0, source);
}

describe("Modelica Phase 12 CST helper memoization and fast paths", () => {
  it("preserves M4005 protected modification accuracy with memoized findTargetElementInClass", () => {
    const diags = getCstDiagnostics(`
model BaseBlock
  public Real gain = 1.0;
protected
  Real secret = 2.0;
end BaseBlock;

model Sys
  BaseBlock b1(gain = 3.0, secret = 4.0);
  BaseBlock b2(gain = 5.0);
end Sys;
`);
    const m4005 = diags.filter((d) => d.code === 4005);
    assert.equal(m4005.length, 1, `Expected exactly 1 M4005 on secret modification: ${JSON.stringify(m4005)}`);
    assert.ok(m4005[0]!.message.includes("secret"));
  });

  it("memoizes getFlowVariableCount across multiple connect equations and preserves mismatch detection (M5004)", () => {
    const diags = getCstDiagnostics(`
connector Pin1
  Real v;
  flow Real i;
end Pin1;

connector Pin2
  Real v;
  Real u;
  flow Real i;
  flow Real j;
end Pin2;

model Net
  Pin1 p1;
  Pin1 p2;
  Pin2 q1;
equation
  connect(p1, p2);
  connect(p1, q1);
end Net;
`);
    const m5004 = diags.filter((d) => d.code === 5004);
    assert.equal(m5004.length, 1, `Expected 1 M5004 for Pin1 vs Pin2 flow mismatch: ${JSON.stringify(m5004)}`);
  });

  it("flags uninitialized constants while fast-pathing initialized constants in packages (M4042)", () => {
    const diags = getCstDiagnostics(`
package ConstantsPkg
  constant Real c_ok = 3.14159;
  constant Real c_missing;
  parameter Real p_ok = 1.0;
end ConstantsPkg;
`);
    const m4042 = diags.filter((d) => d.code === 4042);
    assert.equal(m4042.length, 1, `Expected exactly 1 M4042 for c_missing: ${JSON.stringify(m4042)}`);
    assert.ok(m4042[0]!.message.includes("c_missing"));
  });
});
