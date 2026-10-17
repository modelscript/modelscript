// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import { EqKind, initBltWasm, printArenaDAE, scalarizeArena } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica Array Preservation in WASM Flattener", async () => {
  it("preserves multidimensional array declarations without premature scalarization and simulates via auto-scalarization", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    await initBltWasm();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-arr-test-"));
    const tempMoPath = path.join(tempDir, "VectorODE.mo");
    const modelContent = `model VectorODE
  parameter Integer N = 10;
  Real x[N](start = ones(N));
equation
  der(x) = -x;
end VectorODE;
`;
    fs.writeFileSync(tempMoPath, modelContent, "utf8");

    try {
      const contextPreserve = Context.createBatch(new NodeFileSystem());
      await contextPreserve.addLibrary(tempMoPath);
      const daePreserve = contextPreserve.flattenArena("VectorODE", undefined, undefined, { arrayMode: "preserve" });
      assert.ok(daePreserve);

      assert.strictEqual(daePreserve.varCount, 2);
      assert.strictEqual(daePreserve.eqCount, 1);
      assert.strictEqual(daePreserve.getVarTotalScalarElements(), 11);

      const xVarIdx = daePreserve.getVarIdxByName("x");
      assert.ok(xVarIdx >= 0);
      const shape = daePreserve.getVarShape(xVarIdx);
      assert.deepStrictEqual(shape, [10]);
      assert.strictEqual(daePreserve.getVarShapeElementCount(xVarIdx), 10);
      assert.strictEqual(daePreserve.getVarIdxByName("x[1]"), -1);

      // End-to-end simulation of preserved DAE (auto-scalarizes x[1..10] with start = ones(10))
      const res = simulateArena(daePreserve, { startTime: 0, stopTime: 1, numberOfIntervals: 20 });
      const x1StateIdx = res.states.indexOf("x[1]");
      assert.ok(x1StateIdx >= 0, `Expected x[1] in simulated states, got: ${res.states.join(", ")}`);
      const x1Start = res.y[0]?.[x1StateIdx] ?? 0;
      const x1End = res.y[res.y.length - 1]?.[x1StateIdx] ?? 0;
      assert.ok(Math.abs(x1Start - 1.0) < 1e-6, `Expected x[1](0) = 1.0, got ${x1Start}`);
      assert.ok(Math.abs(x1End - Math.exp(-1)) < 1e-2, `Expected x[1](1) ≈ e^-1, got ${x1End}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves for_equation loops (including >5000 iterations) as EqKind.For and unrolls in scalarizeArena", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    await initBltWasm();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-arr-for-"));
    const tempMoPath = path.join(tempDir, "ForPreserve.mo");
    const modelContent = `model ForPreserve
  parameter Integer N = 4;
  Real x[N];
  Real big[6000];
initial equation
  for i in 1:N loop
    x[i] = i;
  end for;
equation
  for i in 1:N loop
    der(x[i]) = -x[i];
  end for;
  for j in 1:6000 loop
    big[j] = 2.0;
  end for;
end ForPreserve;
`;
    fs.writeFileSync(tempMoPath, modelContent, "utf8");

    try {
      const ctx = Context.createBatch(new NodeFileSystem());
      await ctx.addLibrary(tempMoPath);
      const dae = ctx.flattenArena("ForPreserve", undefined, undefined, { arrayMode: "preserve" });
      assert.ok(dae);

      // Equations should be preserved as EqKind.InitialFor and EqKind.For (3 total equations, not 12008 or dropped!)
      assert.strictEqual(dae.eqCount, 3);
      const eqKinds = [dae.getEqKind(0), dae.getEqKind(1), dae.getEqKind(2)];
      assert.ok(eqKinds.includes(EqKind.InitialFor), "Expected EqKind.InitialFor");
      assert.ok(eqKinds.includes(EqKind.For), "Expected EqKind.For");

      const printed = printArenaDAE(dae);
      assert.ok(printed.includes("for i in 1:N loop"), `Expected preserved loop in printed DAE:\n${printed}`);
      assert.ok(
        printed.includes("for j in 1:6000 loop"),
        `Expected >5000 loop to be preserved, not dropped:\n${printed}`,
      );

      // Test unrolling in scalarizeArena on a smaller model with parameter N
      const smallMoPath = path.join(tempDir, "SmallFor.mo");
      fs.writeFileSync(
        smallMoPath,
        `model SmallFor
  parameter Integer N = 3;
  Real x[N];
initial equation
  for i in 1:N loop
    x[i] = 2.0;
  end for;
equation
  for i in 1:N loop
    der(x[i]) = -x[i];
  end for;
end SmallFor;
`,
        "utf8",
      );
      await ctx.addLibrary(smallMoPath);
      const smallDae = ctx.flattenArena("SmallFor", undefined, undefined, { arrayMode: "preserve" });
      assert.ok(smallDae);
      assert.strictEqual(smallDae.eqCount, 2);

      const scalarized = scalarizeArena(smallDae);
      assert.strictEqual(scalarized.varCount, 4); // N + x[1..3]
      assert.strictEqual(scalarized.eqCount, 6);
      assert.ok(scalarized.getVarIdxByName("x[1]") >= 0);
      assert.ok(scalarized.getVarIdxByName("x[2]") >= 0);
      assert.ok(scalarized.getVarIdxByName("x[3]") >= 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("isolates Context.flattenArena cache across arrayMode and respects preserve mode on wasm backend", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    await initBltWasm();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-arr-cache-"));
    const tempMoPath = path.join(tempDir, "CacheModel.mo");
    fs.writeFileSync(
      tempMoPath,
      `model CacheModel
  parameter Real x[3] = zeros(3);
  Real y[3];
equation
  y = x / 2.0;
end CacheModel;
`,
      "utf8",
    );

    try {
      const ctx = Context.createBatch(new NodeFileSystem());
      await ctx.addLibrary(tempMoPath);

      // 1. Flatten with preserve mode on wasm backend (must not scalarize in WASM)
      const preserved = ctx.flattenArena("CacheModel", undefined, undefined, {
        backend: "wasm",
        arrayMode: "preserve",
      });
      assert.ok(preserved);
      assert.strictEqual(preserved.varCount, 2);
      assert.strictEqual(preserved.eqCount, 1);
      const printedPreserved = printArenaDAE(preserved);
      assert.ok(printedPreserved.includes("zeros(3)"), `Expected preserved zeros(3) call, got:\n${printedPreserved}`);
      assert.ok(
        printedPreserved.includes("y = x * 0.5") || printedPreserved.includes("y = x / 2.0"),
        `Expected preserved vector equation for y, got:\n${printedPreserved}`,
      );

      // 2. Flatten same model on same Context with scalarize mode (must not return cached preserved DAE)
      const scalarized = ctx.flattenArena("CacheModel", undefined, undefined, {
        backend: "wasm",
        arrayMode: "scalarize",
      });
      assert.ok(scalarized);
      assert.strictEqual(scalarized.varCount, 6);
      assert.ok(scalarized.getVarIdxByName("x[1]") >= 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("combines subscripts on SoA composite array variables (b[i].c[10] -> b.c[i,10] and b[i].x -> b.x[i])", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    await initBltWasm();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-arr-soa-"));
    const tempMoPath = path.join(tempDir, "CombineSoA.mo");
    fs.writeFileSync(
      tempMoPath,
      `model SubComp
  Real[10] c;
  Real x;
end SubComp;

model CombineSoA
  SubComp[5] b;
equation
  for i in 1:5 loop
    b[i].c[10] = 2.0;
    b[i].x = 1.0;
  end for;
end CombineSoA;
`,
      "utf8",
    );

    try {
      const ctx = Context.createBatch(new NodeFileSystem());
      await ctx.addLibrary(tempMoPath);
      const dae = ctx.flattenArena("CombineSoA", undefined, undefined, { arrayMode: "preserve" });
      assert.ok(dae);

      const bcIdx = dae.getVarIdxByName("b.c");
      assert.ok(bcIdx >= 0);
      assert.deepStrictEqual(dae.getVarShape(bcIdx), [5, 10]);

      const bxIdx = dae.getVarIdxByName("b.x");
      assert.ok(bxIdx >= 0);
      assert.deepStrictEqual(dae.getVarShape(bxIdx), [5]);

      const printed = printArenaDAE(dae);
      assert.ok(printed.includes("Real[5, 10] b.c;"), `Expected Real[5, 10] b.c declaration, got:\n${printed}`);
      assert.ok(printed.includes("Real[5] b.x;"), `Expected Real[5] b.x declaration, got:\n${printed}`);
      assert.ok(printed.includes("b.c[i,10] = 2.0;"), `Expected combined SoA subscript b.c[i,10], got:\n${printed}`);
      assert.ok(printed.includes("b.x[i] = 1.0;"), `Expected combined SoA subscript b.x[i], got:\n${printed}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
