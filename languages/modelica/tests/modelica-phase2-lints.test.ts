// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 2 Modelica linter additions:
 * - Fast SOTA parity checks (`M3023`, `M4146`, `M4147`, `M5051`)
 * - Strictly on-demand `7xxx` formal verification checks (`Context.verifyFormal` / `verifyArenaFormal`)
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

function cstDiags(source: string): Array<{ code: number; message: string; severity: number }> {
  const tree = facade.parse(source);
  return facade.getDiagnostics(tree);
}

function makeContext(source: string, resourceId = "phase2_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

describe("Modelica Phase 2 SOTA parity & on-demand 7xxx formal lints", () => {
  it("detects Real equality outside functions (M3023) without flagging inside functions or Integer equality", () => {
    const diags = cstDiags(`
model EqCheck
  Real x = 1.0;
  Integer k = 1;
  Boolean b1 = (x == 1.0);
  Boolean b2 = (k == 1);
end EqCheck;

function fEq
  input Real u;
  output Boolean y;
algorithm
  y := (u == 0.0);
end fEq;
`);
    const m3023 = diags.filter((d) => d.code === 3023);
    assert.equal(m3023.length, 1, `Expected exactly one M3023 outside function, got ${JSON.stringify(m3023)}`);
    assert.equal(m3023[0]!.severity, 2); // warning
  });

  it("warns on parameters without value or start (M4146) and respects start/fixed=false/partial", () => {
    const diags = cstDiags(`
model ParamCheck
  parameter Real missing;
  parameter Real bound = 1.0;
  parameter Real withStart(start = 2.0);
  parameter Real freeFixed(fixed = false);
end ParamCheck;

partial model PartialBase
  parameter Real abstractParam;
end PartialBase;
`);
    const m4146 = diags.filter((d) => d.code === 4146);
    assert.equal(m4146.length, 1, `Expected M4146 only on 'missing', got ${JSON.stringify(m4146)}`);
    assert.ok(m4146[0]!.message.includes("missing"));
  });

  it("rejects der() of non-Real expressions (M5051)", () => {
    const bad = cstDiags(`
model BadDer
  Integer k = 1;
  Real y;
equation
  y = der(k);
end BadDer;
`);
    assert.ok(
      bad.some((d) => d.code === 5051),
      `Expected M5051 in ${JSON.stringify(bad)}`,
    );

    const good = cstDiags(`
model GoodDer
  Real x(start = 1.0);
  Real m[2, 2];
  constant Real c[2, 3] = der({{1, 2, 3}, {4, 5, 6}});
equation
  der(x) = -x;
  m = der([time * 1, time * 2; time * 3, time * 4]);
end GoodDer;
`);
    assert.deepEqual(
      good.filter((d) => d.code === 5051),
      [],
    );
  });

  it("warns via Salsa when instantiating a class marked obsolete (M4147) and keeps 7xxx off standard lints", async () => {
    const ctx = makeContext(`
model LegacyController
  Real u = 1.0;
  annotation(obsolete = "Use ModernController instead");
end LegacyController;

model Plant
  LegacyController ctrl;
  Real x = 1.0 + 0.0;
equation
  x = x;
end Plant;
`);
    const standardLints = await ctx.queryEngine.runAllLintsAsync();
    assert.ok(
      standardLints.some((d: any) => d.code === 4147 && String(d.message).includes("Use ModernController instead")),
      `Expected M4147 in standard lints, got ${JSON.stringify(standardLints)}`,
    );
    // Decision 2-on-demand: standard lints must never emit 7xxx formal codes
    assert.deepEqual(
      standardLints.filter((d: any) => typeof d.code === "number" && d.code >= 7000 && d.code < 8000),
      [],
    );
  });

  it("emits on-demand 71xx structural diagnostics (under/over-determined, high-index, orphan var, large loop without start)", async () => {
    const ctxUnderOver = makeContext(`
model UnderDet
  Real x;
  Real y;
equation
  x + y = 1.0;
end UnderDet;

model OverDet
  Real x;
equation
  x = 1.0;
  x = 2.0;
end OverDet;

model HighIdx
  Real x(start = 1.0);
  Real y(start = 0.0);
equation
  x = y;
  der(x) = -y;
end HighIdx;

model LargeLoop
  Real a, b, c, d;
equation
  a + b + c + d = 1.0;
  a - b + c - d = 0.0;
  2*a + b - c + d = 2.0;
  a + 3*b + 2*c - d = 3.0;
end LargeLoop;

model OrphanVar
  Real orphan;
  Real x(start = 0.0);
equation
  der(x) = -x;
end OrphanVar;
`);
    const res = await ctxUnderOver.verifyFormal();
    const codes = (cls: string) => res.diagnostics.filter((d) => d.className === cls).map((d) => d.code);

    assert.ok(codes("UnderDet").includes(7110), `Expected M7110 on UnderDet, got ${JSON.stringify(codes("UnderDet"))}`);
    assert.ok(codes("OverDet").includes(7102), `Expected M7102 on OverDet, got ${JSON.stringify(codes("OverDet"))}`);
    assert.ok(codes("HighIdx").includes(7103), `Expected M7103 on HighIdx, got ${JSON.stringify(codes("HighIdx"))}`);
    assert.ok(
      codes("LargeLoop").includes(7105),
      `Expected M7105 on LargeLoop, got ${JSON.stringify(codes("LargeLoop"))}`,
    );
    assert.ok(
      codes("LargeLoop").includes(7112),
      `Expected M7112 on LargeLoop, got ${JSON.stringify(codes("LargeLoop"))}`,
    );
    assert.ok(
      codes("OrphanVar").includes(7108),
      `Expected M7108 on OrphanVar, got ${JSON.stringify(codes("OrphanVar"))}`,
    );
  });

  it("emits on-demand 72xx abstract-interpretation & octagon relational diagnostics", async () => {
    const ctx = makeContext(`
model BoundsAndDomain
  parameter Real k(min = 0.0, max = 10.0) = 12.0;
  parameter Real s(min = 0.0, max = 10.0, start = -1.0) = 5.0;
  Real d(min = 0.0, max = 2.0);
  Real y1, y2, y3;
equation
  d = 1.0;
  y1 = 1.0 / (d - 1.0);
  y2 = sqrt(d - 3.0);
  y3 = log(d - 2.0);
end BoundsAndDomain;

model OctagonConflict
  parameter Real a(min = 0.0, max = 10.0);
  parameter Real b(min = 0.0, max = 10.0);
equation
  assert(a >= b + 6.0, "gap");
  assert(b >= 5.0, "lower");
end OctagonConflict;

function AlgBug
  input Real u;
  output Real y;
protected
  Real arr[3] = {1.0, 2.0, 3.0};
algorithm
  y := arr[5] + 1.0 / 0.0;
end AlgBug;
`);
    const res = await ctx.verifyFormal();
    const byClass = (cls: string) => res.diagnostics.filter((d) => d.className === cls).map((d) => d.code);

    const bCodes = byClass("BoundsAndDomain");
    assert.ok(bCodes.includes(7208), `Expected M7208 in ${JSON.stringify(bCodes)}`);
    assert.ok(bCodes.includes(7209), `Expected M7209 in ${JSON.stringify(bCodes)}`);
    assert.ok(bCodes.includes(7201), `Expected M7201 in ${JSON.stringify(bCodes)}`);
    assert.ok(bCodes.includes(7202), `Expected M7202 in ${JSON.stringify(bCodes)}`);
    assert.ok(bCodes.includes(7203), `Expected M7203 in ${JSON.stringify(bCodes)}`);

    const octCodes = byClass("OctagonConflict");
    assert.ok(octCodes.includes(7210), `Expected M7210 in ${JSON.stringify(octCodes)}`);

    const algCodes = byClass("AlgBug");
    assert.ok(
      algCodes.includes(7201) || algCodes.includes(7206),
      `Expected M7201/M7206 in ${JSON.stringify(algCodes)}`,
    );
  });

  it("emits on-demand 73xx satisfiability and 77xx E-graph algebraic diagnostics", async () => {
    const ctx = makeContext(`
model SatAndAlgebra
  parameter Real p(min = 0.0, max = 5.0);
  input Real q(min = 0.0, max = 5.0);
  Real x, y;
equation
  assert(p > 10.0, "impossible");
  assert(p >= 0.0, "always");
  if q > 8.0 then
    x = 1.0;
  else
    x = 2.0;
  end if;
  y = y;
  x + 2.0 = x;
end SatAndAlgebra;

model RedundantEqs
  Real x, y;
equation
  x + y = 3.0;
  x + y = 3.0;
end RedundantEqs;
`);
    const res = await ctx.verifyFormal();
    const saCodes = res.diagnostics.filter((d) => d.className === "SatAndAlgebra").map((d) => d.code);
    const redCodes = res.diagnostics.filter((d) => d.className === "RedundantEqs").map((d) => d.code);

    assert.ok(saCodes.includes(7301), `Expected M7301 in ${JSON.stringify(saCodes)}`);
    assert.ok(saCodes.includes(7302), `Expected M7302 in ${JSON.stringify(saCodes)}`);
    assert.ok(saCodes.includes(7303), `Expected M7303 in ${JSON.stringify(saCodes)}`);
    assert.ok(saCodes.includes(7702), `Expected M7702 in ${JSON.stringify(saCodes)}`);
    assert.ok(saCodes.includes(7703), `Expected M7703 in ${JSON.stringify(saCodes)}`);
    assert.ok(redCodes.includes(7701), `Expected M7701 in ${JSON.stringify(redCodes)}`);
  });
});
