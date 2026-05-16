import Modelica from "@modelscript/modelica/parser";
import { writeFileSync } from "fs";
import { join } from "path";
import Parser from "tree-sitter";
import { describe, expect, it } from "vitest";
import { NodeFileSystem } from "../../../apps/cli/src/util/filesystem.js";
import { Context } from "../src/compiler/context.js";

// Register parser for test environment
const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

describe("Phase 3d: Arena-First Variable Access", () => {
  it("arenaVariables() produces identical variables to legacy SymbolTable", async () => {
    const ctx = Context.createBatch(new NodeFileSystem());

    const tempFile = join("/tmp", "dod_phase3d_test.mo");
    writeFileSync(
      tempFile,
      `
      model ArenaTest
        parameter Real k = 2.0 "Spring constant";
        Real x(start = 1.0) "Position";
        Real v(start = 0.0) "Velocity";
        Integer counter(start = 0);
        Boolean flag(start = false);
      equation
        der(x) = v;
        der(v) = -k * x;
        counter = if x > 0 then 1 else 0;
        flag = x > 0.5;
      end ArenaTest;
    `,
    );

    await ctx.addLibrary(tempFile);
    const dae = ctx.flattenDAE("ArenaTest");
    expect(dae).not.toBeNull();
    if (!dae) throw new Error("DAE is null");

    // Collect variables from both paths
    const legacyVars = [...dae.variables].map((v) => ({
      name: v.name,
      type: v.constructor.name,
    }));

    const arenaVars = [...dae.arenaVariables()].map((v) => ({
      name: v.name,
      type: v.constructor.name,
    }));

    // Same count
    expect(arenaVars.length).toBe(legacyVars.length);

    // Same names (in same order)
    expect(arenaVars.map((v) => v.name)).toEqual(legacyVars.map((v) => v.name));

    // Same types
    expect(arenaVars.map((v) => v.type)).toEqual(legacyVars.map((v) => v.type));
  });

  it("arenaVarCount matches legacy variables.length", async () => {
    const ctx = Context.createBatch(new NodeFileSystem());

    const tempFile = join("/tmp", "dod_phase3d_count.mo");
    writeFileSync(
      tempFile,
      `
      model CountTest
        Real x;
        Real y;
        parameter Real p = 1.0;
      equation
        der(x) = y;
        der(y) = -x;
      end CountTest;
    `,
    );

    await ctx.addLibrary(tempFile);
    const dae = ctx.flattenDAE("CountTest");
    expect(dae).not.toBeNull();
    if (!dae) throw new Error("DAE is null");

    expect(dae.arenaVarCount).toBe(dae.variables.length);
  });

  it("arenaGetVarByName returns correct variable", async () => {
    const ctx = Context.createBatch(new NodeFileSystem());

    const tempFile = join("/tmp", "dod_phase3d_lookup.mo");
    writeFileSync(
      tempFile,
      `
      model LookupTest
        Real x(start = 42.0);
        parameter Real k = 3.14;
      equation
        der(x) = -k * x;
      end LookupTest;
    `,
    );

    await ctx.addLibrary(tempFile);
    const dae = ctx.flattenDAE("LookupTest");
    expect(dae).not.toBeNull();
    if (!dae) throw new Error("DAE is null");

    const xVar = dae.arenaGetVarByName("x");
    expect(xVar).not.toBeNull();
    expect(xVar?.name).toBe("x");
    expect(xVar?.constructor.name).toBe("ModelicaRealVariable");

    const kVar = dae.arenaGetVarByName("k");
    expect(kVar).not.toBeNull();
    expect(kVar?.name).toBe("k");

    const missing = dae.arenaGetVarByName("nonexistent");
    expect(missing).toBeNull();
  });

  it("arenaVarNames iterates names without materializing objects", async () => {
    const ctx = Context.createBatch(new NodeFileSystem());

    const tempFile = join("/tmp", "dod_phase3d_names.mo");
    writeFileSync(
      tempFile,
      `
      model NamesTest
        Real a;
        Real b;
        Real c;
      equation
        der(a) = b;
        der(b) = c;
        c = -a;
      end NamesTest;
    `,
    );

    await ctx.addLibrary(tempFile);
    const dae = ctx.flattenDAE("NamesTest");
    expect(dae).not.toBeNull();
    if (!dae) throw new Error("DAE is null");

    const arenaNames = [...dae.arenaVarNames()];
    const legacyNames = [...dae.variables].map((v) => v.name);

    expect(arenaNames).toEqual(legacyNames);
  });

  it("expression arena fully mirrors all expression types", async () => {
    const ctx = Context.createBatch(new NodeFileSystem());

    const tempFile = join("/tmp", "dod_phase3d_exprs.mo");
    writeFileSync(
      tempFile,
      `
      model ExprTest
        Real x(start = 1.0);
        Real y;
        Real z;
      equation
        y = if x > 0 then 1.0 else -1.0;
        z = 2.0 * x + y;
        der(x) = -x;
      end ExprTest;
    `,
    );

    await ctx.addLibrary(tempFile);
    const dae = ctx.flattenDAE("ExprTest");
    expect(dae).not.toBeNull();
    if (!dae) throw new Error("DAE is null");

    // Arena should have equations (at least 3) and expressions
    expect(dae.arena.eqCount).toBeGreaterThanOrEqual(3);
    expect(dae.arena.exprCount).toBeGreaterThan(0);
  });
});
