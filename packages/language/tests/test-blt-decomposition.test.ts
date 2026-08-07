import { describe, expect, test } from "@jest/globals";
import { generateBlt } from "../src/codegen/blt.js";

describe("BLT Decomposition Generator", () => {
  test("generates Hopcroft-Karp & Tarjan SCC BLT code template", () => {
    const code = generateBlt();

    expect(code).toContain("export function initBlt");
    expect(code).toContain("export function runHopcroftKarp");
    expect(code).toContain("export function runTarjanScc");
    expect(code).toContain("incidenceMatrixOffset");
  });
});
