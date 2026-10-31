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
import type { IbisDeck, IbisModel, TableRow } from "../types.js";

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

function buildPiecewiseLinearIvExpr(dae: DAEBuilder, vVarIdx: number, rows: TableRow[]): number {
  const sorted = [...rows].sort((a, b) => a.vOrT - b.vOrT);
  const m = sorted.length;
  if (m === 0) return dae.addRealLiteral(0.0);
  if (m === 1) return dae.addRealLiteral(sorted[0]!.typ);

  let expr = dae.addRealLiteral(sorted[m - 1]!.typ);
  for (let i = m - 2; i >= 0; i--) {
    const p0 = sorted[i]!;
    const p1 = sorted[i + 1]!;
    const dv = p1.vOrT - p0.vOrT;
    const slope = Math.abs(dv) > 1e-12 ? (p1.typ - p0.typ) / dv : 0.0;
    const seg = dae.addBinaryExpr(
      BinOp.Add,
      dae.addRealLiteral(p0.typ),
      dae.addBinaryExpr(
        BinOp.Mul,
        dae.addRealLiteral(slope),
        dae.addBinaryExpr(BinOp.Sub, dae.addName(vVarIdx), dae.addRealLiteral(p0.vOrT)),
      ),
    );
    const cond = dae.addBinaryExpr(BinOp.Lte, dae.addName(vVarIdx), dae.addRealLiteral(p1.vOrT));
    expr = dae.addIfElse(cond, seg, expr);
  }

  const belowCond = dae.addBinaryExpr(BinOp.Lte, dae.addName(vVarIdx), dae.addRealLiteral(sorted[0]!.vOrT));
  return dae.addIfElse(belowCond, dae.addRealLiteral(sorted[0]!.typ), expr);
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
  const rLoad = model.ramp?.rLoad && model.ramp.rLoad > 0 ? model.ramp.rLoad : 50.0;
  const { rOnLow } = calculateOutputResistance(model);
  const rEff = Math.max(1.0, rOnLow);

  // 1. Declare Parameters and emit parameter equations
  const vccVar = dae.addVariable(`Vcc_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, vcc);
  const rPkgVar = dae.addVariable(`R_pkg_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, rPkg);
  const lPkgVar = dae.addVariable(`L_pkg_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, lPkg);
  const cPkgVar = dae.addVariable(`C_pkg_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, cPkg);
  const cCompVar = dae.addVariable(`C_comp_${prefix}`, VarType.Real, Variability.Parameter, Causality.Local, cComp);

  dae.addEquation(EqKind.Simple, dae.addName(vccVar), dae.addRealLiteral(vcc));
  dae.addEquation(EqKind.Simple, dae.addName(rPkgVar), dae.addRealLiteral(rPkg));
  dae.addEquation(EqKind.Simple, dae.addName(lPkgVar), dae.addRealLiteral(lPkg));
  dae.addEquation(EqKind.Simple, dae.addName(cPkgVar), dae.addRealLiteral(cPkg));
  dae.addEquation(EqKind.Simple, dae.addName(cCompVar), dae.addRealLiteral(cComp));

  // 2. Declare Continuous States
  const vPinVar = dae.addVariable(`v_pin_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const iPinVar = dae.addVariable(`i_pin_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const vDieVar = dae.addVariable(`v_die_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const iPkgVar = dae.addVariable(`i_pkg_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const iDriverVar = dae.addVariable(`i_driver_${prefix}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  if (vPinVar !== -1 && iPinVar !== -1 && vDieVar !== -1 && iPkgVar !== -1 && iDriverVar !== -1) {
    // 3. Package pin capacitance equation: C_pkg * der(v_pin) = i_pin - i_pkg
    const derVPin = dae.addDer(vPinVar);
    const cPkgTimesDer = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cPkg), derVPin);
    const iPinNet = dae.addBinaryExpr(BinOp.Sub, dae.addName(iPinVar), dae.addName(iPkgVar));
    dae.addEquation(EqKind.Simple, cPkgTimesDer, iPinNet);

    // 4. External termination load equation: i_pin = -v_pin / R_load
    const negVPin = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), dae.addName(vPinVar));
    const iTerm = dae.addBinaryExpr(BinOp.Div, negVPin, dae.addRealLiteral(rLoad));
    dae.addEquation(EqKind.Simple, dae.addName(iPinVar), iTerm);

    // 5. Package Inductor dynamic equation: L_pkg * der(i_pkg) = v_pin - v_die - R_pkg * i_pkg
    const derIPkg = dae.addDer(iPkgVar);
    const lTimesDer = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(lPkg), derIPkg);
    const vDiff = dae.addBinaryExpr(BinOp.Sub, dae.addName(vPinVar), dae.addName(vDieVar));
    const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rPkg), dae.addName(iPkgVar));
    const rhsInductor = dae.addBinaryExpr(BinOp.Sub, vDiff, rDrop);
    dae.addEquation(EqKind.Simple, lTimesDer, rhsInductor);

    // 6. Die pad capacitor dynamic equation: C_comp * der(v_die) = i_pkg - i_driver
    const derVDie = dae.addDer(vDieVar);
    const cTimesDer = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cComp), derVDie);
    const iNet = dae.addBinaryExpr(BinOp.Sub, dae.addName(iPkgVar), dae.addName(iDriverVar));
    dae.addEquation(EqKind.Simple, cTimesDer, iNet);

    // 7. Nonlinear piecewise-linear I/V curve for i_driver from pulldown / gndClamp tables
    let driverExpr: number | null = null;
    if (model.pulldown && model.pulldown.length >= 2) {
      driverExpr = buildPiecewiseLinearIvExpr(dae, vDieVar, model.pulldown);
    }
    if (model.gndClamp && model.gndClamp.length >= 2) {
      const clampExpr = buildPiecewiseLinearIvExpr(dae, vDieVar, model.gndClamp);
      driverExpr = driverExpr === null ? clampExpr : dae.addBinaryExpr(BinOp.Add, driverExpr, clampExpr);
    }
    if (driverExpr === null) {
      driverExpr = dae.addBinaryExpr(BinOp.Div, dae.addName(vDieVar), dae.addRealLiteral(rEff));
    }
    dae.addEquation(EqKind.Simple, dae.addName(iDriverVar), driverExpr);
  }
}
