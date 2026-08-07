import { describe, expect, test } from "@jest/globals";
import { generateNewtonSolver } from "../src/codegen/newton.js";

describe("Non-Linear Newton-Raphson Solver Generator", () => {
  test("generates Newton-Raphson solver code template with line search", () => {
    const code = generateNewtonSolver();

    expect(code).toContain("export function solveNewtonRaphson");
    expect(code).toContain("evalEquationResidual");
    expect(code).toContain("solveLUInPlace");
    expect(code).toContain("Backtracking Line Search");
  });
});
