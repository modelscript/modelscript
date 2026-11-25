// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Regression tests for Phase 1 Modelica linter trust fixes:
 * - exact token-based `isClassKind` (no name/nested-element prefix pollution)
 * - value-position literal checking in M3001/M3002
 * - M4027/M4043 firing in multi-class files
 * - nested-class declaration isolation in M4005/M4026
 * - unique codes & messages for M2008/M4020 and M3010/M3022
 * - M6050 transition priority (arg 7 / `priority=`, ignoring `immediate=`)
 * - extends-cycle guard in `getFlowVariableCount`
 * - M4041/M4003/M4014/M4030/M4076 false-positive & Real-bounds fixes, no M4017/M4065 double report
 * - order-independent & incrementally invalidated `cyclicDimensionInfo` (M4035)
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

function cstDiags(source: string): Array<{ code: number; message: string; severity: string }> {
  const tree = facade.parse(source);
  return facade.getDiagnostics(tree);
}

describe("Modelica linter trust fixes", () => {
  it("does not misclassify models named function*/record* or containing nested functions (isClassKind)", () => {
    const diags = cstDiags(`
model functionTest
  Real x;
  function helper
    input Real u;
    output Real y;
  algorithm
    y := u;
  end helper;
equation
  x = helper(1.0);
end functionTest;
model recordData
  Real z;
equation
  z = 1.0;
end recordData;
`);
    const bad = diags.filter((d) => d.code === 4007 || d.code === 4017 || d.code === 4032);
    assert.deepEqual(bad, []);
  });

  it("ignores literals inside if-conditions, relations, and calls in M3001/M3002", () => {
    const valid = cstDiags(`
model CondBindings
  parameter String s = "a";
  parameter Real r = 0.7;
  Real x = if s == "a" then 1 else 2;
  Integer i = if r > 0.5 then 1 else 0;
  Real y(start = if s == "a" then 1 else 0);
end CondBindings;
`);
    assert.deepEqual(
      valid.filter((d) => d.code === 3001 || d.code === 3002),
      [],
    );

    const invalid = cstDiags(`
model BadBindings
  Real x = "oops";
  Integer j(start = 1.5) = 2;
end BadBindings;
`);
    const codes = invalid.map((d) => d.code);
    assert.ok(codes.includes(3001), `Expected M3001 in ${JSON.stringify(invalid)}`);
    assert.ok(codes.includes(3002), `Expected M3002 in ${JSON.stringify(invalid)}`);
  });

  it("fires M4027 and M4043 even when the file defines multiple classes", () => {
    const diags = cstDiags(`
model Helper
  Real h;
end Helper;
model Target
  Real x;
  parameter Real p = x;
  constant Real c = x;
end Target;
`);
    assert.ok(
      diags.some((d) => d.code === 4027),
      `Expected M4027 in multi-class file, got ${JSON.stringify(diags)}`,
    );
    assert.ok(
      diags.some((d) => d.code === 4043),
      `Expected M4043 in multi-class file, got ${JSON.stringify(diags)}`,
    );
  });

  it("does not treat a nested class declaration as an outer protected/final element (M4005/M4026)", () => {
    const diags = cstDiags(`
model B2
protected
  model Inner3
    Real x;
  end Inner3;
  final model InnerFinal
    Real y;
  end InnerFinal;
public
  Real x;
  Real y;
end B2;
model U2
  B2 b(x = 1, y = 2);
end U2;
`);
    assert.deepEqual(
      diags.filter((d) => d.code === 4005 || d.code === 4026),
      [],
    );
  });

  it("emits distinct codes/messages for time in function (M4020) vs component named time (M2008)", () => {
    const fnDiags = cstDiags(`
function f
  input Real u;
  output Real y;
algorithm
  y := u + time;
end f;
`);
    const m4020 = fnDiags.find((d) => d.code === 4020);
    assert.ok(m4020 && m4020.message.includes("not allowed in a function"), JSON.stringify(fnDiags));

    const declDiags = cstDiags(`
model M
  Real time;
end M;
`);
    const m2008 = declDiags.find((d) => d.code === 2008);
    assert.ok(m2008 && m2008.message.includes("reserved"), JSON.stringify(declDiags));
  });

  it("reads transition() priority from arg 7 / priority= rather than immediate= (M6050)", () => {
    const valid = cstDiags(`
block SM
  Real s1, s2, s3;
equation
  initialState(s1);
  transition(s1, s2, true, immediate = false, priority = 1);
  transition(s1, s3, true, immediate = false, priority = 2);
end SM;
`);
    assert.deepEqual(
      valid.filter((d) => d.code === 6050),
      [],
    );

    const dup = cstDiags(`
block SMDup
  Real s1, s2, s3;
equation
  initialState(s1);
  transition(s1, s2, true, false, true, false, 1);
  transition(s1, s3, true, false, true, false, 1);
end SMDup;
`);
    assert.ok(
      dup.some((d) => d.code === 6050),
      `Expected M6050 for duplicate priority 1, got ${JSON.stringify(dup)}`,
    );
  });

  it("guards extends cycles in getFlowVariableCount without overflowing WASM stack", () => {
    const diags = cstDiags(`
connector C extends C; end C;
model M
  C a, b;
equation
  connect(a, b);
end M;
`);
    assert.ok(
      diags.some((d) => d.code === 4001),
      `Expected M4001 for cyclic extends, got ${JSON.stringify(diags)}`,
    );
  });

  it("avoids false positives in M4041, M4003, M4014, M4030, M4017/M4065, and handles Real bounds in M4076", () => {
    const clean = cstDiags(`
model Clean
  parameter Integer n = 1;
  Real a[2];
  Real s = a[-1];
  Real c[3] = cat(1, {1}, {2, 3});
  Real d[n + 1] = {1, 2};
  outer Real world annotation(Placement(transformation(origin = {0, 0})));
  parameter Real pOk(min = -2.5, max = -1.5);
  parameter Real aSym = 5;
  parameter Real pSym(min = aSym, max = -1);
end Clean;
`);
    assert.deepEqual(
      clean.filter((d) => [4003, 4030, 4041, 4076].includes(d.code)),
      [],
    );

    const badBounds = cstDiags(`
model BadBounds
  parameter Real p1(min = 0.9, max = 0.1);
  parameter Real p2(min = -0.5, max = -1.5);
end BadBounds;
`);
    assert.equal(badBounds.filter((d) => d.code === 4076).length, 2);

    const tupleCall = cstDiags(`
model TupleCall
  Real arr[2] = {1, 2};
  Real r;
equation
  r = foo((1, 2), arr[1]);
end TupleCall;
`);
    const m4014 = tupleCall.filter((d) => d.code === 4014);
    assert.ok(
      m4014.every((d) => !d.message.includes("subscripted")),
      `Unexpected subscripted-tuple false positive: ${JSON.stringify(m4014)}`,
    );

    const conn = cstDiags(`
connector Pin
  Real v;
equation
  v = 1;
end Pin;
`);
    assert.equal(conn.filter((d) => d.code === 4065).length, 1);
    assert.equal(conn.filter((d) => d.code === 4017).length, 0);
  });

  it("detects cyclic array dimensions order-independently via Salsa and clears on edit (M4035)", async () => {
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());
    const uri = "file:///test/DimCycle.mo";

    ctx.load(
      `
model DimCycle
  Real x[size(y, 1)];
  Real y[size(x, 1)];
end DimCycle;
`,
      uri,
    );
    const first = (await ctx.queryEngine.runAllLintsAsync(uri)).filter((d) => d.code === 4035);
    assert.equal(first.length, 1, `Expected M4035 on cyclic dimension, got ${JSON.stringify(first)}`);

    // Break the cycle in y and invalidate incrementally.
    ctx.load(
      `
model DimCycle
  Real x[size(y, 1)];
  Real y[3];
end DimCycle;
`,
      uri,
    );
    const second = (await ctx.queryEngine.runAllLintsAsync(uri)).filter((d) => d.code === 4035);
    assert.equal(second.length, 0, `Expected M4035 to clear on edit, got ${JSON.stringify(second)}`);

    // Non-cyclic cross-dimension reference: x[2, size(y, 1)], y[size(x, 1)]
    ctx.load(
      `
model DimCrossNonCyclic
  Real x[2, size(y, 1)];
  Real y[size(x, 1)];
end DimCrossNonCyclic;
`,
      uri,
    );
    const cross = (await ctx.queryEngine.runAllLintsAsync(uri)).filter((d) => d.code === 4035);
    assert.equal(cross.length, 0, `Cross-dim acyclic reference should not report M4035: ${JSON.stringify(cross)}`);
  });
});
