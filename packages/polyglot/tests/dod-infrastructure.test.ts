// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Arena, StructArena } from "@modelscript/language/arena";
import { NULL_STRING_ID, StringInterner } from "@modelscript/language/interner";
import { LineIndex, type TokenData } from "@modelscript/language/line-index";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// StringInterner
// ---------------------------------------------------------------------------

describe("StringInterner", () => {
  it("interns strings and returns stable IDs", () => {
    const interner = new StringInterner();
    const id1 = interner.intern("Modelica.Blocks.Continuous.Integrator");
    const id2 = interner.intern("Modelica.Blocks.Continuous.Integrator");
    expect(id1).toBe(id2);
    expect(typeof id1).toBe("number");
  });

  it("different strings get different IDs", () => {
    const interner = new StringInterner();
    const id1 = interner.intern("Real");
    const id2 = interner.intern("Integer");
    expect(id1).not.toBe(id2);
  });

  it("resolves IDs back to strings", () => {
    const interner = new StringInterner();
    const id = interner.intern("Modelica.SIunits.Voltage");
    expect(interner.resolve(id)).toBe("Modelica.SIunits.Voltage");
  });

  it("throws on invalid ID", () => {
    const interner = new StringInterner();
    expect(() => interner.resolve(999)).toThrow(RangeError);
    expect(() => interner.resolve(-5)).toThrow(RangeError);
  });

  it("tryGet returns NULL_STRING_ID for unknown strings", () => {
    const interner = new StringInterner();
    expect(interner.tryGet("unknown")).toBe(NULL_STRING_ID);
    interner.intern("known");
    expect(interner.tryGet("known")).not.toBe(NULL_STRING_ID);
  });

  it("tracks size correctly", () => {
    const interner = new StringInterner();
    expect(interner.size).toBe(0);
    interner.intern("a");
    interner.intern("b");
    interner.intern("a"); // duplicate
    expect(interner.size).toBe(2);
  });

  it("handles large-scale interning (simulating FQN deduplication)", () => {
    const interner = new StringInterner();
    const prefix = "Modelica.Blocks.Continuous.";

    // Intern 1000 paths, many sharing the same prefix
    for (let i = 0; i < 1000; i++) {
      interner.intern(prefix + `Component_${i}`);
    }
    // Re-intern all of them — should be no-ops
    for (let i = 0; i < 1000; i++) {
      interner.intern(prefix + `Component_${i}`);
    }
    expect(interner.size).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

describe("Arena", () => {
  it("allocates and reads/writes slots", () => {
    const arena = new Arena(Int32Array, 4);
    const idx = arena.alloc();
    arena.set(idx, 42);
    expect(arena.get(idx)).toBe(42);
  });

  it("grows automatically", () => {
    const arena = new Arena(Int32Array, 2); // start tiny
    for (let i = 0; i < 100; i++) {
      const idx = arena.alloc();
      arena.set(idx, i * 10);
    }
    expect(arena.length).toBe(100);
    expect(arena.get(50)).toBe(500);
    expect(arena.capacity).toBeGreaterThanOrEqual(100);
  });

  it("supports Float64Array for real-valued data", () => {
    const arena = new Arena(Float64Array, 4);
    const idx = arena.alloc();
    arena.set(idx, 3.14159);
    expect(arena.get(idx)).toBeCloseTo(3.14159);
  });

  it("clear resets length but keeps buffer", () => {
    const arena = new Arena(Int32Array, 8);
    for (let i = 0; i < 10; i++) arena.alloc();
    expect(arena.length).toBe(10);
    const cap = arena.capacity;
    arena.clear();
    expect(arena.length).toBe(0);
    expect(arena.capacity).toBe(cap);
  });

  it("release frees the buffer", () => {
    const arena = new Arena(Int32Array, 8);
    for (let i = 0; i < 10; i++) arena.alloc();
    arena.release();
    expect(arena.length).toBe(0);
    expect(arena.estimateMemoryBytes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StructArena
// ---------------------------------------------------------------------------

describe("StructArena", () => {
  it("stores multi-field records", () => {
    // Simulate a variable record: [nameId, type, variability, startValue]
    const vars = new StructArena(Int32Array, 4, 8);
    const idx = vars.alloc();
    vars.set(idx, 0, 100); // nameId
    vars.set(idx, 1, 0); // type: Real
    vars.set(idx, 2, 2); // variability: parameter
    vars.set(idx, 3, 42); // startValue (as int for this test)

    expect(vars.get(idx, 0)).toBe(100);
    expect(vars.get(idx, 1)).toBe(0);
    expect(vars.get(idx, 2)).toBe(2);
    expect(vars.get(idx, 3)).toBe(42);
  });

  it("grows correctly with stride > 1", () => {
    const arena = new StructArena(Int32Array, 6, 2); // 2 records initially
    for (let i = 0; i < 50; i++) {
      const idx = arena.alloc();
      for (let f = 0; f < 6; f++) {
        arena.set(idx, f, i * 100 + f);
      }
    }
    expect(arena.length).toBe(50);
    // Verify last record
    expect(arena.get(49, 0)).toBe(4900);
    expect(arena.get(49, 5)).toBe(4905);
  });
});

// ---------------------------------------------------------------------------
// LineIndex
// ---------------------------------------------------------------------------

describe("LineIndex", () => {
  it("finds tokens by line and column", () => {
    // Simulate: "x = y + z;\n"
    // Line 0: x (col 0-1), = (col 2-3), y (col 4-5), + (col 6-7), z (col 8-9)
    const tokens: TokenData[] = [
      { line: 0, startCol: 0, endCol: 1, nodeId: 10 },
      { line: 0, startCol: 2, endCol: 3, nodeId: 20 },
      { line: 0, startCol: 4, endCol: 5, nodeId: 30 },
      { line: 0, startCol: 6, endCol: 7, nodeId: 40 },
      { line: 0, startCol: 8, endCol: 9, nodeId: 50 },
    ];
    const index = new LineIndex(1, tokens);

    expect(index.nodeAt(0, 0)).toBe(10); // 'x'
    expect(index.nodeAt(0, 4)).toBe(30); // 'y'
    expect(index.nodeAt(0, 8)).toBe(50); // 'z'
    expect(index.nodeAt(0, 3)).toBe(-1); // whitespace between = and y
  });

  it("handles multiple lines", () => {
    const tokens: TokenData[] = [
      { line: 0, startCol: 0, endCol: 5, nodeId: 1 }, // "model"
      { line: 1, startCol: 2, endCol: 6, nodeId: 2 }, // "Real"
      { line: 1, startCol: 7, endCol: 8, nodeId: 3 }, // "x"
      { line: 2, startCol: 0, endCol: 8, nodeId: 4 }, // "equation"
    ];
    const index = new LineIndex(3, tokens);

    expect(index.nodeAt(0, 2)).toBe(1);
    expect(index.nodeAt(1, 3)).toBe(2);
    expect(index.nodeAt(1, 7)).toBe(3);
    expect(index.nodeAt(2, 4)).toBe(4);
  });

  it("returns -1 for empty lines", () => {
    const tokens: TokenData[] = [
      { line: 0, startCol: 0, endCol: 5, nodeId: 1 },
      // line 1 is empty
      { line: 2, startCol: 0, endCol: 3, nodeId: 2 },
    ];
    const index = new LineIndex(3, tokens);

    expect(index.nodeAt(1, 0)).toBe(-1);
    expect(index.nodeAt(1, 5)).toBe(-1);
  });

  it("returns -1 for out-of-bounds lines", () => {
    const index = new LineIndex(2, [{ line: 0, startCol: 0, endCol: 1, nodeId: 1 }]);
    expect(index.nodeAt(-1, 0)).toBe(-1);
    expect(index.nodeAt(5, 0)).toBe(-1);
  });

  it("tokensOnLine returns all tokens", () => {
    const tokens: TokenData[] = [
      { line: 0, startCol: 0, endCol: 3, nodeId: 1 },
      { line: 0, startCol: 4, endCol: 7, nodeId: 2 },
      { line: 1, startCol: 0, endCol: 5, nodeId: 3 },
    ];
    const index = new LineIndex(2, tokens);

    const line0 = index.tokensOnLine(0);
    expect(line0.length).toBe(2);
    expect(line0[0]!.nodeId).toBe(1);
    expect(line0[1]!.nodeId).toBe(2);

    const line1 = index.tokensOnLine(1);
    expect(line1.length).toBe(1);
  });

  it("reports memory usage", () => {
    const tokens: TokenData[] = [];
    for (let i = 0; i < 1000; i++) {
      tokens.push({ line: Math.floor(i / 10), startCol: (i % 10) * 5, endCol: (i % 10) * 5 + 4, nodeId: i });
    }
    const index = new LineIndex(100, tokens);
    const mem = index.estimateMemoryBytes();
    // 1000 tokens × (2+2+4 bytes) + 101 lines × 4 bytes ≈ 8404 bytes
    expect(mem).toBeGreaterThan(8000);
    expect(mem).toBeLessThan(12000);
  });
});
