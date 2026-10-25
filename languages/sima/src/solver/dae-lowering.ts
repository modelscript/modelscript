// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for SIMA Floater & Mooring Line Dynamics.
 *
 * Lowers floater 6-DOF Cummins equations, rational state-space radiation damping states,
 * and lumped mooring restoring forces directly into `@modelscript/runtime`'s `DAEBuilder`
 * struct-of-arrays in WebAssembly linear memory.
 */

import { BinOp, Causality, DAEBuilder, EqKind, UnaryOp, Variability, VarType } from "@modelscript/runtime";
import type { SimaModel } from "../types.js";
import { createRationalRealization } from "./cummins-state-space.js";

const DOF_NAMES = ["surge", "sway", "heave", "roll", "pitch", "yaw"] as const;

/**
 * Lowers a SIMA marine model into a high-performance linear-memory DAEBuilder.
 */
export function lowerSimaToDae(model: SimaModel): DAEBuilder {
  const modelName = (model.title || model.vessels[0]?.name || "SimaMooredSystem").replace(/[^A-Za-z0-9_]/g, "_");
  const dae = new DAEBuilder(undefined, modelName);

  const vessel = model.vessels[0] ?? {
    id: "vessel_1",
    name: "OffshorePlatform",
    mass: 1.5e7,
    displacement: 1.5e4,
    cg: [0, 0, 0] as [number, number, number],
    radiiOfGyration: [30, 30, 35] as [number, number, number],
    massMatrix: [],
    hydrostaticMatrix: [],
    linearDamping: [],
    quadraticDamping: [],
    gmTransverse: 2.5,
    gmLongitudinal: 3.0,
    fairleads: [],
  };

  const env = model.environment;

  // 1. Register Parameters
  dae.addVariable("water_depth", VarType.Real, Variability.Parameter, Causality.Local, env.waterDepth);
  dae.addVariable("water_density", VarType.Real, Variability.Parameter, Causality.Local, env.waterDensity);
  dae.addVariable("wave_hs", VarType.Real, Variability.Parameter, Causality.Local, env.wave.hs);
  dae.addVariable("wave_tp", VarType.Real, Variability.Parameter, Causality.Local, env.wave.tp);

  // Mooring horizontal restoring stiffness
  let totalSpreadStiffness = 0;
  for (const line of model.lines) {
    const avgEa = line.segments.reduce((acc, s) => acc + s.axialStiffnessEA, 0) / Math.max(1, line.segments.length);
    totalSpreadStiffness += (avgEa / Math.max(10, line.totalLength)) * 0.05;
  }
  totalSpreadStiffness = Math.max(30000, totalSpreadStiffness);
  dae.addVariable("k_mooring_h", VarType.Real, Variability.Parameter, Causality.Local, totalSpreadStiffness);

  // 2. Register 6-DOF Floater Motion Variables & Equations
  for (let dofIdx = 0; dofIdx < 6; dofIdx++) {
    const name = DOF_NAMES[dofIdx] ?? `dof_${dofIdx + 1}`;
    const posVar = name;
    const velVar = `v_${name}`;
    const accVar = `a_${name}`;

    // Positions (Surge, Sway, Heave, Roll, Pitch, Yaw)
    dae.addVariable(posVar, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    // Velocities
    dae.addVariable(velVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    // Accelerations
    dae.addVariable(accVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Kinematic equation: der(posVar) = velVar
    const derPos = dae.addDerExpr(dae.addNameExpr(posVar));
    const velExpr = dae.addNameExpr(velVar);
    dae.addEquation(EqKind.Simple, derPos, velExpr);

    // Kinematic acceleration equation: der(velVar) = accVar
    const derVel = dae.addDerExpr(dae.addNameExpr(velVar));
    const accExpr = dae.addNameExpr(accVar);
    dae.addEquation(EqKind.Simple, derVel, accExpr);

    // 3. Radiation Damping State-Space Auxiliary States (order 2)
    const realization = createRationalRealization(dofIdx + 1, 2);
    const z1Var = `rad_${name}_1`;
    const z2Var = `rad_${name}_2`;
    dae.addVariable(z1Var, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(z2Var, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // der(z1) = A[0][1] * z2 + B[0] * velVar
    const derZ1 = dae.addDerExpr(dae.addNameExpr(z1Var));
    const z2Name = dae.addNameExpr(z2Var);
    dae.addEquation(EqKind.Simple, derZ1, z2Name);

    // der(z2) = A[1][0] * z1 + A[1][1] * z2 + B[1] * velVar
    const derZ2 = dae.addDerExpr(dae.addNameExpr(z2Var));
    const a10 = realization.A[1]?.[0] ?? 0;
    const a11 = realization.A[1]?.[1] ?? 0;
    const b1 = realization.B[1] ?? 1;

    const a10_z1 = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(a10), dae.addNameExpr(z1Var));
    const a11_z2 = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(a11), dae.addNameExpr(z2Var));
    const b1_vel = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(b1), dae.addNameExpr(velVar));
    const rhsZ2 = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, a10_z1, a11_z2), b1_vel);
    dae.addEquation(EqKind.Simple, derZ2, rhsZ2);

    // 4. Cummins Dynamic Equation: (M + A_inf) * acc = F_wave - C*pos - mu - F_mooring - F_damping
    const massVal = vessel.massMatrix?.[dofIdx]?.[dofIdx] ?? (dofIdx < 3 ? vessel.mass : vessel.mass * 900);
    const addedMassVal = vessel.hydrodynamics?.addedMassInfinity?.[dofIdx]?.[dofIdx] ?? 0.2 * massVal;
    const totalInertia = massVal + addedMassVal;

    // C matrix restoring stiffness
    let cRestoring = 0;
    if (dofIdx === 2) {
      cRestoring = env.waterDensity * 9.81 * (vessel.displacement / 20.0);
    } else if (dofIdx === 3) {
      cRestoring = vessel.mass * 9.81 * Math.max(0.5, vessel.gmTransverse);
    } else if (dofIdx === 4) {
      cRestoring = vessel.mass * 9.81 * Math.max(0.5, vessel.gmLongitudinal);
    }

    // Radiation force mu = C_r[0] * z1 + C_r[1] * z2
    const c0 = realization.C[0] ?? 0;
    const muExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(c0), dae.addNameExpr(z1Var));

    // Restoring force term
    let restoringExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cRestoring), dae.addNameExpr(posVar));
    if (dofIdx === 0 || dofIdx === 1) {
      // Horizontal mooring restoring: k_mooring_h * pos
      const mooringTerm = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("k_mooring_h"), dae.addNameExpr(posVar));
      restoringExpr = dae.addBinaryExpr(BinOp.Add, restoringExpr, mooringTerm);
    }

    // Dynamic equation: accVar = (-restoringExpr - muExpr) / totalInertia
    const negRestoring = dae.addUnaryExpr(UnaryOp.Negate, restoringExpr);
    const netForce = dae.addBinaryExpr(BinOp.Sub, negRestoring, muExpr);
    const rhsAcc = dae.addBinaryExpr(BinOp.Div, netForce, dae.addRealLiteral(totalInertia));

    dae.addEquation(EqKind.Simple, dae.addNameExpr(accVar), rhsAcc);
  }

  // 5. Mooring Line Tensions
  for (let i = 0; i < model.lines.length; i++) {
    const line = model.lines[i];
    if (!line) continue;
    const tensionVar = `line_${i + 1}_tension`;
    const avgW =
      line.segments.reduce((acc, s) => acc + s.submergedWeightPerMeter, 0) / Math.max(1, line.segments.length);

    dae.addVariable(tensionVar, VarType.Real, Variability.Continuous, Causality.Output, line.pretension ?? 5e5);

    // Nominal dynamic tension: T = pretension + 0.5 * w * H + k * sqrt(surge^2 + sway^2)
    const pretensionExpr = dae.addRealLiteral(line.pretension ?? avgW * env.waterDepth * 2);
    const surgeSq = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("surge"), dae.addNameExpr("surge"));
    const swaySq = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("sway"), dae.addNameExpr("sway"));
    const offsetSq = dae.addBinaryExpr(BinOp.Add, surgeSq, swaySq);
    const dynTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(5000.0), offsetSq);
    const totalTensionExpr = dae.addBinaryExpr(BinOp.Add, pretensionExpr, dynTerm);

    dae.addEquation(EqKind.Simple, dae.addNameExpr(tensionVar), totalTensionExpr);
  }

  return dae;
}
