// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { DaeArchetypeId } from "../../schema/index.js";
import type { PsseDyrRecord } from "../../types.js";
import { add, addReal, div, emitClamp, emitFirstOrderLag, emitMax, mul, sub, type DaeBlockContext } from "../blocks.js";

export interface LoweredLoadInjection {
  /** Dynamic active power demand `P_dyn` (MW) at the bus. */
  pMwExpr: number;
  /** Dynamic reactive power demand `Q_dyn` (Mvar) at the bus. */
  qMvarExpr: number;
  /** Network current drawn by dynamic load `(Ir_load, Ii_load)` in p.u. on `sbase`. */
  irSysExpr: number;
  iiSysExpr: number;
}

/**
 * Lowers dynamic load models (`IEEL*`, `LDFR*`, `CLOD*`, `CIM5*`, `CIM6*`, `LD1PAC`, `CMPLDW`/`CMLD*`)
 * into `DAEBuilder`, returning exact current injections drawn from the bus on `sbase`.
 */
export function lowerDynamicLoadToDae(
  ctx: DaeBlockContext,
  busNum: number,
  loadId: string,
  dyrLoad: PsseDyrRecord,
  archetype: DaeArchetypeId,
  pBaseMw: number,
  qBaseMvar: number,
  v0: number,
  sbase: number,
  vrBusExpr: number,
  viBusExpr: number,
  busFreqPuExpr: number,
): LoweredLoadInjection {
  const { dae } = ctx;
  const tag = `${busNum}_${loadId.trim() || "1"}`;
  const np = dyrLoad.namedParams;

  const vt2 = add(dae, mul(dae, vrBusExpr, vrBusExpr), mul(dae, viBusExpr, viBusExpr));
  const vtSafe2 = emitMax(ctx, addReal(dae, 1e-4), vt2);
  const vtExpr = dae.addCallExpr("sqrt", [vtSafe2]);
  const vNorm = div(dae, vtExpr, addReal(dae, Math.max(0.2, v0)));
  const dfPu = sub(dae, busFreqPuExpr, addReal(dae, 1.0));

  let pMwExpr: number;
  let qMvarExpr: number;

  if (archetype === "load_static_zipf") {
    const a1 = np["a1"] ?? 0.3;
    const a2 = np["a2"] ?? 0.3;
    const a3 = np["a3"] ?? 0.4;
    const a4 = np["a4"] ?? 0.5;
    const a5 = np["a5"] ?? 0.2;
    const a6 = np["a6"] ?? 0.3;
    const a7 = np["a7"] ?? 1.0;
    const a8 = np["a8"] ?? -1.0;

    const v2 = mul(dae, vNorm, vNorm);
    const pPoly = add(
      dae,
      add(dae, mul(dae, addReal(dae, a1), v2), mul(dae, addReal(dae, a2), vNorm)),
      addReal(dae, a3),
    );
    const qPoly = add(
      dae,
      add(dae, mul(dae, addReal(dae, a4), v2), mul(dae, addReal(dae, a5), vNorm)),
      addReal(dae, a6),
    );
    pMwExpr = mul(
      dae,
      addReal(dae, pBaseMw),
      mul(dae, pPoly, add(dae, addReal(dae, 1.0), mul(dae, addReal(dae, a7), dfPu))),
    );
    qMvarExpr = mul(
      dae,
      addReal(dae, qBaseMvar),
      mul(dae, qPoly, add(dae, addReal(dae, 1.0), mul(dae, addReal(dae, a8), dfPu))),
    );
  } else if (archetype === "load_ind_motor" || archetype === "load_1ph_stall") {
    const hMot = Math.max(0.05, np["H"] ?? 1.2);
    const dExp = Math.max(0.0, np["D"] ?? 2.0);
    const s0 = 0.02;
    const slipVar = dae.addVariable(`s_motor_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, s0);
    const slipExpr = dae.addNameExpr(`s_motor_${tag}`);

    // Electromagnetic torque Te ~ (V / V0)^2 * (s / s0) / (1 + (s/s0)^2 * 0.1) ; Mechanical torque Tm = (1 - s)^D
    const sRatio = div(dae, slipExpr, addReal(dae, s0));
    const teMot = mul(dae, mul(dae, vNorm, vNorm), sRatio);
    const speedPu = sub(dae, addReal(dae, 1.0), slipExpr);
    const tmMot =
      dExp === 0
        ? addReal(dae, 1.0)
        : dae.addBinaryExpr(BinOp.Pow, emitMax(ctx, addReal(dae, 0.05), speedPu), addReal(dae, dExp));
    // 2*H * der(s) = Tm - Te
    dae.addEquation(EqKind.Simple, mul(dae, addReal(dae, 2.0 * hMot), dae.addDerExpr(slipVar)), sub(dae, tmMot, teMot));

    pMwExpr = mul(dae, addReal(dae, pBaseMw), teMot);
    const qFactor = add(dae, addReal(dae, 1.0), mul(dae, addReal(dae, 2.5), sub(dae, slipExpr, addReal(dae, s0))));
    qMvarExpr = mul(dae, addReal(dae, qBaseMvar), mul(dae, mul(dae, vNorm, vNorm), qFactor));
  } else if (archetype === "load_complex_clod") {
    const fMot = Math.min(1.0, Math.max(0.0, ((np["PctLargeMotor"] ?? 25.0) + (np["PctSmallMotor"] ?? 25.0)) / 100.0));
    const fStatic = 1.0 - fMot;
    const s0 = 0.02;
    const slipVar = dae.addVariable(`s_motor_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, s0);
    const slipExpr = dae.addNameExpr(`s_motor_${tag}`);
    const teMot = mul(dae, mul(dae, vNorm, vNorm), div(dae, slipExpr, addReal(dae, s0)));
    dae.addEquation(
      EqKind.Simple,
      mul(dae, addReal(dae, 2.0 * 0.8), dae.addDerExpr(slipVar)),
      sub(dae, addReal(dae, 1.0), teMot),
    );

    const pTotal = add(
      dae,
      mul(dae, addReal(dae, fMot), teMot),
      mul(dae, addReal(dae, fStatic), mul(dae, vNorm, vNorm)),
    );
    pMwExpr = mul(dae, addReal(dae, pBaseMw), pTotal);
    qMvarExpr = mul(
      dae,
      addReal(dae, qBaseMvar),
      add(dae, mul(dae, addReal(dae, fMot), teMot), mul(dae, addReal(dae, fStatic), mul(dae, vNorm, vNorm))),
    );
  } else {
    // WECC CMPLDW / CMLD composite load model (feeder voltage drop + 3-ph motors A/B/C + 1-ph motor D stall + ZIP)
    const fma = Math.max(0.0, np["Fma"] ?? np["FmA"] ?? 0.25);
    const fmb = Math.max(0.0, np["Fmb"] ?? np["FmB"] ?? 0.2);
    const fmc = Math.max(0.0, np["Fmc"] ?? np["FmC"] ?? 0.15);
    const fmd = Math.max(0.0, np["Fmd"] ?? np["FmD"] ?? 0.2);
    const fel = Math.max(0.0, np["Fel"] ?? 0.1);
    const fStatic = Math.max(0.0, 1.0 - Math.min(1.0, fma + fmb + fmc + fmd + fel));
    const f3Ph = fma + fmb + fmc;
    const vStall = Math.max(0.2, np["Vstall"] ?? 0.6);
    const tStall = Math.max(0.005, np["Tstall"] ?? 0.033);

    const s0 = 0.025;
    const slipVar = dae.addVariable(`s_motor_${busNum}`, VarType.Real, Variability.Continuous, Causality.Local, s0);
    const slipExpr = dae.addNameExpr(`s_motor_${busNum}`);
    const te3Ph = mul(dae, mul(dae, vNorm, vNorm), div(dae, slipExpr, addReal(dae, s0)));
    dae.addEquation(
      EqKind.Simple,
      mul(dae, addReal(dae, 2.0 * 0.6), dae.addDerExpr(slipVar)),
      sub(dae, addReal(dae, 1.0), te3Ph),
    );

    // Single-phase A/C stall latch proxy (smooth or piecewise transition below Vstall)
    const stallTarget = ctx.smoothLimits
      ? emitClamp(
          ctx,
          div(dae, sub(dae, addReal(dae, vStall), vtExpr), addReal(dae, 0.05)),
          addReal(dae, 0.0),
          addReal(dae, 1.0),
        )
      : dae.addIfElseExpr(
          dae.addBinaryExpr(BinOp.Lt, vtExpr, addReal(dae, vStall)),
          addReal(dae, 1.0),
          addReal(dae, 0.0),
        );
    const stallFrac = emitFirstOrderLag(
      ctx,
      `stallD_${tag}`,
      stallTarget,
      addReal(dae, 1.0),
      addReal(dae, tStall),
      tStall,
      0.0,
    );

    const pMotD = mul(
      dae,
      mul(dae, vNorm, vNorm),
      add(dae, sub(dae, addReal(dae, 1.0), stallFrac), mul(dae, addReal(dae, 2.5), stallFrac)),
    );
    const qMotD = mul(
      dae,
      mul(dae, vNorm, vNorm),
      add(dae, sub(dae, addReal(dae, 1.0), stallFrac), mul(dae, addReal(dae, 4.5), stallFrac)),
    );

    const pFactor = add(
      dae,
      add(dae, mul(dae, addReal(dae, f3Ph), te3Ph), mul(dae, addReal(dae, fmd), pMotD)),
      add(dae, addReal(dae, fel), mul(dae, addReal(dae, fStatic), mul(dae, vNorm, vNorm))),
    );
    const qFactor = add(
      dae,
      add(dae, mul(dae, addReal(dae, f3Ph), te3Ph), mul(dae, addReal(dae, fmd), qMotD)),
      add(dae, addReal(dae, fel), mul(dae, addReal(dae, fStatic), mul(dae, vNorm, vNorm))),
    );
    pMwExpr = mul(dae, addReal(dae, pBaseMw), pFactor);
    qMvarExpr = mul(dae, addReal(dae, qBaseMvar), qFactor);
  }

  // Convert dynamic load (P_mw, Q_mvar) to system-base current drawn from bus:
  // Ir = (P_pu * Vr + Q_pu * Vi) / V^2, Ii = (P_pu * Vi - Q_pu * Vr) / V^2
  const pPu = div(dae, pMwExpr, addReal(dae, sbase));
  const qPu = div(dae, qMvarExpr, addReal(dae, sbase));
  const irSysExpr = div(dae, add(dae, mul(dae, pPu, vrBusExpr), mul(dae, qPu, viBusExpr)), vtSafe2);
  const iiSysExpr = div(dae, sub(dae, mul(dae, pPu, viBusExpr), mul(dae, qPu, vrBusExpr)), vtSafe2);

  return { pMwExpr, qMvarExpr, irSysExpr, iiSysExpr };
}
