// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 6 Modelica linter telemetry, SOTA parity rules, and formal checks:
 * - Infrastructure (I6): Structured lint failure capture via WasmQueryEngine.getLintFailures()
 * - SOTA parity: M2020 (`import-not-found`), M4151 (`unconnected-input`), M4152 (`experiment-annotation-missing`)
 * - On-demand formal verification: M7104 (`formal-state-selection-ambiguous`),
 *   M7603 (`formal-requirement-stl-violated`), M7605 (`formal-polyglot-parameter-drift`)
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
const { parser } = await createWasmParser(modelicaWasm);

function makeContext(source: string, resourceId = "phase6_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

describe("Modelica Phase 6 telemetry, SOTA parity, and formal verification", () => {
  it("records structured lint hook failures in WasmQueryEngine instead of silently dropping them (I6)", () => {
    const ctx = makeContext(`
model Probe
  Real x = 1.0;
end Probe;
`);
    const cls = Array.from(ctx.queryEngine.index.symbols.values()).find((s) => s.name === "Probe");
    assert.ok(cls);
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      ctx.queryEngine.registerLintHook(cls!.ruleName, "syntheticCrash", () => {
        throw new Error("boom in lint hook");
      });
      ctx.queryEngine.runLints(cls!.id);
      const failures = ctx.queryEngine.getLintFailures();
      assert.equal(failures.length, 1);
      assert.equal(failures[0]!.symbolId, cls!.id);
      assert.equal(failures[0]!.lintName, "syntheticCrash");
      assert.ok(failures[0]!.message.includes("boom in lint hook"));
      ctx.queryEngine.clearLintFailures(cls!.id);
      assert.equal(ctx.queryEngine.getLintFailures().length, 0);
    } finally {
      const hooks = (ctx.queryEngine as any).hooksByRule?.get(cls!.ruleName);
      if (hooks) delete hooks["lint__syntheticCrash"];
      console.warn = origWarn;
    }
  });

  it("reports unresolved workspace/unqualified imports without false-flagging unmounted external libraries (M2020)", async () => {
    const ctx = makeContext(`
package Lib
  model Exists Real x = 1.0; end Exists;
end Lib;

model Client
  import Lib.Exists;
  import Lib.NoSuchModel;
  import UnknownPkg.*;
  import Modelica.Units.SI;
  Exists e;
  SI.Voltage v;
equation
  v = e.x;
end Client;
`);
    const diags = await ctx.queryEngine.runAllLintsAsync();
    const m2020 = diags.filter((d: any) => d.code === 2020);
    assert.ok(
      m2020.some((d: any) => String(d.message).includes("Lib.NoSuchModel")),
      `Expected M2020 for Lib.NoSuchModel: ${JSON.stringify(m2020)}`,
    );
    assert.ok(
      m2020.some((d: any) => String(d.message).includes("UnknownPkg")),
      `Expected M2020 for UnknownPkg: ${JSON.stringify(m2020)}`,
    );
    assert.ok(
      !m2020.some((d: any) => String(d.message).includes("Lib.Exists")),
      `Did not expect M2020 for valid Lib.Exists: ${JSON.stringify(m2020)}`,
    );
    assert.ok(
      !m2020.some((d: any) => String(d.message).includes("Modelica.Units.SI")),
      `Did not expect M2020 for unmounted external Modelica.Units.SI: ${JSON.stringify(m2020)}`,
    );
  });

  it("reports unconnected required block inputs while allowing connected, modified, and defaulted inputs (M4151)", async () => {
    const ctx = makeContext(`
block Gain
  input Real u;
  input Real uDefault = 1.0;
  output Real y;
equation
  y = 2.0 * u + uDefault;
end Gain;

block System
  Gain gUnconnected;
  Gain gModified(u = 3.0);
  Gain gConnected;
  output Real y_out;
equation
  connect(gModified.y, gConnected.u);
  y_out = gConnected.y + gUnconnected.y;
end System;
`);
    const diags = await ctx.queryEngine.runAllLintsAsync();
    const m4151 = diags.filter((d: any) => d.code === 4151);
    assert.equal(m4151.length, 1, `Expected 1 M4151 for gUnconnected.u, got ${JSON.stringify(m4151)}`);
    assert.ok(String(m4151[0]!.message).includes("gUnconnected.u"));
  });

  it("flags concrete Examples missing experiment(...) annotations and skips ones that declare it (M4152)", async () => {
    const ctx = makeContext(`
package Examples
  model MissingExp
    Real x = 1.0;
  end MissingExp;

  model HasExp
    Real x = 1.0;
    annotation(experiment(StopTime = 2.0));
  end HasExp;

  partial model PartialBase
    Real x = 1.0;
  end PartialBase;
end Examples;
`);
    const diags = await ctx.queryEngine.runAllLintsAsync();
    const m4152 = diags.filter((d: any) => d.code === 4152);
    assert.equal(m4152.length, 1, `Expected 1 M4152 for MissingExp, got ${JSON.stringify(m4152)}`);
    assert.ok(String(m4152[0]!.message).includes("MissingExp"));
  });

  it("flags ambiguous state selection on high-index DAEs lacking stateSelect hints on demand (M7104)", async () => {
    const ctx = makeContext(`
model PendulumNoHint
  Real x(start = 1.0);
  Real y(start = 0.0);
  Real vx(start = 0.0);
  Real vy(start = 0.0);
  Real lam;
equation
  der(x) = vx;
  der(y) = vy;
  der(vx) = -lam * x;
  der(vy) = -lam * y - 9.81;
  x * x + y * y = 1.0;
end PendulumNoHint;

model PendulumWithHint
  Real x(start = 1.0, stateSelect = StateSelect.always);
  Real y(start = 0.0, stateSelect = StateSelect.prefer);
  Real vx(start = 0.0, stateSelect = StateSelect.always);
  Real vy(start = 0.0, stateSelect = StateSelect.never);
  Real lam;
equation
  der(x) = vx;
  der(y) = vy;
  der(vx) = -lam * x;
  der(vy) = -lam * y - 9.81;
  x * x + y * y = 1.0;
end PendulumWithHint;
`);
    const defaultLints = await ctx.queryEngine.runAllLintsAsync();
    assert.equal(defaultLints.filter((d: any) => d.code >= 7000).length, 0);

    const res = await ctx.verifyFormal({ classNames: ["PendulumNoHint", "PendulumWithHint"] });
    const bad = res.diagnostics.filter((d) => d.code === 7104 && d.className === "PendulumNoHint");
    const good = res.diagnostics.filter((d) => d.code === 7104 && d.className === "PendulumWithHint");
    assert.equal(bad.length, 1, `Expected M7104 for PendulumNoHint: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(good.length, 0, `Did not expect M7104 for PendulumWithHint: ${JSON.stringify(good)}`);
  });

  it("verifies temporal __ModelScript_requirement STL formulas on demand via StlMonitor (M7603)", async () => {
    const ctx = makeContext(`
model TankOverflow
  Real level(start = 4.0);
initial equation
  level = 4.0;
equation
  der(level) = 3.0;
  annotation(__ModelScript_requirement = "G[0, 1](level <= 5)");
end TankOverflow;

model TankSafe
  Real level(start = 1.0);
initial equation
  level = 1.0;
equation
  der(level) = 1.0;
  annotation(__ModelScript_requirement = "G[0, 1](level <= 5)");
end TankSafe;
`);
    const res = await ctx.verifyFormal({ classNames: ["TankOverflow", "TankSafe"], timeHorizon: 1.0 });
    const bad = res.diagnostics.filter((d) => d.code === 7603 && d.className === "TankOverflow");
    const good = res.diagnostics.filter((d) => d.code === 7603 && d.className === "TankSafe");
    assert.equal(bad.length, 1, `Expected M7603 for TankOverflow: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(good.length, 0, `Did not expect M7603 for TankSafe: ${JSON.stringify(good)}`);
  });

  it("detects cross-language parameter drift between Modelica and foreign symbols on demand (M7605)", async () => {
    const ctx = makeContext(`
model CircuitR1
  parameter Real R = 100.0;
equation
end CircuitR1;
`);
    // Inject a foreign SPICE symbol for CircuitR1 with drifted resistance 250 Ohm into the unified SymbolIndex
    const nextId = 900001;
    ctx.queryEngine.index.symbols.set(nextId, {
      id: nextId,
      name: "R",
      kind: "Parameter",
      ruleName: "spice_param",
      language: "spice",
      resourceId: "netlist.cir",
      parentId: null,
      startOffset: 0,
      endOffset: 10,
      metadata: {
        component: "CircuitR1",
        value: 250.0,
        unit: "ohm",
      },
    } as any);

    const res = await ctx.verifyFormal({ classNames: ["CircuitR1"] });
    const drift = res.diagnostics.filter((d) => d.code === 7605);
    assert.equal(drift.length, 1, `Expected M7605 drift diagnostic, got ${JSON.stringify(res.diagnostics)}`);
    assert.ok(String(drift[0]!.message).includes("resistance"));
  });
});
