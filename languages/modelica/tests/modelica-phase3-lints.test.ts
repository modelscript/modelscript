// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 3 Modelica linter & on-demand formal verification additions:
 * - Spec fix M5023 (`when` statements in algorithms allowed to assign distinct LHS targets across `elsewhen`)
 * - SOTA parity M2021 (`import-conflict`) & M3024 (`incompatible-display-unit`)
 * - On-demand formal checks: M7204, M7205, M7211, M7304, M7305, M7401, M7402, M7403, M7601
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

function makeContext(source: string, resourceId = "phase3_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

describe("Modelica Phase 3 SOTA parity, spec fixes & expanded 7xxx formal lints", () => {
  it("allows distinct LHS variables in elsewhen algorithm statements while checking when equations (M5023)", () => {
    const algWhen = cstDiags(`
function AlgWhen
  input Boolean b1;
  input Boolean b2;
  output Real x;
  output Real y;
algorithm
  x := 0.0;
  y := 0.0;
  when b1 then
    x := 1.0;
  elsewhen b2 then
    y := 2.0;
  end when;
end AlgWhen;
`);
    assert.deepEqual(
      algWhen.filter((d) => d.code === 5023),
      [],
      `Expected no M5023 on algorithm when statement, got ${JSON.stringify(algWhen)}`,
    );

    const eqWhen = cstDiags(`
model EqWhen
  Real x(start = 0.0), y(start = 0.0);
  Boolean b1 = time > 0.5;
  Boolean b2 = time > 1.0;
equation
  when b1 then
    x = 1.0;
  elsewhen b2 then
    y = 2.0;
  end when;
end EqWhen;
`);
    assert.ok(
      eqWhen.some((d) => d.code === 5023),
      `Expected M5023 on mismatched when equation`,
    );
  });

  it("detects conflicting import short names via Salsa (M2021)", async () => {
    const ctx = makeContext(`
package A
  model Item
    Real x = 1.0;
  end Item;
end A;

package B
  model Item
    Real y = 2.0;
  end Item;
end B;

model BadImports
  import A.Item;
  import B.Item;
  Real z = 1.0;
equation
  z = 1.0;
end BadImports;

model GoodImports
  import A.Item;
  import BItem = B.Item;
  Real z = 1.0;
equation
  z = 1.0;
end GoodImports;
`);
    const lints = await ctx.queryEngine.runAllLintsAsync();
    const bad = lints.filter((d: any) => d.code === 2021);
    assert.ok(bad.length >= 1, `Expected M2021 conflict in ${JSON.stringify(lints)}`);
    assert.ok(
      bad.every((d: any) => String(d.message).includes("BadImports")),
      `Did not expect M2021 on GoodImports: ${JSON.stringify(bad)}`,
    );
  });

  it("detects incompatible displayUnit dimensions vs unit via Salsa (M3024)", async () => {
    const ctx = makeContext(`
model UnitDisplayCheck
  Real dist(unit = "m", displayUnit = "s") = 1.0;
  Real length(unit = "m", displayUnit = "mm") = 2.0;
  Real voltage(unit = "V", displayUnit = "A") = 5.0;
equation
  dist = 1.0;
  length = 2.0;
  voltage = 5.0;
end UnitDisplayCheck;
`);
    const lints = await ctx.queryEngine.runAllLintsAsync();
    const unitDiags = lints.filter((d: any) => d.code === 3024);
    assert.equal(unitDiags.length, 2, `Expected 2 M3024 diagnostics (dist, voltage), got ${JSON.stringify(unitDiags)}`);
    assert.ok(unitDiags.some((d: any) => String(d.message).includes("'dist'")));
    assert.ok(unitDiags.some((d: any) => String(d.message).includes("'voltage'")));
  });

  it("emits expanded 72xx/73xx formal diagnostics (M7204, M7205, M7211, M7304, M7305) on demand only", async () => {
    const ctx = makeContext(`
model DomainAndNominal
  Real d(min = 2.0, max = 4.0);
  Real neg(min = -4.0, max = -1.0);
  Real scaled(nominal = 1.0, min = 5000.0, max = 6000.0);
  Real yAsin, yPow;
equation
  d = 3.0;
  neg = -2.0;
  scaled = 5500.0;
  yAsin = asin(d);
  yPow = neg ^ 0.5;
end DomainAndNominal;

model SatGuards
  parameter Real p(min = 0.0, max = 5.0);
  input Real q(min = 0.0, max = 5.0);
  Real x(start = 0.0);
  Real y(start = 0.0);
equation
  if q > 1.0 then
    y = 1.0;
  elseif q > 3.0 then
    y = 2.0;
  else
    y = 0.0;
  end if;
  when q > 9.0 then
    x = 1.0;
  end when;
end SatGuards;
`);
    // Standard lints must never include 7xxx formal codes
    const std = await ctx.queryEngine.runAllLintsAsync();
    assert.deepEqual(
      std.filter((d: any) => typeof d.code === "number" && d.code >= 7000 && d.code < 8000),
      [],
    );

    const res = await ctx.verifyFormal();
    const codes = (cls: string) => res.diagnostics.filter((d) => d.className === cls).map((d) => d.code);

    const domCodes = codes("DomainAndNominal");
    assert.ok(domCodes.includes(7204), `Expected M7204 in ${JSON.stringify(domCodes)}`);
    assert.ok(domCodes.includes(7205), `Expected M7205 in ${JSON.stringify(domCodes)}`);
    assert.ok(domCodes.includes(7211), `Expected M7211 in ${JSON.stringify(domCodes)}`);

    const satCodes = codes("SatGuards");
    assert.ok(satCodes.includes(7304), `Expected M7304 in ${JSON.stringify(satCodes)}`);
    assert.ok(satCodes.includes(7305), `Expected M7305 in ${JSON.stringify(satCodes)}`);
  });

  it("emits 74xx hybrid mode diagnostics (M7401, M7402, M7403) and 7601 flowpipe bound breach on demand", async () => {
    const ctx = makeContext(`
model HybridHazards
  Real x(min = 0.0, max = 2.0, start = 0.0);
  input Real q(min = 0.0, max = 5.0);
  Real z(start = 0.0);
equation
  der(x) = 0.1;
  when x > 0.5 then
    x = 1.5;
  end when;
  when q >= 1.0 then
    z = 1.0;
  elsewhen q <= 4.0 then
    z = 2.0;
  end when;
end HybridHazards;

model FlowpipeBreach
  Real x(min = -1.0, max = 2.0, start = 1.5);
equation
  der(x) = 2.0;
end FlowpipeBreach;
`);
    const res = await ctx.verifyFormal({ timeHorizon: 1.0 });
    const hybCodes = res.diagnostics.filter((d) => d.className === "HybridHazards").map((d) => d.code);
    const flowCodes = res.diagnostics.filter((d) => d.className === "FlowpipeBreach").map((d) => d.code);

    assert.ok(hybCodes.includes(7401), `Expected M7401 in ${JSON.stringify(hybCodes)}`);
    assert.ok(hybCodes.includes(7402), `Expected M7402 in ${JSON.stringify(hybCodes)}`);
    assert.ok(hybCodes.includes(7403), `Expected M7403 in ${JSON.stringify(hybCodes)}`);
    assert.ok(
      flowCodes.includes(7601) || flowCodes.includes(7213),
      `Expected M7601 or M7213 in ${JSON.stringify(flowCodes)}`,
    );
  });
});
