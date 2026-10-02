// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import type { ExtractedConstraint } from "../src/constraint-extractor.js";
import { RealSimplexSolver, parseLinearExpression } from "../src/real-simplex.js";
import { verifyConstraintSet } from "../src/smt-bridge.js";

console.log("=== Testing Real-Algebraic Simplex Solver (QF_LRA Engine) ===");

// 1. Test linear expression parser
const p1 = parseLinearExpression("2.5*x + 3*y - 1.25*z");
assert.strictEqual(p1.terms.length, 3);
assert.strictEqual(p1.terms[0]!.varName, "x");
assert.strictEqual(p1.terms[0]!.coeff, 2.5);
assert.strictEqual(p1.terms[1]!.varName, "y");
assert.strictEqual(p1.terms[1]!.coeff, 3);
assert.strictEqual(p1.terms[2]!.varName, "z");
assert.strictEqual(p1.terms[2]!.coeff, -1.25);
console.log("  ✓ Linear expression parsing: OK");

// 2. Test multi-variable feasibility:
// x + y <= 10.0
// 2*x + y <= 15.0
// x >= 2.0, y >= 2.0
const solver = new RealSimplexSolver();
solver.addConstraint({
  terms: [
    { varName: "x", coeff: 1 },
    { varName: "y", coeff: 1 },
  ],
  operator: "<=",
  rhs: 10.0,
});
solver.addConstraint({
  terms: [
    { varName: "x", coeff: 2 },
    { varName: "y", coeff: 1 },
  ],
  operator: "<=",
  rhs: 15.0,
});
solver.setBound("x", 2.0, 10.0);
solver.setBound("y", 2.0, 10.0);

const sol1 = solver.solve();
assert.strictEqual(sol1.isFeasible, true, "Feasible system must be solved successfully");
assert(sol1.assignment !== undefined);
assert(sol1.assignment["x"]! >= 2.0 && sol1.assignment["x"]! <= 10.0);
assert(sol1.assignment["y"]! >= 2.0 && sol1.assignment["y"]! <= 10.0);
assert(sol1.assignment["x"]! + sol1.assignment["y"]! <= 10.0 + 1e-9);
assert(2 * sol1.assignment["x"]! + sol1.assignment["y"]! <= 15.0 + 1e-9);
console.log("  ✓ Linear Real Arithmetic feasibility & assignment: OK");

// 3. Test multi-variable contradiction & Unsat Core extraction
// System:
// Req_Budget: x + y + z <= 10.0
// Req_MinX: x >= 4.0
// Req_MinY: y >= 4.0
// Req_MinZ: z >= 3.0
// Minimum sum is 4 + 4 + 3 = 11 > 10!
const conflictingConstraints: ExtractedConstraint[] = [
  {
    requirementName: "Req_Budget",
    expression: "x + y + z <= 10.0",
    lhs: "x + y + z",
    operator: "<=",
    rhs: 10.0,
    source: "sysml2",
  },
  {
    requirementName: "Req_MinX",
    expression: "x >= 4.0",
    lhs: "x",
    operator: ">=",
    rhs: 4.0,
    source: "sysml2",
  },
  {
    requirementName: "Req_MinY",
    expression: "y >= 4.0",
    lhs: "y",
    operator: ">=",
    rhs: 4.0,
    source: "sysml2",
  },
  {
    requirementName: "Req_MinZ",
    expression: "z >= 3.0",
    lhs: "z",
    operator: ">=",
    rhs: 3.0,
    source: "sysml2",
  },
];

const checkRes = verifyConstraintSet(conflictingConstraints);
assert.strictEqual(checkRes.isConsistent, false, "Over-allocated multi-variable budget must be infeasible");
assert(checkRes.conflictingRequirements.length > 0, "Conflicting requirements must be identified");
assert(
  checkRes.conflictingRequirements.includes("Req_Budget") || checkRes.conflictingRequirements.includes("Req_MinZ"),
);
console.log("  ✓ Multi-variable linear budget contradiction detection: OK");

// 4. Test exact strict inequality contradiction without epsilon approximation (x < 1 && x >= 1)
const strictSolver = new RealSimplexSolver();
strictSolver.addConstraint({
  terms: [{ varName: "x", coeff: 1 }],
  operator: "<",
  rhs: 1,
});
strictSolver.addConstraint({
  terms: [{ varName: "x", coeff: 1 }],
  operator: ">=",
  rhs: 1,
});
const strictRes = strictSolver.solve();
assert.strictEqual(strictRes.isFeasible, false, "x < 1 and x >= 1 must be strictly UNSAT via R(delta)");
console.log("  ✓ Exact infinitesimal R(delta) strict inequality contradiction: OK");

// 5. Test micro-scale strict inequality below epsilon threshold: x < 1e-12 && x >= 1e-12
const microSolver = new RealSimplexSolver();
microSolver.addConstraint({
  terms: [{ varName: "v", coeff: 1 }],
  operator: "<",
  rhs: 1e-12,
});
microSolver.addConstraint({
  terms: [{ varName: "v", coeff: 1 }],
  operator: ">=",
  rhs: 1e-12,
});
const microRes = microSolver.solve();
assert.strictEqual(microRes.isFeasible, false, "Micro-scale strict inequalities must be UNSAT without epsilon failure");
console.log("  ✓ Micro-scale precision below 1e-9 verified via R(delta): OK");

// 6. Test scientific notation parsing and solving
const sciExpr = parseLinearExpression("1.2e-4*x + 3.5e-2*y - 5.0e-3");
assert.strictEqual(sciExpr.terms.length, 2);
assert.strictEqual(sciExpr.terms[0]!.varName, "x");
assert.strictEqual(sciExpr.terms[0]!.coeff, 1.2e-4);
assert.strictEqual(sciExpr.terms[1]!.varName, "y");
assert.strictEqual(sciExpr.terms[1]!.coeff, 3.5e-2);
assert.strictEqual(sciExpr.constant, -5.0e-3);

const sciSolver = new RealSimplexSolver();
sciSolver.addConstraint({
  terms: sciExpr.terms,
  operator: "<=",
  rhs: 10.0,
});
sciSolver.setBound("x", 0, 100);
sciSolver.setBound("y", 0, 100);
const sciRes = sciSolver.solve();
assert.strictEqual(sciRes.isFeasible, true, "Scientific notation constraints must be feasible");
console.log("  ✓ Scientific notation parsing and solving: OK");

console.log("Real-Algebraic Simplex Solver verified successfully!");
