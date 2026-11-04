// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers OpenSim generalized coordinates (q_i), generalized speeds (u_i),
 * Hill-type muscle activations (a_m), fiber lengths (l_M_m), and muscle-tendon
 * force balances directly into ModelScript's linear-memory DAEBuilder.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { OpenSimDocument } from "../types.js";

export interface OpenSimDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function canonicalFrame(raw: string): string {
  const t = raw.trim();
  if (t === "ground" || t === "/ground") return "ground";
  return t.replace(/^\/?bodyset\//i, "").replace(/^\//, "");
}

export function lowerOpenSimToDae(doc: OpenSimDocument, options?: OpenSimDaeOptions): DAEBuilder {
  const title = sanitizeId(options?.modelName ?? (doc.modelName || "OpenSimModel"));
  const dae = options?.builder ?? new DAEBuilder(undefined, title);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);

  // 1. Lower Body Mass & Principal Inertia Parameters
  const bodyMassVars = new Map<string, number>();
  const bodyInertiaZVars = new Map<string, number>();

  for (const b of doc.bodies) {
    const bId = sanitizeId(b.name);
    const mVar = dae.addVariable(`mass_${bId}`, VarType.Real, Variability.Parameter, Causality.Local, b.mass);
    dae.addEquation(EqKind.InitialSimple, dae.addName(mVar), dae.addRealLiteral(b.mass));
    bodyMassVars.set(b.name, mVar);

    const izz = b.inertia[2] > 0 ? b.inertia[2] : 1.0;
    const iVar = dae.addVariable(`Izz_${bId}`, VarType.Real, Variability.Parameter, Causality.Local, izz);
    dae.addEquation(EqKind.InitialSimple, dae.addName(iVar), dae.addRealLiteral(izz));
    bodyInertiaZVars.set(b.name, iVar);
  }

  // 2. Lower Muscle States (a_m, l_M_m) and Hill Force Balances (F_M_m)
  const muscleForceVars = new Map<string, number>();
  for (const m of doc.muscles) {
    const mId = sanitizeId(m.name);

    const fMaxVar = dae.addVariable(
      `F_max_${mId}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      m.maxIsometricForce,
    );
    dae.addEquation(EqKind.InitialSimple, dae.addName(fMaxVar), dae.addRealLiteral(m.maxIsometricForce));

    const lOptVar = dae.addVariable(
      `l_opt_${mId}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      m.optimalFiberLength,
    );
    dae.addEquation(EqKind.InitialSimple, dae.addName(lOptVar), dae.addRealLiteral(m.optimalFiberLength));

    const lSlackVar = dae.addVariable(
      `l_slack_${mId}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      m.tendonSlackLength,
    );
    dae.addEquation(EqKind.InitialSimple, dae.addName(lSlackVar), dae.addRealLiteral(m.tendonSlackLength));

    const uExcVar = dae.addVariable(`u_exc_${mId}`, VarType.Real, Variability.Continuous, Causality.Input, 0.1);
    dae.addEquation(EqKind.Simple, dae.addName(uExcVar), dae.addRealLiteral(0.1));

    // Activation state a_m: der(a_m) = (u_exc_m - a_m) / tau_act
    const aVar = dae.addVariable(`a_${mId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.05);
    const tauAct = Math.max(1e-4, m.activationTimeConstant);
    const daRhs = addDiv(addSub(dae.addName(uExcVar), dae.addName(aVar)), dae.addRealLiteral(tauAct));
    dae.addEquation(EqKind.Simple, dae.addDer(aVar), daRhs);

    // Fiber length state l_M_m: der(l_M_m) = (l_opt_m - l_M_m) / tau_deact
    const lMVar = dae.addVariable(
      `l_M_${mId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      m.optimalFiberLength,
    );
    const tauDeact = Math.max(1e-4, m.deactivationTimeConstant);
    const dlMRhs = addDiv(addSub(dae.addName(lOptVar), dae.addName(lMVar)), dae.addRealLiteral(tauDeact));
    dae.addEquation(EqKind.Simple, dae.addDer(lMVar), dlMRhs);

    // Hill force balance: F_M_m = F_max_m * a_m * exp(-((l_M_m / l_opt_m - 1)^2) / 0.45) * cos(alpha)
    const fMVar = dae.addVariable(`F_M_${mId}`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    const normLM = addDiv(dae.addName(lMVar), dae.addName(lOptVar));
    const diff = addSub(normLM, dae.addRealLiteral(1.0));
    const diffSq = addPow(diff, dae.addRealLiteral(2.0));
    const gaussArg = dae.addNegateExpr(addDiv(diffSq, dae.addRealLiteral(0.45)));
    const fLExpr = dae.addCallExpr("exp", [gaussArg]);
    const cosAlpha = Math.cos(m.pennationAngleAtOptimal);
    const fMExpr = addMul(
      addMul(addMul(dae.addName(fMaxVar), dae.addName(aVar)), fLExpr),
      dae.addRealLiteral(cosAlpha),
    );
    dae.addEquation(EqKind.Simple, dae.addName(fMVar), fMExpr);
    muscleForceVars.set(m.name, fMVar);
  }

  // 3. Lower Generalized Coordinates (q_i) and Speeds (u_i)
  const gMag = Math.hypot(doc.gravity[0], doc.gravity[1], doc.gravity[2]);
  for (const j of doc.joints) {
    const childName = canonicalFrame(j.childFrame);
    const parentName = canonicalFrame(j.parentFrame);
    const mVar = bodyMassVars.get(childName);
    const iVar = bodyInertiaZVars.get(childName);

    // Identify muscles spanning this joint
    const spanningMuscleForceVars: number[] = [];
    for (const m of doc.muscles) {
      const frames = m.pathPoints.map((pp) => canonicalFrame(pp.bodyFrame));
      if (frames.includes(childName) || frames.includes(parentName)) {
        const fVar = muscleForceVars.get(m.name);
        if (fVar !== undefined) spanningMuscleForceVars.push(fVar);
      }
    }

    for (const coord of j.coordinates) {
      const cId = sanitizeId(coord.name);
      const qVar = dae.addVariable(
        `q_${cId}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Output,
        coord.defaultValue,
      );
      const uVar = dae.addVariable(`u_${cId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      // Kinematic equation: der(q_i) = u_i
      dae.addEquation(EqKind.Simple, dae.addDer(qVar), dae.addName(uVar));

      if (coord.locked) {
        dae.addEquation(EqKind.Simple, dae.addDer(uVar), dae.addRealLiteral(0.0));
        continue;
      }

      // Dynamic equation: der(u_i) = (tau_muscle - b * u_i + tau_gravity) / I_eff
      let netTorqueExpr: number = dae.addNegateExpr(addMul(dae.addRealLiteral(0.5), dae.addName(uVar)));

      for (const fVar of spanningMuscleForceVars) {
        const momentTerm = addMul(dae.addRealLiteral(0.04), dae.addName(fVar));
        netTorqueExpr = addAdd(netTorqueExpr, momentTerm);
      }

      if (mVar !== undefined) {
        const gravTerm =
          coord.motionType === "translational"
            ? addMul(dae.addName(mVar), dae.addRealLiteral(doc.gravity[1]))
            : dae.addNegateExpr(
                addMul(
                  addMul(dae.addName(mVar), dae.addRealLiteral(gMag * 0.1)),
                  dae.addCallExpr("sin", [dae.addName(qVar)]),
                ),
              );
        netTorqueExpr = addAdd(netTorqueExpr, gravTerm);
      }

      const denomExpr =
        coord.motionType === "translational"
          ? mVar !== undefined
            ? dae.addName(mVar)
            : dae.addRealLiteral(1.0)
          : iVar !== undefined
            ? dae.addName(iVar)
            : dae.addRealLiteral(1.0);

      dae.addEquation(EqKind.Simple, dae.addDer(uVar), addDiv(netTorqueExpr, denomExpr));
    }
  }

  return dae;
}
