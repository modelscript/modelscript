import { describe, expect, test } from "@jest/globals";
import { generateJacobianColoring } from "../src/codegen/coloring.js";

describe("Distance-2 Graph Coloring Generator", () => {
  test("generates Curtis-Powell-Reid graph coloring function", () => {
    const code = generateJacobianColoring();
    expect(code).toContain("export function colorJacobian");
    expect(code).toContain("conflictMatrixPtr");
    expect(code).toContain("usedColorsPtr");
  });
});
