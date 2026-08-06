import { describe, expect, test } from "@jest/globals";
import { generateSimplex } from "../src/codegen/simplex.js";

describe("Simplex LP Solver Generator", () => {
  test("generates LRA Simplex tableau implementation in AssemblyScript", () => {
    const code = generateSimplex();
    expect(code).toContain("export function initSimplexArena");
    expect(code).toContain("export function addLinearConstraint");
    expect(code).toContain("export function pivotSimplex");
    expect(code).toContain("export function checkSimplexFeasibility");
    expect(code).toContain("export function extractUnsatCore");
  });
});
