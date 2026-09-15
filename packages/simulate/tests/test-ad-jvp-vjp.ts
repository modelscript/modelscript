// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, UnaryOp, VarType, Variability, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { ArenaSimulator, jvp, vjp } from "../src/core/index.js";

async function main() {
  console.log("=== Testing Composable Autodiff Primitives (jvp & vjp) ===");
  await initBltWasm();

  // Model: Damped Non-linear Oscillator
  //   der(x1) = x2
  //   der(x2) = -k * sin(x1) - d * x2
  const dae = new DAEBuilder();

  const x1Idx = dae.addVariable("x1", VarType.Real, Variability.Continuous, Causality.Local, 0.5);
  const x2Idx = dae.addVariable("x2", VarType.Real, Variability.Continuous, Causality.Local, 1.2);
  const kIdx = dae.addVariable("k", VarType.Real, Variability.Parameter, Causality.Local, 9.81);
  const dIdx = dae.addVariable("d", VarType.Real, Variability.Parameter, Causality.Local, 0.3);

  // Eq 0: der(x1) = x2
  const x1Expr = dae.addNameExpr("x1");
  const derX1 = dae.addDerExpr(x1Expr);
  dae.addEquation(EqKind.Simple, derX1, dae.addNameExpr("x2"));

  // Eq 1: der(x2) = (-k * sin(x1)) - (d * x2)
  const x2Expr = dae.addNameExpr("x2");
  const derX2 = dae.addDerExpr(x2Expr);
  const sinX1 = dae.addCallExpr("sin", [x1Expr]);
  const kTerm = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("k"), sinX1);
  const negKTerm = dae.addUnaryExpr(UnaryOp.Negate, kTerm);
  const dTerm = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("d"), x2Expr);
  const rhs2 = dae.addBinaryExpr(BinOp.Sub, negKTerm, dTerm);

  dae.addEquation(EqKind.Simple, derX2, rhs2);

  const sim = new ArenaSimulator(dae);
  sim.prepare();

  const states = new Float64Array([0.8, -0.4]); // x1 = 0.8, x2 = -0.4

  // Arbitrary tangent perturbation vectors
  const vx = new Float64Array([0.35, -0.75]);
  const vp = new Map<string, number>([
    ["k", 0.5],
    ["d", -0.2],
  ]);

  // Arbitrary cotangent seed vector
  const u = new Float64Array([1.5, -2.5]);

  // 1. Forward-mode Push-Forward: jvp
  console.log("1. Evaluating forward-mode jvp...");
  const jvpRes = jvp(sim, states, vx, vp);
  console.log(`  Primal RHS f(x): [${jvpRes.primal[0]!.toFixed(6)}, ${jvpRes.primal[1]!.toFixed(6)}]`);
  console.log(`  Tangent J*v:     [${jvpRes.tangent[0]!.toFixed(6)}, ${jvpRes.tangent[1]!.toFixed(6)}]`);

  // 2. Reverse-mode Pull-Back: vjp
  console.log("\n2. Evaluating reverse-mode vjp...");
  const vjpRes = vjp(sim, states, u, ["k", "d"]);
  console.log(`  Pull-back gradX (u^T * J_x): [${vjpRes.gradX[0]!.toFixed(6)}, ${vjpRes.gradX[1]!.toFixed(6)}]`);
  console.log(
    `  Pull-back gradP (u^T * J_p): k=${vjpRes.gradP.get("k")!.toFixed(6)}, d=${vjpRes.gradP.get("d")!.toFixed(6)}`,
  );

  // 3. Adjoint Duality Test (The Dot-Product Test)
  // Mathematical identity: <jvp(vx, vp), u> == <vx, gradX> + <vp, gradP>
  console.log("\n3. Verifying Adjoint Duality Identity (<jvp(v), u> == <v, vjp(u)>)...");
  let lhs = 0;
  for (let i = 0; i < u.length; i++) {
    lhs += jvpRes.tangent[i]! * u[i]!;
  }

  let rhs = 0;
  for (let i = 0; i < vx.length; i++) {
    rhs += vx[i]! * vjpRes.gradX[i]!;
  }
  rhs += (vp.get("k") ?? 0) * (vjpRes.gradP.get("k") ?? 0);
  rhs += (vp.get("d") ?? 0) * (vjpRes.gradP.get("d") ?? 0);

  const diff = Math.abs(lhs - rhs);
  console.log(`  LHS (<jvp(v), u>): ${lhs.toFixed(10)}`);
  console.log(`  RHS (<v, vjp(u)>): ${rhs.toFixed(10)}`);
  console.log(`  Absolute Error:    ${diff.toExponential(4)}`);

  assert(diff < 1e-4, `Adjoint duality error too large: ${diff}`);
  console.log("  ✔ Adjoint Duality mathematically verified within numerical precision!");

  console.log("\nAll Composable Autodiff tests PASSED successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
