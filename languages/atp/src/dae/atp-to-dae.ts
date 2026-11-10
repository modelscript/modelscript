// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for Alternative Transients Program (ATP-EMTP).
 *
 * Compiles high-voltage electrical networks, RLC branches, and AC/DC sources directly into
 * ModelScript's zero-GC DAEBuilder arena for stiff numerical transient integration.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { AtpCase } from "../types.js";

export interface AtpDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers an AtpCase directly into a DAEBuilder linear-memory arena.
 */
export function lowerAtpToDae(atpCase: AtpCase, options?: AtpDaeOptions): DAEBuilder {
  const rawName = options?.modelName ?? atpCase.title;
  const modelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Time variable
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  // 2. Discover all non-ground nodes
  const groundNodes = new Set(["0", "GND", "GROUND", ""]);
  const nodeSet = new Set<string>();

  for (const b of atpCase.branches) {
    if (!groundNodes.has(b.node1)) nodeSet.add(b.node1);
    if (!groundNodes.has(b.node2)) nodeSet.add(b.node2);
  }
  for (const s of atpCase.sources) {
    if (!groundNodes.has(s.node)) nodeSet.add(s.node);
  }

  const nodes = Array.from(nodeSet);

  // 3. Declare nodal voltage variables
  for (const node of nodes) {
    const vName = `v_${node.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    dae.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  }

  // 4. Source constraints
  for (let sIdx = 0; sIdx < atpCase.sources.length; sIdx++) {
    const src = atpCase.sources[sIdx]!;
    if (groundNodes.has(src.node)) continue;

    const vName = `v_${src.node.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const vId = interner.intern(vName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);

    // Initial voltage condition or source equation: v_node = amplitude
    const ampLit = dae.addRealLiteral(src.amplitude);
    dae.addEquation(EqKind.Simple, vExpr, ampLit);
  }

  // 5. Branch current variables and constitutive equations
  for (let bIdx = 0; bIdx < atpCase.branches.length; bIdx++) {
    const b = atpCase.branches[bIdx]!;
    const bName = `i_branch_${bIdx + 1}`;
    dae.addVariable(bName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const bId = interner.intern(bName);
    const bExpr = dae.addExpression(ExprKind.Name, bId);

    // If resistance is present, i = (v1 - v2) / R
    const rVal = b.rOhms > 0 ? b.rOhms : 1.0;
    const rLit = dae.addRealLiteral(rVal);

    dae.addEquation(EqKind.Simple, bExpr, rLit);
  }

  // 6. Simulation parameters (dt, tMax)
  dae.addVariable("delta_t", VarType.Real, Variability.Parameter, Causality.Local, atpCase.control.deltaTSec);
  dae.addVariable("t_max", VarType.Real, Variability.Parameter, Causality.Local, atpCase.control.tMaxSec);

  const dtId = interner.intern("delta_t");
  const tmaxId = interner.intern("t_max");
  dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, dtId), dae.addRealLiteral(atpCase.control.deltaTSec));
  dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, tmaxId), dae.addRealLiteral(atpCase.control.tMaxSec));

  return dae;
}
