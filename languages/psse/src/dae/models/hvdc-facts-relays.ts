// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { DaeArchetypeId } from "../../schema/index.js";
import type { PsseDyrRecord } from "../../types.js";
import {
  add,
  addReal,
  div,
  emitClamp,
  emitFirstOrderLag,
  emitLeadLag,
  emitMax,
  emitNonWindupIntegrator,
  emitNonWindupLag,
  emitWashout,
  mul,
  sub,
  type DaeBlockContext,
} from "../blocks.js";

export interface LoweredBusInjection {
  irSysExpr: number;
  iiSysExpr: number;
}

/**
 * Lowers SVC, STATCOM, TCSC, LCC/VSC HVDC, protection relays, and `BUSFRQ` measurement blocks into `DAEBuilder`.
 */
export function lowerFactsOrHvdcToDae(
  ctx: DaeBlockContext,
  rec: PsseDyrRecord,
  archetype: DaeArchetypeId,
  v0: number,
  sbase: number,
  vrBusExpr: number,
  viBusExpr: number,
  idx: number,
): LoweredBusInjection {
  const { dae } = ctx;
  const tag = `${rec.model}_${rec.ibus}_${idx}`;
  const np = rec.namedParams;

  const vt2 = add(dae, mul(dae, vrBusExpr, vrBusExpr), mul(dae, viBusExpr, viBusExpr));
  const vtSafe = emitMax(ctx, addReal(dae, 0.05), dae.addCallExpr("sqrt", [emitMax(ctx, addReal(dae, 1e-4), vt2)]));
  const vtExpr = dae.addCallExpr("sqrt", [emitMax(ctx, addReal(dae, 1e-4), vt2)]);

  if (archetype === "facts_svc") {
    const tr = Math.max(0.0, np["Tr"] ?? np["T5"] ?? 0.01);
    const k = Math.max(0.1, np["K"] ?? 50.0);
    const t1 = Math.max(0.0, np["T1"] ?? 0.1);
    const t2 = Math.max(0.0, np["T2"] ?? 0.5);
    const t3 = Math.max(0.005, np["T3"] ?? 0.02);
    const bMax = np["Bmax"] ?? np["Vmax"] ?? 1.5;
    const bMin = np["Bmin"] ?? np["Rmin"] ?? -1.0;

    const vtF = emitFirstOrderLag(ctx, `Vt_svc_${tag}`, vtExpr, addReal(dae, 1.0), addReal(dae, tr), tr, v0);
    const vErr = sub(dae, addReal(dae, v0), vtF);
    const vLl = emitLeadLag(ctx, `xll_svc_${tag}`, vErr, addReal(dae, t1), addReal(dae, t2), t2, 0.0);
    const bSvc = emitNonWindupLag(
      ctx,
      `B_svc_${tag}`,
      vLl,
      addReal(dae, k),
      addReal(dae, t3),
      t3,
      addReal(dae, bMin),
      addReal(dae, bMax),
      0.0,
    );

    // Capacitive injection I_svc = -j * B_svc * V = (+B_svc * Vi, -B_svc * Vr) -> Q = B_svc * V^2 > 0
    return {
      irSysExpr: mul(dae, bSvc, viBusExpr),
      iiSysExpr: mul(dae, addReal(dae, -1.0), mul(dae, bSvc, vrBusExpr)),
    };
  }

  if (archetype === "facts_statcom") {
    const tr = Math.max(0.0, np["Tr"] ?? 0.01);
    const kp = Math.max(0.0, np["Kp"] ?? 10.0);
    const ki = Math.max(0.0, np["Ki"] ?? 40.0);
    const iMax = np["Imax"] ?? 1.1;
    const iMin = np["Imin"] ?? -1.1;

    const vtF = emitFirstOrderLag(ctx, `Vt_stat_${tag}`, vtExpr, addReal(dae, 1.0), addReal(dae, tr), tr, v0);
    const vErr = sub(dae, addReal(dae, v0), vtF);
    const iqInt =
      ki > 1e-6
        ? emitNonWindupIntegrator(
            ctx,
            `Iq_stat_${tag}`,
            mul(dae, addReal(dae, ki), vErr),
            addReal(dae, 1.0),
            1.0,
            addReal(dae, iMin),
            addReal(dae, iMax),
            0.0,
          )
        : addReal(dae, 0.0);
    const iqTot = emitClamp(
      ctx,
      add(dae, iqInt, mul(dae, addReal(dae, kp), vErr)),
      addReal(dae, iMin),
      addReal(dae, iMax),
    );

    // Capacitive reactive current quadrature to V: Ir = Iq * sin(theta), Ii = -Iq * cos(theta)
    const cosT = div(dae, vrBusExpr, vtSafe);
    const sinT = div(dae, viBusExpr, vtSafe);
    return {
      irSysExpr: mul(dae, iqTot, sinT),
      iiSysExpr: mul(dae, addReal(dae, -1.0), mul(dae, iqTot, cosT)),
    };
  }

  // HVDC / TCSC terminal modulation
  const tp = Math.max(0.005, np["Tp"] ?? np["Tidc"] ?? 0.02);
  const p0Pu = 0.0;
  const pDc = emitFirstOrderLag(ctx, `Pdc_${tag}`, addReal(dae, p0Pu), addReal(dae, 1.0), addReal(dae, tp), tp, p0Pu);
  void sbase;
  return {
    irSysExpr: div(dae, mul(dae, pDc, vrBusExpr), vtSafe),
    iiSysExpr: div(dae, mul(dae, pDc, viBusExpr), vtSafe),
  };
}

/**
 * Lowers a `BUSFRQ` / `SBUS` bus-frequency estimator block into `DAEBuilder`, returning
 * the normalized per-unit frequency `freqPu = 1 + df` expression ID.
 */
export function lowerBusFreqEstimatorToDae(
  ctx: DaeBlockContext,
  busNum: number,
  vrBusExpr: number,
  viBusExpr: number,
  vAngle0Rad: number,
  omega0: number,
  tf = 0.04,
  tw = 0.02,
): number {
  const { dae } = ctx;
  const thetaExpr = dae.addCallExpr("atan2", [viBusExpr, vrBusExpr]);
  // Washed-out derivative approximation: dTheta/dt ~ (theta - x_theta) / Tf
  const thetaDiff = emitWashout(
    ctx,
    `theta_f_${busNum}`,
    thetaExpr,
    addReal(dae, 1.0 / Math.max(0.005, tf)),
    addReal(dae, tf),
    tf,
    vAngle0Rad,
    1.0 / Math.max(0.005, tf),
  );
  const dfPuRaw = div(dae, thetaDiff, addReal(dae, omega0));
  const dfFltr = emitFirstOrderLag(ctx, `df_bus_${busNum}`, dfPuRaw, addReal(dae, 1.0), addReal(dae, tw), tw, 0.0);
  return add(dae, addReal(dae, 1.0), dfFltr);
}

/**
 * Lowers protection / load-shedding relay monitoring states into `DAEBuilder`
 * and returns a trip multiplier expression (`1.0` = closed/normal, `< 1.0` = shed/tripped).
 */
export function lowerRelayToDae(
  ctx: DaeBlockContext,
  rec: PsseDyrRecord,
  archetype: DaeArchetypeId,
  vtExpr: number,
  busFreqHzExpr: number,
  idx: number,
): number {
  const { dae } = ctx;
  const tag = `${rec.model}_${rec.ibus}_${idx}`;
  const np = rec.namedParams;
  dae.addVariable(`tripMult_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const multExpr = dae.addNameExpr(`tripMult_${tag}`);

  if (archetype === "relay_load_shed") {
    const f1 = np["F1"] ?? np["V1"] ?? 59.3;
    const sh1 = np["SH1"] ?? 0.1;
    const isVolt = rec.model.startsWith("LVSH") || rec.model.startsWith("UVLS");
    const sig = isVolt ? vtExpr : busFreqHzExpr;
    if (ctx.smoothLimits) {
      dae.addEquation(EqKind.Simple, multExpr, addReal(dae, 1.0));
    } else {
      const target = dae.addIfElseExpr(
        dae.addBinaryExpr(BinOp.Lt, sig, addReal(dae, f1)),
        addReal(dae, 1.0 - sh1),
        addReal(dae, 1.0),
      );
      dae.addEquation(EqKind.Simple, multExpr, target);
    }
    return multExpr;
  }

  // Generator / branch trip relay
  const fl = np["FL"] ?? 57.5;
  const fu = np["FU"] ?? 61.5;
  const vl = np["VL"] ?? 0.5;
  const vu = np["VU"] ?? 1.25;
  if (ctx.smoothLimits) {
    dae.addEquation(EqKind.Simple, multExpr, addReal(dae, 1.0));
  } else {
    const isVolt = rec.model.startsWith("VTG") || archetype === "relay_branch_dist";
    const cond = isVolt
      ? dae.addBinaryExpr(
          BinOp.Or,
          dae.addBinaryExpr(BinOp.Lt, vtExpr, addReal(dae, vl)),
          dae.addBinaryExpr(BinOp.Gt, vtExpr, addReal(dae, vu)),
        )
      : dae.addBinaryExpr(
          BinOp.Or,
          dae.addBinaryExpr(BinOp.Lt, busFreqHzExpr, addReal(dae, fl)),
          dae.addBinaryExpr(BinOp.Gt, busFreqHzExpr, addReal(dae, fu)),
        );
    dae.addEquation(EqKind.Simple, multExpr, dae.addIfElseExpr(cond, addReal(dae, 0.0), addReal(dae, 1.0)));
  }
  return multExpr;
}
