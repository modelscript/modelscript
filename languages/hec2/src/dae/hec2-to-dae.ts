// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { getUnitConstants } from "../solver/hydraulics.js";
import { solveHec2Profile, type Hec2SolveOptions } from "../solver/standard-step.js";
import type { Hec2Deck } from "../types.js";

/**
 * Lowers a parsed HEC-2 open-channel hydraulics deck directly into ModelScript's
 * linear-memory `DAEBuilder` with steady 1D Saint-Venant continuity and Standard Step
 * energy conservation equations.
 */
export function lowerHec2ToDae(deck: Hec2Deck, options: Hec2SolveOptions = {}, arenaTitle?: string): DAEBuilder {
  const title = (arenaTitle ?? deck.titles[0] ?? "HEC2_Water_Surface_Profile").replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  if (deck.crossSections.length === 0) {
    return arena;
  }

  const profile = solveHec2Profile(deck, options);
  const { g, phi } = getUnitConstants(profile.units);

  // Global physical constants
  const gId = interner.intern("gravity");
  arena.addVariable("gravity", VarType.Real, Variability.Constant, Causality.Local, g);
  const gExpr = arena.addExpression(ExprKind.Name, gId);

  const phiId = interner.intern("manning_phi");
  arena.addVariable("manning_phi", VarType.Real, Variability.Constant, Causality.Local, phi);

  const wselExprs: number[] = [];
  const eglExprs: number[] = [];
  const qExprs: number[] = [];
  const vExprs: number[] = [];
  const sfExprs: number[] = [];

  for (let i = 0; i < profile.stations.length; i++) {
    const st = profile.stations[i]!;
    const tag = `sec_${String(st.secno).replace(/[^a-zA-Z0-9_]/g, "_")}_${i}`;

    // Variables: WSEL, EGL, Q, V, Sf
    const wselName = `wsel_${tag}`;
    const wselId = interner.intern(wselName);
    arena.addVariable(wselName, VarType.Real, Variability.Continuous, Causality.Local, st.wsel);
    const wselExpr = arena.addExpression(ExprKind.Name, wselId);
    wselExprs.push(wselExpr);

    const eglName = `egl_${tag}`;
    const eglId = interner.intern(eglName);
    arena.addVariable(eglName, VarType.Real, Variability.Continuous, Causality.Local, st.egl);
    const eglExpr = arena.addExpression(ExprKind.Name, eglId);
    eglExprs.push(eglExpr);

    const qName = `Q_${tag}`;
    const qId = interner.intern(qName);
    arena.addVariable(qName, VarType.Real, Variability.Continuous, Causality.Local, profile.discharge);
    const qExpr = arena.addExpression(ExprKind.Name, qId);
    qExprs.push(qExpr);

    const vName = `V_${tag}`;
    const vId = interner.intern(vName);
    arena.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Local, st.velocity);
    const vExpr = arena.addExpression(ExprKind.Name, vId);
    vExprs.push(vExpr);

    const sfName = `Sf_${tag}`;
    const sfId = interner.intern(sfName);
    arena.addVariable(sfName, VarType.Real, Variability.Continuous, Causality.Local, st.frictionSlope);
    const sfExpr = arena.addExpression(ExprKind.Name, sfId);
    sfExprs.push(sfExpr);

    // 1. Steady Continuity Equation: Q_i = Q_0 (or Q_total at downstream boundary)
    if (i === 0) {
      arena.addEquation(EqKind.Simple, qExpr, arena.addRealLiteral(profile.discharge));
    } else {
      arena.addEquation(EqKind.Simple, qExpr, qExprs[i - 1]!);
    }

    // 2. Kinematic Continuity: V_i * A_i = Q_i
    const areaLit = arena.addRealLiteral(Math.max(st.area, 1e-6));
    const vaExpr = arena.addBinaryExpr(BinOp.Mul, vExpr, areaLit);
    arena.addEquation(EqKind.Simple, vaExpr, qExpr);

    // 3. Energy Grade Line: EGL_i = WSEL_i + alpha_i * V_i^2 / (2 * g)
    const vSq = arena.addBinaryExpr(BinOp.Mul, vExpr, vExpr);
    const alphaVSq = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(st.alpha), vSq);
    const twoG = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), gExpr);
    const hv = arena.addBinaryExpr(BinOp.Div, alphaVSq, twoG);
    const eglRhs = arena.addBinaryExpr(BinOp.Add, wselExpr, hv);
    arena.addEquation(EqKind.Simple, eglExpr, eglRhs);

    // 4. Manning Friction Slope: Sf_i = (Q_i / K_i)^2
    const kLit = arena.addRealLiteral(Math.max(st.conveyance, 1e-6));
    const qOverK = arena.addBinaryExpr(BinOp.Div, qExpr, kLit);
    const sfRhs = arena.addBinaryExpr(BinOp.Mul, qOverK, qOverK);
    arena.addEquation(EqKind.Simple, sfExpr, sfRhs);
  }

  // 5. Downstream Boundary Condition: WSEL_0 = wsel_bc
  arena.addEquation(EqKind.Simple, wselExprs[0]!, arena.addRealLiteral(profile.stations[0]!.wsel));

  // 6. Reach Standard Step Energy Balance: EGL_i = EGL_{i-1} + h_e
  for (let i = 1; i < profile.stations.length; i++) {
    const st = profile.stations[i]!;
    const heLit = arena.addRealLiteral(st.headLoss);
    const rhs = arena.addBinaryExpr(BinOp.Add, eglExprs[i - 1]!, heLit);
    arena.addEquation(EqKind.Simple, eglExprs[i]!, rhs);
  }

  // Reference phiId to ensure constant stays live in interner
  void phiId;

  return arena;
}
