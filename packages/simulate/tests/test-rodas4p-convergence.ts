// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { rodas4p, rosenbrock23, solveRodas4P, solveRosenbrock23 } from "../src/solvers/rodas4p.js";

console.log("=== Testing True 6-Stage RODAS4P vs Rosenbrock23 ===");

// Stiff Van der Pol Oscillator (mu = 10)
// dy1/dt = y2
// dy2/dt = mu * (1 - y1^2) * y2 - y1
const mu = 10.0;
const vdp = (_t: number, y: number[]) => {
  const y1 = y[0] ?? 0;
  const y2 = y[1] ?? 0;
  return [y2, mu * (1.0 - y1 * y1) * y2 - y1];
};

const y0 = [2.0, 0.0];
const tSpan: [number, number] = [0.0, 5.0];

// 1. Solve with true 6-stage RODAS4P
console.log("Solving Stiff Van der Pol with 6-stage RODAS4P...");
const resRodas4P = rodas4p(vdp, tSpan[0], y0, tSpan[1], undefined, {
  atol: 1e-6,
  rtol: 1e-6,
});
console.log(
  `  ✓ RODAS4P accepted steps: ${resRodas4P.stats.acceptedSteps}, rejected: ${resRodas4P.stats.rejectedSteps}`,
);
assert(resRodas4P.stats.converged, "RODAS4P must converge on Van der Pol");
assert(resRodas4P.states.length > 5, "RODAS4P must produce trajectory");

// 2. Solve with 2-stage Rosenbrock23
console.log("Solving Stiff Van der Pol with 2-stage Rosenbrock23...");
const resRosenbrock23 = rosenbrock23(vdp, tSpan[0], y0, tSpan[1], undefined, {
  atol: 1e-6,
  rtol: 1e-6,
});
console.log(
  `  ✓ Rosenbrock23 accepted steps: ${resRosenbrock23.stats.acceptedSteps}, rejected: ${resRosenbrock23.stats.rejectedSteps}`,
);
assert(resRosenbrock23.stats.converged, "Rosenbrock23 must converge on Van der Pol");

// Compare final states
const final4P = resRodas4P.states[resRodas4P.states.length - 1]!;
const final23 = resRosenbrock23.states[resRosenbrock23.states.length - 1]!;
const diffY1 = Math.abs((final4P[0] ?? 0) - (final23[0] ?? 0));
const diffY2 = Math.abs((final4P[1] ?? 0) - (final23[1] ?? 0));
console.log(`  ✓ Final state difference: |Δy1| = ${diffY1.toExponential(4)}, |Δy2| = ${diffY2.toExponential(4)}`);
assert(diffY1 < 1e-3, "Final states between RODAS4P and Rosenbrock23 must agree within tolerance");

// 3. Test solveRodas4P and solveRosenbrock23 helper wrappers
const prob = { f: vdp, y0, tSpan };
const wrap4P = solveRodas4P(prob, { atol: 1e-5, rtol: 1e-5 });
const wrap23 = solveRosenbrock23(prob, { atol: 1e-5, rtol: 1e-5 });
assert(wrap4P.stats.converged && wrap23.stats.converged, "Problem wrappers must converge");

console.log("RODAS4P and Rosenbrock23 verified successfully!");
