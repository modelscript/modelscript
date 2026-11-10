// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for ASPEN OneLiner / CAPE Models.
 *
 * Compiles transmission sequence networks, short-circuit impedances, and protective
 * relay pickup equations directly into ModelScript's zero-GC DAEBuilder arena.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { OneLinerCase } from "../types.js";

export interface OneLinerDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers a OneLinerCase directly into a DAEBuilder linear-memory arena.
 */
export function lowerOneLinerToDae(onelinerCase: OneLinerCase, options?: OneLinerDaeOptions): DAEBuilder {
  const rawName = options?.modelName ?? onelinerCase.title;
  const modelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Time variable
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  // 2. Bus voltages and phase angles
  for (const b of onelinerCase.busses) {
    const safeBus = b.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const vName = `v_${safeBus}`;
    const thName = `theta_${safeBus}`;

    dae.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Output, 1.0);
    dae.addVariable(thName, VarType.Real, Variability.Continuous, Causality.Output, 0.0);

    // Initial bus state equations
    const vId = interner.intern(vName);
    const thId = interner.intern(thName);
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, vId), dae.addRealLiteral(1.0));
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, thId), dae.addRealLiteral(0.0));
  }

  // 3. Branch current equations
  for (let idx = 0; idx < onelinerCase.branches.length; idx++) {
    const br = onelinerCase.branches[idx]!;
    const safeId = br.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const iName = `i_${safeId}`;

    const z1Mag = Math.sqrt(br.z1.r * br.z1.r + br.z1.x * br.z1.x);
    dae.addVariable(iName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Parameter for branch positive-sequence impedance
    const zParamName = `z1_${safeId}`;
    dae.addVariable(zParamName, VarType.Real, Variability.Parameter, Causality.Local, z1Mag);
    const zId = interner.intern(zParamName);
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, zId), dae.addRealLiteral(z1Mag));

    // Branch current equation: i_br = initial 0
    const iId = interner.intern(iName);
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, iId), dae.addRealLiteral(0.0));
  }

  // 4. Overcurrent relay status and pickup thresholds
  for (const oc of onelinerCase.overcurrentRelays) {
    const safeId = oc.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const tripName = `trip_${safeId}`;
    dae.addVariable(tripName, VarType.Integer, Variability.Discrete, Causality.Output, 0);

    const tripId = interner.intern(tripName);
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, tripId), dae.addIntLiteral(0));

    const pickupName = `pickup_${safeId}`;
    dae.addVariable(pickupName, VarType.Real, Variability.Parameter, Causality.Local, oc.pickupA);
    const pickupId = interner.intern(pickupName);
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, pickupId), dae.addRealLiteral(oc.pickupA));
  }

  // 5. System Base MVA
  dae.addVariable("base_mva", VarType.Real, Variability.Parameter, Causality.Local, onelinerCase.baseMva);
  const mvaId = interner.intern("base_mva");
  dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, mvaId), dae.addRealLiteral(onelinerCase.baseMva));

  return dae;
}
