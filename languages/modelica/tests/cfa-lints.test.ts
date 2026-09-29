// SPDX-License-Identifier: AGPL-3.0-or-later

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

describe("Modelica Control Flow Analysis (CFA) Linter Suite", () => {
  it("should detect M5020 when output variable is not definitely assigned on all paths", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const badCode = `
      function BadFunc
        input Real x;
        output Real y;
      algorithm
        if x > 0 then
          y := x * 2;
        end if;
      end BadFunc;
    `;

    const uri = "file:///test/BadFunc.mo";
    ctx.load(badCode, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5020 = diags.filter((d: any) => d.code === 5020 || d.message?.includes("not definitely assigned"));

    assert.ok(m5020.length > 0, "Expected M5020 for unassigned output y");
    assert.ok(m5020[0].message.includes("Output variable 'y'"));
  });

  it("should detect M5021 when local variable is read before being definitely assigned", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const uninitCode = `
      function ReadUninit
        input Real x;
        output Real y;
      protected
        Real temp;
      algorithm
        y := temp + x;
        temp := 10.0;
      end ReadUninit;
    `;

    const uri = "file:///test/ReadUninit.mo";
    ctx.load(uninitCode, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5021 = diags.filter(
      (d: any) => d.code === 5021 || d.message?.includes("read before being definitely assigned"),
    );

    assert.ok(m5021.length > 0, "Expected M5021 for reading uninitialized temp");
    assert.ok(m5021[0].message.includes("Variable 'temp'"));
  });

  it("should detect M5022 when unreachable statement follows return", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const deadCode = `
      function DeadCodeFunc
        input Real x;
        output Real y;
      algorithm
        y := x * 2;
        return;
        y := y + 1;
      end DeadCodeFunc;
    `;

    const uri = "file:///test/DeadCodeFunc.mo";
    ctx.load(deadCode, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5022 = diags.filter((d: any) => d.code === 5022 || d.message?.includes("Unreachable statement"));

    assert.ok(m5022.length > 0, "Expected M5022 for statement after return");
  });

  it("should pass cleanly when all outputs are definitely assigned on all paths", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const goodCode = `
      function GoodFunc
        input Real x;
        output Real y;
      algorithm
        if x > 0 then
          y := x * 2;
        else
          y := -x;
        end if;
      end GoodFunc;
    `;

    const uri = "file:///test/GoodFunc.mo";
    ctx.load(goodCode, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const cfaDiags = diags.filter((d: any) => d.code === 5020 || d.code === 5021 || d.code === 5022);

    assert.strictEqual(cfaDiags.length, 0, "Expected 0 CFA diagnostics for valid function");
  });

  it("should pass cleanly when if-elseif-else all assign output", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      function ElseIfGood
        input Real x;
        output Real y;
      algorithm
        if x > 10.0 then
          y := 1.0;
        elseif x > 5.0 then
          y := 2.0;
        else
          y := 3.0;
        end if;
      end ElseIfGood;
    `;

    const uri = "file:///test/ElseIfGood.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5020 = diags.filter((d: any) => d.code === 5020);
    assert.strictEqual(m5020.length, 0, "Expected 0 M5020 when all elseif/else branches assign output");
  });

  it("should detect M5020 when an elseif branch fails to assign output", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      function ElseIfBad
        input Real x;
        output Real y;
      protected
        Real z;
      algorithm
        if x > 10.0 then
          y := 1.0;
        elseif x > 5.0 then
          z := 2.0;
        else
          y := 3.0;
        end if;
      end ElseIfBad;
    `;

    const uri = "file:///test/ElseIfBad.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5020 = diags.filter((d: any) => d.code === 5020);
    assert.ok(m5020.length > 0, "Expected M5020 when an elseif branch does not assign output");
  });

  it("should handle for-loops and not report loop variables as uninitialized reads", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      function ForLoopFunc
        input Integer n;
        output Real[n] x;
      protected
        Real delta;
      algorithm
        delta := 1.0;
        for i in 1:n loop
          x[i] := i * delta;
        end for;
      end ForLoopFunc;
    `;

    const uri = "file:///test/ForLoopFunc.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const cfaDiags = diags.filter((d: any) => d.code === 5020 || d.code === 5021);
    assert.strictEqual(cfaDiags.length, 0, "Expected 0 CFA diagnostics for valid for-loop assigning array output");
  });

  it("should handle multi-output tuple assignment", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      function Helper
        output Real a;
        output Real b;
      algorithm
        a := 1.0;
        b := 2.0;
      end Helper;

      function TupleCaller
        output Real x;
        output Real y;
      algorithm
        (x, y) := Helper();
      end TupleCaller;
    `;

    const uri = "file:///test/TupleCaller.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5020 = diags.filter((d: any) => d.code === 5020);
    assert.strictEqual(m5020.length, 0, "Expected 0 M5020 when multi-output tuple assignment assigns all outputs");
  });

  it("should not flag M5020 on partial functions or functions with no algorithm", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      partial function PartialFunc
        input Real x;
        output Real y;
      end PartialFunc;

      function StubFunc
        input Real x;
        output Real y;
      end StubFunc;
    `;

    const uri = "file:///test/PartialFunc.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5020 = diags.filter((d: any) => d.code === 5020);
    assert.strictEqual(m5020.length, 0, "Expected 0 M5020 for partial function or stub function without algorithm");
  });
});
