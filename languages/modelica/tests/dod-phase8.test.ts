import { createWasmParser } from "@modelscript/language";
import { unlinkSync, writeFileSync } from "fs";
import assert from "node:assert";
import { describe, it } from "node:test";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelicaWasm = join(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

describe("Phase 8: Batch CLI Mode", () => {
  it("Context.createBatch() creates a zero-memo context", () => {
    const ctx = Context.createBatch(new NodeFileSystem());
    assert.ok(ctx);
  });

  it("flattenArena works correctly in batch mode", async () => {
    const ctx = Context.createBatch(new NodeFileSystem());

    const tempFile = join(__dirname, "dod_phase8_test.mo");
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

    try {
      await ctx.addLibrary(tempFile);
      const arena = ctx.flattenArena("BatchTest");

      assert.ok(arena);
      // Validate that flattening produced correct output
      assert.ok(arena.varCount >= 2); // x and k
      assert.ok(arena.eqCount >= 1);
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore errors if tempFile was already deleted
      }
    }
  });

  it("gcBetweenPhases() is a safe no-op without --expose-gc", () => {
    // Should not throw
    assert.doesNotThrow(() => Context.gcBetweenPhases());
  });
});
