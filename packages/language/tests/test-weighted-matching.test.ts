import { describe, expect, test } from "@jest/globals";
import { generateBlt } from "../src/codegen/blt.js";

describe("Isolatability-Aware Weighted Bipartite Matching", () => {
  test("generates weighted incidence matrix functions in BLT template", () => {
    const code = generateBlt();

    expect(code).toContain("export function addEdge");
    expect(code).toContain("weight: u8 = 0");
    expect(code).toContain("export function getEdgeWeight");
    expect(code).toContain("incidenceMatrixOffset");
  });
});
