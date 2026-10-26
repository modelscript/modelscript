// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ibis — Direct Linear-Memory DAE Arena Lowering for I/O Buffers.
 *
 * Compiles IBIS package parasitics (R_pkg, L_pkg, C_pkg), die capacitance (C_comp),
 * and dynamic I/V pullup/pulldown buffer stages into ModelScript's zero-GC DAEBuilder:
 *   1. External pin terminal voltage v_pin and current i_pin
 *   2. Package lead inductor current i_pkg: L_pkg * der(i_pkg) = v_pin - v_die - R_pkg * i_pkg
 *   3. Die pad node voltage v_die: C_comp * der(v_die) = i_pkg - i_driver
 *   4. Driver current equation i_driver = v_die / R_on
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { calculateOutputResistance } from "../solvers/buffer-solver.js";
import type { IbisDeck, IbisModel } from "../types.js";

export interface IbisDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerIbisToDae(deck: IbisDeck, options?: IbisDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? "IbisBufferModule").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // If there are components with pins, lower pin buffers
  let bufferCount = 0;

  for (const [compName, comp] of deck.components) {
    const rPkg = comp.package.rPkg.typ || 0.1;
    const lPkg = comp.package.lPkg.typ || 2.5e-9;
    const cPkg = comp.package.cPkg.typ || 1.0e-12;

    for (const [pinId, pin] of comp.pins) {
      const model = deck.models.get(pin.modelName);
      if (!model) continue;

      bufferCount++;
      const pfx = `${compName}_${pinId}`;
      lowerPinBuffer(dae, pfx, model, rPkg, lPkg, cPkg);
    }
  }

  // If no pins were connected, lower the models directly
  if (bufferCount === 0) {
    for (const [modName, mod] of deck.models) {
      lowerPinBuffer(dae, modName, mod, 0.1, 2.5e-9, 1.0e-12);
    }
  }

  return dae;
}

function lowerPinBuffer(
  dae: DAEBuilder,
  prefix: string,
  model: IbisModel,
  rPkg: number,
  lPkg: number,
  cPkg: number,
): void {
  const cComp = model.cComp.typ || 2.0e-12;
  const vcc = model.voltageRange.typ || 3.3;
  const { rOnLow } = calculateOutputResistance(model);
  const rEff = Math.max(1.0, rOnLow);

  // 1. Declare Parameters
  dae.addVariable(`Vcc_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, vcc);
  dae.addVariable(`R_pkg_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, rPkg);
  dae.addVariable(`L_pkg_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, lPkg);
  dae.addVariable(`C_pkg_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, cPkg);
  dae.addVariable(`C_comp_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, cComp);

  // 2. Declare States
  dae.addVariable(`v_pin_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`i_pin_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`v_die_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`i_pkg_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`i_driver_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  const vPinVar = dae.lookupVariable(`v_pin_${prefix}`);
  const iPinVar = dae.lookupVariable(`i_pin_${prefix}`);
  const vDieVar = dae.lookupVariable(`v_die_${prefix}`);
  const iPkgVar = dae.lookupVariable(`i_pkg_${prefix}`);
  const iDriverVar = dae.lookupVariable(`i_driver_${prefix}`);

  if (vPinVar !== -1 && iPinVar !== -1 && vDieVar !== -1 && iPkgVar !== -1 && iDriverVar !== -1) {
    // 3. Package Inductor dynamic equation: L_pkg * der(i_pkg) = v_pin - v_die - R_pkg * i_pkg
    const derIPkg = dae.addDer(iPkgVar);
    const lTimesDer = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(lPkg), derIPkg);
    const vDiff = dae.addBinaryExpr(BinOp.Sub, dae.addName(vPinVar), dae.addName(vDieVar));
    const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rPkg), dae.addName(iPkgVar));
    const rhsInductor = dae.addBinaryExpr(BinOp.Sub, vDiff, rDrop);
    dae.addEquation(EqKind.Simple, lTimesDer, rhsInductor);

    // 4. Die pad capacitor dynamic equation: C_comp * der(v_die) = i_pkg - i_driver
    const derVDie = dae.addDer(vDieVar);
    const cTimesDer = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cComp), derVDie);
    const iNet = dae.addBinaryExpr(BinOp.Sub, dae.addName(iPkgVar), dae.addName(iDriverVar));
    dae.addEquation(EqKind.Simple, cTimesDer, iNet);

    // 5. Driver output current equation: i_driver = v_die / R_eff
    const rDriverTerm = dae.addBinaryExpr(BinOp.Div, dae.addName(vDieVar), dae.addRealLiteral(rEff));
    dae.addEquation(EqKind.Simple, dae.addName(iDriverVar), rDriverTerm);
  }
}
