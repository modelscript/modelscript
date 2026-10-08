// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { deriveSimplification } from "../src/lints/homotopy-synthesis.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica Homotopy Synthesis & Linting", async () => {
  it("derives algebraic simplifications for steep nonlinearities", () => {
    const pow4 = deriveSimplification("power", "T", { power: 4, startVal: 300 });
    assert.ok(pow4.includes("108000000 * T"));

    const drag = deriveSimplification("quadratic_drag", "m_flow", { startVal: 1.5 });
    assert.ok(drag.includes("m_flow * 1.5"));

    const expSimp = deriveSimplification("exp", "v", { arg: "v / Vt" });
    assert.ok(expSimp.includes("1.0 + (v / Vt)"));
  });

  it("detects nonlinear equations and emits homotopy recommendations via Salsa", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const testModel = `
model NonlinearThermalFluid
  Real T(start=300);
  Real Q;
  Real m_flow(start=1.0);
  Real dp;
  Real v(start=0.7);
  Real i;
  Real x;
  Real u;
  parameter Real sigma = 5.67e-8;
  parameter Real k = 0.5;
  parameter Real Is = 1e-12;
  parameter Real Vt = 0.026;
  parameter Real R = 10.0;
equation
  Q = sigma * T^4;
  dp = k * m_flow * abs(m_flow);
  i = Is * (exp(v / Vt) - 1.0);
  x = homotopy(x^2, 2.0 * x - 1.0);
  u = R * i;
end NonlinearThermalFluid;
`;

    const uri = "file:///test/NonlinearThermalFluid.mo";
    ctx.load(testModel, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const homotopyDiags = diags.filter(
      (d: any) => d.code === 5010 || d.lintName === "homotopyRecommended" || d.message?.includes("homotopy"),
    );
    assert.strictEqual(homotopyDiags.length, 3);
  });
});
