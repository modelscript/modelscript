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

describe("Phase 8: Batch CLI Mode", () => {
  it("Context.createBatch() creates a zero-memo context", () => {
    const ctx = Context.createBatch(new NodeFileSystem());
    expect(ctx).toBeDefined();
  });

  it("flattenArena works correctly in batch mode", async () => {
    const ctx = Context.createBatch(new NodeFileSystem());

    const tempFile = join("/tmp", "dod_phase8_test.mo");
    writeFileSync(
      tempFile,
      `
      model BatchTest
        Real x(start = 1.0);
        parameter Real k = 2.0;
      equation
        der(x) = -k * x;
      end BatchTest;
    `,
    );

    await ctx.addLibrary(tempFile);
    const arena = ctx.flattenArena("BatchTest");

    expect(arena).not.toBeNull();
    if (!arena) throw new Error("Arena is null");

    // Validate that flattening produced correct output
    expect(arena.varCount).toBeGreaterThanOrEqual(2); // x and k
    expect(arena.eqCount).toBeGreaterThanOrEqual(1);
  });

  it("gcBetweenPhases() is a safe no-op without --expose-gc", () => {
    // Should not throw
    expect(() => Context.gcBetweenPhases()).not.toThrow();
  });
});
