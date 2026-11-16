// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Multi-Domain Electro-Thermal Servo Drivetrain & 2S Battery Coupling.
 *
 * Couples articulated URDF/MJCF joint coordinates `(q, qd, tau)` in `DAEBuilder`
 * to electrical and thermal networks:
 *   1. `PositionServo` with PD gain, gear play (`backlashRad`), Coulomb/viscous
 *      friction, torque constant `kt`, and temperature-dependent winding resistance `R(T)`.
 *   2. `useThermal`: per-servo winding thermal capacitance `C_th` & resistance `R_th`
 *      driven by copper loss `R(T) * i^2` and gearbox friction `|tau_f * qd|`.
 *   3. `useBattery`: shared 2S LiPo bus (`V_bus = V_oc - R_pack * sum(i_k)`)
 *      modeling coupled voltage sag across all servos simultaneously.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";

export interface ServoDrivetrainSpec {
  /** Joint name in DAEBuilder (expects `${jointName}.q`, `${jointName}.qd`, `${jointName}.tau`). */
  jointName: string;
  /** Target position input variable name (created if absent). Default: `${jointName}.q_target`. */
  targetVarName?: string | undefined;
  /** Position proportional gain [N·m/rad]. Default: 0.589 (XL330 walk gain 200). */
  kp?: number | undefined;
  /** Velocity damping gain [N·m·s/rad]. Default: 0.03. */
  kv?: number | undefined;
  /** Motor torque constant [N·m/A]. Default: 0.346 (XL330). */
  kt?: number | undefined;
  /** Nominal winding resistance at T_ref [Ohm]. Default: 2.50 (XL330). */
  resistance0?: number | undefined;
  /** Copper temperature coefficient [1/K]. Default: 0.00393. */
  alphaTemp?: number | undefined;
  /** Gear backlash half-angle [rad]. Default: (1 * Math.PI) / 180 (2 deg total play). */
  backlashRad?: number | undefined;
  /** Coulomb friction torque [N·m]. Default: 0.015. */
  coulombFriction?: number | undefined;
  /** Thermal capacitance [J/K]. Default: 8.0. */
  thermalCap?: number | undefined;
  /** Thermal resistance to ambient [K/W]. Default: 12.0. */
  thermalRes?: number | undefined;
}

export interface MultiDomainDrivetrainOptions {
  /** Enable shared 2S battery pack voltage sag. Default: true. */
  useBattery?: boolean | undefined;
  /** Enable per-servo winding thermal network. Default: true. */
  useThermal?: boolean | undefined;
  /** Battery open-circuit voltage [V]. Default: 7.4. */
  batteryVoc?: number | undefined;
  /** Battery internal resistance [Ohm]. Default: 0.07. */
  batteryRint?: number | undefined;
  /** Ambient temperature [K]. Default: 298.15. */
  ambientTemp?: number | undefined;
  /** Prefix for battery/servo variables. Default: "". */
  prefix?: string | undefined;
}

function addSum(dae: DAEBuilder, terms: number[]): number {
  if (terms.length === 0) return dae.addRealLiteral(0.0);
  let acc = terms[0]!;
  for (let i = 1; i < terms.length; i++) {
    acc = dae.addBinaryExpr(BinOp.Add, acc, terms[i]!);
  }
  return acc;
}

/**
 * Couples a list of robot joints to electro-thermal servo drivetrains and an
 * optional shared 2S battery bus in `DAEBuilder`.
 */
export function coupleElectroThermalDrivetrains(
  dae: DAEBuilder,
  servos: ServoDrivetrainSpec[],
  options: MultiDomainDrivetrainOptions = {},
): void {
  const p = options.prefix ?? "";
  const useBattery = options.useBattery ?? true;
  const useThermal = options.useThermal ?? true;
  const vOc = options.batteryVoc ?? 7.4;
  const rInt = options.batteryRint ?? 0.07;
  const tAmb = options.ambientTemp ?? 298.15;

  const busVar = `${p}battery.V_bus`;
  const totalCurrentVar = `${p}battery.I_total`;
  const totalPowerVar = `${p}drivetrain.P_total`;

  dae.addVariable(busVar, VarType.Real, Variability.Continuous, Causality.Output, vOc);
  dae.addVariable(totalCurrentVar, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  dae.addVariable(totalPowerVar, VarType.Real, Variability.Continuous, Causality.Output, 0.0);

  const nomCurrentTerms: number[] = [];
  const powerTerms: number[] = [];
  const servoCtx: {
    jPrefix: string;
    tauVar: string;
    iVar: string;
    tVar: string;
    rVar: string;
    pCopperVar: string;
    pFricVar: string;
    pdTorqueExpr: number;
    fricTorqueExpr: number;
    kt: number;
  }[] = [];

  for (const s of servos) {
    const jPrefix = `${p}${s.jointName}`;
    const qVar = `${jPrefix}.q`;
    const qdVar = `${jPrefix}.qd`;
    const tauVar = `${jPrefix}.tau`;
    const targetVar = s.targetVarName ?? `${jPrefix}.q_target`;

    if (dae.getVarIdxByName(targetVar) === -1) {
      dae.addVariable(targetVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(targetVar)), dae.addRealLiteral(0.0));
    }

    const kp = s.kp ?? 0.589;
    const kv = s.kv ?? 0.03;
    const kt = Math.max(1e-3, s.kt ?? 0.346);
    const r0 = s.resistance0 ?? 2.5;
    const alpha = s.alphaTemp ?? 0.00393;
    const play = Math.max(0.0, s.backlashRad ?? (1.0 * Math.PI) / 180.0);
    const tauC = s.coulombFriction ?? 0.015;
    const cTh = Math.max(0.1, s.thermalCap ?? 8.0);
    const rTh = Math.max(0.1, s.thermalRes ?? 12.0);

    const iVar = `${jPrefix}.i`;
    const tVar = `${jPrefix}.T_winding`;
    const rVar = `${jPrefix}.R_winding`;
    const pCopperVar = `${jPrefix}.P_copper`;
    const pFricVar = `${jPrefix}.P_friction`;

    dae.addVariable(iVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(tVar, VarType.Real, Variability.Continuous, Causality.Local, tAmb);
    dae.addVariable(rVar, VarType.Real, Variability.Continuous, Causality.Local, r0);
    dae.addVariable(pCopperVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(pFricVar, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const qExpr = dae.addNameExpr(qVar);
    const qdExpr = dae.addNameExpr(qdVar);
    const targetExpr = dae.addNameExpr(targetVar);

    // Smooth deadzone for gear backlash: err_eff = err - clamp(err, -play, play)
    const errExpr = dae.addBinaryExpr(BinOp.Sub, targetExpr, qExpr);
    const clampedErr =
      play > 0
        ? dae.addCallExpr("max", [
            dae.addRealLiteral(-play),
            dae.addCallExpr("min", [dae.addRealLiteral(play), errExpr]),
          ])
        : dae.addRealLiteral(0.0);
    const effErr = dae.addBinaryExpr(BinOp.Sub, errExpr, clampedErr);

    const pdTorqueExpr = dae.addBinaryExpr(
      BinOp.Sub,
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kp), effErr),
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kv), qdExpr),
    );
    const fricTorqueExpr = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addRealLiteral(tauC),
      dae.addCallExpr("tanh", [dae.addBinaryExpr(BinOp.Div, qdExpr, dae.addRealLiteral(0.05))]),
    );

    // Temperature-dependent resistance: R = R0 * (1 + alpha * (T - T_amb))
    const rExpr = useThermal
      ? dae.addBinaryExpr(
          BinOp.Mul,
          dae.addRealLiteral(r0),
          dae.addBinaryExpr(
            BinOp.Add,
            dae.addRealLiteral(1.0),
            dae.addBinaryExpr(
              BinOp.Mul,
              dae.addRealLiteral(alpha),
              dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(tVar), dae.addRealLiteral(tAmb)),
            ),
          ),
        )
      : dae.addRealLiteral(r0);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(rVar), rExpr);

    const pFricExpr = dae.addCallExpr("abs", [dae.addBinaryExpr(BinOp.Mul, fricTorqueExpr, qdExpr)]);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(pFricVar), pFricExpr);

    if (useThermal) {
      const pLoss = dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(pCopperVar), dae.addNameExpr(pFricVar));
      const pCool = dae.addBinaryExpr(
        BinOp.Div,
        dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(tVar), dae.addRealLiteral(tAmb)),
        dae.addRealLiteral(rTh),
      );
      dae.addEquation(
        EqKind.Simple,
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cTh), dae.addDerExpr(dae.addNameExpr(tVar))),
        dae.addBinaryExpr(BinOp.Sub, pLoss, pCool),
      );
    } else {
      dae.addEquation(EqKind.Simple, dae.addNameExpr(tVar), dae.addRealLiteral(tAmb));
    }

    const iNomAbs = dae.addCallExpr("abs", [dae.addBinaryExpr(BinOp.Div, pdTorqueExpr, dae.addRealLiteral(kt))]);
    nomCurrentTerms.push(iNomAbs);
    powerTerms.push(dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(pCopperVar), dae.addNameExpr(pFricVar)));
    servoCtx.push({ jPrefix, tauVar, iVar, tVar, rVar, pCopperVar, pFricVar, pdTorqueExpr, fricTorqueExpr, kt });
  }

  // Exact closed-form shared 2S battery bus (acyclic in BLT):
  // V_bus = V_oc / (1 + (R_int / V_oc) * sum(|i_nom|))
  const sumNomCurrent = addSum(dae, nomCurrentTerms);
  if (useBattery) {
    const denom = dae.addBinaryExpr(
      BinOp.Add,
      dae.addRealLiteral(1.0),
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rInt / vOc), sumNomCurrent),
    );
    dae.addEquation(
      EqKind.Simple,
      dae.addNameExpr(busVar),
      dae.addBinaryExpr(BinOp.Div, dae.addRealLiteral(vOc), denom),
    );
  } else {
    dae.addEquation(EqKind.Simple, dae.addNameExpr(busVar), dae.addRealLiteral(vOc));
  }

  const busScale = dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(busVar), dae.addRealLiteral(vOc));
  const actualCurrentTerms: number[] = [];
  for (const ctx of servoCtx) {
    const motorTorque = dae.addBinaryExpr(BinOp.Mul, ctx.pdTorqueExpr, busScale);
    dae.addEquation(
      EqKind.Simple,
      dae.addNameExpr(ctx.tauVar),
      dae.addBinaryExpr(BinOp.Sub, motorTorque, ctx.fricTorqueExpr),
    );
    const iExpr = dae.addBinaryExpr(BinOp.Div, motorTorque, dae.addRealLiteral(ctx.kt));
    dae.addEquation(EqKind.Simple, dae.addNameExpr(ctx.iVar), iExpr);
    const iVarExpr = dae.addNameExpr(ctx.iVar);
    dae.addEquation(
      EqKind.Simple,
      dae.addNameExpr(ctx.pCopperVar),
      dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(ctx.rVar), dae.addBinaryExpr(BinOp.Mul, iVarExpr, iVarExpr)),
    );
    actualCurrentTerms.push(dae.addCallExpr("abs", [iVarExpr]));
  }

  dae.addEquation(EqKind.Simple, dae.addNameExpr(totalCurrentVar), addSum(dae, actualCurrentTerms));
  dae.addEquation(EqKind.Simple, dae.addNameExpr(totalPowerVar), addSum(dae, powerTerms));
}
