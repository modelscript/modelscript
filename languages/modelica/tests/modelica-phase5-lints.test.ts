// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 5 Modelica linter fixes, SOTA parity rules, and formal checks:
 * - P1 noise/spec fixes: M4136 (Windows drive colon in descriptions), M6020/M6021 (pure(...) & initial equation),
 *   M5010 (balanced parens, identifier boundary, parameter constant skipping, T vs time/tau heuristic)
 * - SOTA parity: M4149 (`connect-two-outputs`), M4150 (`derivative-annotation-mismatch`)
 * - On-demand formal verification: M7109 (`formal-alias-cycle-no-source`), M7212 (`formal-loop-termination-unproven`)
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { deriveSimplification, findNonlinearTermsInCst } from "../src/lints/homotopy-synthesis.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

function makeContext(source: string, resourceId = "phase5_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

function getCstDiagnostics(source: string): { code: number; severity: number; message: string }[] {
  const root = facade.parseIncremental(source, 0, 0, source.length, "file:///phase5_cst.mo");
  assert.ok(root > 0, "Expected facade.parseIncremental to return a valid root");
  return facade.getDiagnostics(root, 0, 0, source);
}

describe("Modelica Phase 5 lint fixes, SOTA parity, and formal verification", () => {
  it("suppresses M4136 false positives on description strings like 'C: capacitance' while flagging paths", () => {
    const diags = getCstDiagnostics(`
model CapWithPaths
  Real c = 1.0 "C: capacitance in Farads";
  Real d = 2.0 "D: damping coefficient";
  parameter String p1 = "C:\\\\data\\\\table.mat";
  parameter String p2 = "/home/user/table.mat";
end CapWithPaths;
`);
    const m4136 = diags.filter((d) => d.code === 4136);
    assert.equal(m4136.length, 2, `Expected exactly 2 M4136 diagnostics, got ${JSON.stringify(m4136)}`);
  });

  it("exempts pure(...) wrappers and initial equation calls in M6020 and M6021", () => {
    const diags = getCstDiagnostics(`
package P
  impure function sampleNoise
    input Real u;
    output Real y;
  algorithm
    y := u;
  end sampleNoise;

  pure function safePureFn
    input Real u;
    output Real y;
  algorithm
    y := pure(sampleNoise(u));
  end safePureFn;

  pure function unsafePureFn
    input Real u;
    output Real y;
  algorithm
    y := sampleNoise(u);
  end unsafePureFn;

  model M
    Real x;
    Real initVal;
    Real badVal;
  initial equation
    initVal = sampleNoise(1.0);
  equation
    x = pure(sampleNoise(time));
    badVal = sampleNoise(time);
  end M;
end P;
`);
    const m6020 = diags.filter((d) => d.code === 6020);
    const m6021 = diags.filter((d) => d.code === 6021);
    assert.equal(m6020.length, 1, `Expected 1 M6020 (unsafePureFn only), got ${JSON.stringify(m6020)}`);
    assert.equal(m6021.length, 1, `Expected 1 M6021 (badVal continuous eq only), got ${JSON.stringify(m6021)}`);
  });

  it("fixes M5010 temperature heuristic, balanced parens, call boundaries, and parameter-only skipping", async () => {
    // Uppercase Kelvin names use 300.0; lowercase time/tau use 1.0
    assert.ok(deriveSimplification("power", "T", { power: 4 }).includes("300"), "Expected 300.0 for T^4");
    assert.ok(!deriveSimplification("exp", "tau", { arg: "tau" }).includes("300"), "Did not expect 300.0 for tau");
    assert.ok(!deriveSimplification("exp", "time", { arg: "time" }).includes("300"), "Did not expect 300.0 for time");

    const ctx = makeContext(`
model HomotopyTest
  parameter Real c = 2.0;
  Real x;
  Real a;
  Real b;
  Real p;
  Real q;
  Real r;
equation
  p = exp(c);
  q = myexp(x);
  r = exp(-(a + b) / c);
  a = 1.0;
  b = 2.0;
  x = 3.0;
end HomotopyTest;
`);
    const cls = Array.from(ctx.queryEngine.index.symbols.values()).find((s) => s.name === "HomotopyTest");
    assert.ok(cls);
    const cst = ctx.queryEngine.toQueryDB().cstNode(cls!.id);
    const terms = findNonlinearTermsInCst(cst);
    assert.equal(terms.length, 1, `Expected only exp(-(a + b) / c), got ${JSON.stringify(terms)}`);
    assert.equal(terms[0]!.termText, "exp(-(a + b) / c)");
  });

  it("reports output-to-output connections while allowing pass-through to enclosing block output (M4149)", async () => {
    const ctx = makeContext(`
connector OutPort = output Real;

block Src
  OutPort y;
equation
  y = 1.0;
end Src;

block Top
  Src s1;
  Src s2;
  OutPort y_out;
equation
  connect(s1.y, s2.y);
  connect(s1.y, y_out);
end Top;
`);
    const diags = await ctx.queryEngine.runAllLintsAsync();
    const m4149 = diags.filter((d: any) => d.code === 4149);
    assert.equal(m4149.length, 1, `Expected 1 M4149 for connect(s1.y, s2.y), got ${JSON.stringify(m4149)}`);
    assert.ok(String(m4149[0]!.message).includes("s1.y"));
  });

  it("reports unresolved or non-function derivative annotations on functions (M4150)", async () => {
    const ctx = makeContext(`
model NotAFn Real x; end NotAFn;

function goodDeriv
  input Real u;
  input Real du;
  output Real dy;
algorithm
  dy := 2 * u * du;
end goodDeriv;

function goodFn
  input Real u;
  output Real y;
algorithm
  y := u * u;
  annotation(derivative = goodDeriv);
end goodFn;

function badFnMissing
  input Real u;
  output Real y;
algorithm
  y := u;
  annotation(derivative = noSuchDeriv);
end badFnMissing;

function badFnModel
  input Real u;
  output Real y;
algorithm
  y := u;
  annotation(derivative = NotAFn);
end badFnModel;
`);
    const diags = await ctx.queryEngine.runAllLintsAsync();
    const m4150 = diags.filter((d: any) => d.code === 4150);
    assert.equal(m4150.length, 2, `Expected 2 M4150 diagnostics, got ${JSON.stringify(m4150)}`);
    assert.ok(m4150.some((d: any) => String(d.message).includes("noSuchDeriv")));
    assert.ok(m4150.some((d: any) => String(d.message).includes("NotAFn")));
  });

  it("detects ungrounded alias chain cycles on demand (M7109) without leaking into default lints", async () => {
    const ctx = makeContext(`
model AliasCycleBad
  Real x;
  Real y;
equation
  x = y;
  y = x;
end AliasCycleBad;

model AliasCycleGrounded
  Real x = 2.0;
  Real y;
equation
  x = y;
  y = x;
end AliasCycleGrounded;
`);
    const defaultLints = await ctx.queryEngine.runAllLintsAsync();
    assert.equal(defaultLints.filter((d: any) => d.code >= 7000).length, 0);

    const res = await ctx.verifyFormal({ classNames: ["AliasCycleBad", "AliasCycleGrounded"] });
    const badM7109 = res.diagnostics.filter((d) => d.code === 7109 && d.className === "AliasCycleBad");
    const okM7109 = res.diagnostics.filter((d) => d.code === 7109 && d.className === "AliasCycleGrounded");
    assert.equal(badM7109.length, 1, `Expected M7109 for AliasCycleBad: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(okM7109.length, 0, `Did not expect M7109 for grounded AliasCycleGrounded: ${JSON.stringify(okM7109)}`);
  });

  it("detects unproven while-loop termination on demand (M7212) and passes terminating loops", async () => {
    const ctx = makeContext(`
function infiniteWrongDir
  input Integer n;
  output Integer acc;
protected
  Integer i := 0;
algorithm
  acc := 0;
  while i < n loop
    acc := acc + 1;
    i := i - 1;
  end while;
end infiniteWrongDir;

function safeTerminatingLoop
  input Integer n;
  output Integer acc;
protected
  Integer i := 0;
algorithm
  acc := 0;
  while i < n loop
    acc := acc + i;
    i := i + 1;
  end while;
end safeTerminatingLoop;
`);
    const defaultLints = await ctx.queryEngine.runAllLintsAsync();
    assert.equal(defaultLints.filter((d: any) => d.code >= 7000).length, 0);

    const res = await ctx.verifyFormal({ classNames: ["infiniteWrongDir", "safeTerminatingLoop"] });
    const bad = res.diagnostics.filter((d) => d.code === 7212 && d.className === "infiniteWrongDir");
    const good = res.diagnostics.filter((d) => d.code === 7212 && d.className === "safeTerminatingLoop");
    assert.equal(bad.length, 1, `Expected M7212 for infiniteWrongDir: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(good.length, 0, `Did not expect M7212 for safeTerminatingLoop: ${JSON.stringify(good)}`);
  });
});
