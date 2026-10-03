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

describe("Modelica Component Binding Restriction Linter Suite (M4029)", () => {
  it("should detect M4029 when package component has a binding equation (e.g. parameter Modelica.Electrical e = 0.8)", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      package Modelica
        package Electrical
          constant Real version = 1.0;
        end Electrical;
      end Modelica;

      model BouncingBall "A bouncing ball"
        parameter Modelica.Electrical e = 0.8 "Coefficient of restitution";
      end BouncingBall;
    `;

    const uri = "file:///test/BouncingBall.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m4029 = diags.filter(
      (d: any) =>
        d.code === 4029 || d.message?.includes("may not have a binding equation due to class specialization 'package'"),
    );

    assert.ok(m4029.length > 0, "Expected M4029 for package binding restriction on component 'e'");
    assert.match(
      m4029[0].message,
      /Component 'e' may not have a binding equation due to class specialization 'package'/,
    );
  });

  it("should detect M4029 for PackageBinding1 test case (A a2 = a1 where A is a package)", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      package A
        constant Real x = 1.0;
      end A;

      model PackageBinding1
        A a1;
        A a2 = a1;
      end PackageBinding1;
    `;

    const uri = "file:///test/PackageBinding1.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m4029 = diags.filter(
      (d: any) =>
        d.code === 4029 || d.message?.includes("may not have a binding equation due to class specialization 'package'"),
    );

    assert.ok(m4029.length > 0, "Expected M4029 for package binding restriction on component 'a2'");
    assert.match(
      m4029[0].message,
      /Component 'a2' may not have a binding equation due to class specialization 'package'/,
    );
  });

  it("should detect M4029 when model component has a scalar binding equation", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      model SubModel
        Real x;
      end SubModel;

      model ModelBinding1
        SubModel m = 1.0;
      end ModelBinding1;
    `;

    const uri = "file:///test/ModelBinding1.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m4029 = diags.filter(
      (d: any) =>
        d.code === 4029 || d.message?.includes("may not have a binding equation due to class specialization 'model'"),
    );

    assert.ok(m4029.length > 0, "Expected M4029 for model binding restriction on component 'm'");
    assert.match(m4029[0].message, /Component 'm' may not have a binding equation due to class specialization 'model'/);
  });

  it("should not produce M4029 for valid primitive parameter bindings", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      model ValidBall
        parameter Real e = 0.8 "Coefficient of restitution";
      end ValidBall;
    `;

    const uri = "file:///test/ValidBall.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m4029 = diags.filter((d: any) => d.code === 4029);
    assert.equal(m4029.length, 0, "Did not expect M4029 for valid Real parameter");
  });
});
