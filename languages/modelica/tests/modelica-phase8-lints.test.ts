// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 8 Modelica linter fixes, SOTA parity, and IC3/CHC/SOS formal checks:
 * - M6010 (`duplicate-initial-state`): allow multiple independent parallel state machines in one equation section
 * - M4153 (`missing-uses-annotation`): flag library packages importing external libraries missing from `uses(...)`
 * - M7501 (`formal-assert-violable-discrete`): IC3 bounded discrete counterexample on `when` counter + `assert`
 * - M7504 (`formal-function-postcondition-violation`): Spacer CHC check against `__ModelScript_ensures`
 * - M7602 (`formal-barrier-certificate-not-found`): SosBarrierSynthesizer check via `__ModelScript_barrier`
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

function makeContext(source: string, resourceId = "phase8_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

function getCstDiagnostics(source: string): { code: number; severity: number; message: string }[] {
  const root = facade.parseIncremental(source, 0, 0, source.length, "file:///phase8_cst.mo");
  assert.ok(root > 0, "Expected facade.parseIncremental to return a valid root");
  return facade.getDiagnostics(root, 0, 0, source);
}

describe("Modelica Phase 8 state machines, library checks, and IC3/CHC/SOS formal engines", () => {
  it("allows disjoint parallel state machines in one equation section while flagging conflicting initialState (M6010)", () => {
    const okDiags = getCstDiagnostics(`
model TwoParallelMachines
  block S Real x; end S;
  S a1;
  S a2;
  S b1;
  S b2;
equation
  transition(a1, a2, true, immediate = false);
  transition(b1, b2, true, immediate = false);
  initialState(a1);
  initialState(b1);
end TwoParallelMachines;
`);
    assert.equal(
      okDiags.filter((d) => d.code === 6010).length,
      0,
      `Did not expect M6010 for disjoint machines: ${JSON.stringify(okDiags)}`,
    );

    const badDiags = getCstDiagnostics(`
model ConflictingSingleMachine
  block S Real x; end S;
  S a1;
  S a2;
equation
  transition(a1, a2, true, immediate = false);
  initialState(a1);
  initialState(a2);
end ConflictingSingleMachine;
`);
    assert.equal(
      badDiags.filter((d) => d.code === 6010).length,
      1,
      `Expected 1 M6010 for conflicting machine: ${JSON.stringify(badDiags)}`,
    );
  });

  it("reports missing uses(...) entries on library packages that import external packages (M4153)", async () => {
    const ctx = makeContext(`
package ExtLib
  model Component Real x = 1.0; end Component;
end ExtLib;

package MyMissingUsesLib
  import ExtLib.Component;
  model UserModel
    Component c;
  end UserModel;
  annotation(version = "1.0.0");
end MyMissingUsesLib;

package MyDeclaredUsesLib
  import ExtLib.Component;
  model UserModel
    Component c;
  end UserModel;
  annotation(version = "1.0.0", uses(ExtLib(version = "1.0.0")));
end MyDeclaredUsesLib;
`);
    const diags = await ctx.queryEngine.runAllLintsAsync();
    const m4153 = diags.filter((d: any) => d.code === 4153);
    assert.equal(m4153.length, 1, `Expected 1 M4153 for MyMissingUsesLib, got ${JSON.stringify(m4153)}`);
    assert.ok(String(m4153[0]!.message).includes("MyMissingUsesLib"));
    assert.ok(String(m4153[0]!.message).includes("ExtLib"));
  });

  it("finds multi-step discrete counterexample traces for when-counter asserts via IC3Engine on demand (M7501)", async () => {
    const ctx = makeContext(`
model DiscreteCounterHazard
  Integer count(start = 0);
equation
  when sample(0, 1) then
    count = pre(count) + 1;
  end when;
  assert(count <= 2, "Counter exceeded bound");
end DiscreteCounterHazard;
`);
    const defaultLints = await ctx.queryEngine.runAllLintsAsync();
    assert.equal(defaultLints.filter((d: any) => d.code >= 7000).length, 0);

    const res = await ctx.verifyFormal({ classNames: ["DiscreteCounterHazard"] });
    const m7501 = res.diagnostics.filter((d) => d.code === 7501);
    assert.equal(
      m7501.length,
      1,
      `Expected M7501 counterexample for DiscreteCounterHazard: ${JSON.stringify(res.diagnostics)}`,
    );
  });

  it("verifies function algorithm postconditions via Spacer CHC engine on demand (M7504)", async () => {
    const ctx = makeContext(`
function badOffset
  input Real x(min = 0.0, max = 5.0);
  output Real y;
algorithm
  y := x - 2.0;
  annotation(__ModelScript_ensures = "y >= 0");
end badOffset;

function safeOffset
  input Real x(min = 0.0, max = 5.0);
  output Real y;
algorithm
  y := x + 1.0;
  annotation(__ModelScript_ensures = "y >= 0");
end safeOffset;
`);
    const res = await ctx.verifyFormal({ classNames: ["badOffset", "safeOffset"] });
    const bad = res.diagnostics.filter((d) => d.code === 7504 && d.className === "badOffset");
    const good = res.diagnostics.filter((d) => d.code === 7504 && d.className === "safeOffset");
    assert.equal(bad.length, 1, `Expected M7504 for badOffset: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(good.length, 0, `Did not expect M7504 for safeOffset: ${JSON.stringify(good)}`);
  });

  it("synthesizes and flags missing heuristic quadratic SOS barrier certificates on demand (M7602)", async () => {
    const ctx = makeContext(`
model UnstablePlant
  Real x(start = 0.1);
equation
  der(x) = 2.0 * x;
  annotation(__ModelScript_barrier = "r0=0.5, ru=2.0");
end UnstablePlant;

model StablePlant
  Real x(start = 0.1);
equation
  der(x) = -2.0 * x;
  annotation(__ModelScript_barrier = "r0=0.5, ru=2.0");
end StablePlant;
`);
    const res = await ctx.verifyFormal({ classNames: ["UnstablePlant", "StablePlant"] });
    const bad = res.diagnostics.filter((d) => d.code === 7602 && d.className === "UnstablePlant");
    const good = res.diagnostics.filter((d) => d.code === 7602 && d.className === "StablePlant");
    assert.equal(bad.length, 1, `Expected M7602 info for UnstablePlant: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(bad[0]!.severity, "info");
    assert.equal(good.length, 0, `Did not expect M7602 for StablePlant: ${JSON.stringify(good)}`);
  });
});
