import Modelica from "@modelscript/modelica/parser";
import { writeFileSync } from "fs";
import { join } from "path";
import Parser from "tree-sitter";
import { describe, expect, it } from "vitest";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

// Register parser for test environment
const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

describe("Phase 3: Flattener Dual-Write Validation", () => {
  it("populates ArenaDAEBuilder alongside ModelicaDAE during flattening", async () => {
    const ctx = new Context(new NodeFileSystem());

    // Create a temporary Modelica file
    const tempFile = join("/tmp", "dod_phase3_test.mo");
    writeFileSync(
      tempFile,
      `
      model BouncingBall
        Real h(start=1.0);
        Real v;
        parameter Real g = 9.81;
      equation
        der(h) = v;
        der(v) = -g;
        when h < 0.0 then
          reinit(v, -0.9 * pre(v));
        end when;
      end BouncingBall;
    `,
    );

    await ctx.addLibrary(tempFile);
    const dae = ctx.flattenDAE("BouncingBall");

    expect(dae).not.toBeNull();
    if (!dae) throw new Error("DAE is null");

    // 1. Validate variable counts
    const objectVarCount = (dae.variables as unknown as { _items: unknown[] })["_items"].length;
    const arenaVarCount = dae.arena.varCount;
    expect(arenaVarCount).toBe(objectVarCount);

    // 2. Validate equation counts
    const arenaEqCount = dae.arena.eqCount;
    const totalObjectEqCount = dae.equations.length + dae.whenClauses.length;
    expect(arenaEqCount).toBeGreaterThanOrEqual(totalObjectEqCount);

    // 3. Spot-check variable mappings
    const vIdx = Array.from({ length: arenaVarCount }).findIndex((_, i) => dae.arena.getVarName(i) === "v");
    expect(vIdx).toBeGreaterThanOrEqual(0);

    const hIdx = Array.from({ length: arenaVarCount }).findIndex((_, i) => dae.arena.getVarName(i) === "h");
    expect(dae.arena.getVarStartValue(hIdx)).toBe(1.0);

    const gIdx = Array.from({ length: arenaVarCount }).findIndex((_, i) => dae.arena.getVarName(i) === "g");
    expect(dae.arena.getVarStartValue(gIdx)).toBe(9.81);

    // 4. Validate memory footprint estimation
    expect(dae.arena.estimateMemoryBytes()).toBeGreaterThan(0);
    expect(dae.arena.estimateMemoryBytes()).toBeLessThan(200000); // very small
  });
});
