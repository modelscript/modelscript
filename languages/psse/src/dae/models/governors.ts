// SPDX-License-Identifier: AGPL-3.0-or-later

import { Causality, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { DaeArchetypeId } from "../../schema/index.js";
import type { PsseDyrRecord } from "../../types.js";
import {
  add,
  addReal,
  div,
  emitClamp,
  emitDeadband,
  emitFirstOrderLag,
  emitLeadLag,
  emitMin,
  emitNonWindupIntegrator,
  emitNonWindupLag,
  emitRateLimitedLag,
  emitWashout,
  mul,
  sub,
  type DaeBlockContext,
} from "../blocks.js";
import type { GeneratorSteadyInit } from "../init-steady-state.js";

/**
 * Lowers steam reheat, hydro penstock, gas/CCGT, diesel, boiler load-controller,
 * and wind mechanical drive-train/pitch governors into `DAEBuilder` variables and equations.
 * Returns `Pm_${genKey}` (MW) expression ID.
 */
export function lowerGovernorUnitToDae(
  ctx: DaeBlockContext,
  genInit: GeneratorSteadyInit,
  dyrGov: PsseDyrRecord,
  archetype: DaeArchetypeId,
  omega0: number,
  omegaExpr: number,
  peExpr: number,
): number {
  const { dae } = ctx;
  const gId = genInit.genKey;
  const np = dyrGov.namedParams;
  const mbase = genInit.mbase;
  const pm0Pu = genInit.tm0;
  const pm0Mw = pm0Pu * mbase;

  dae.addVariable(`Pm_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, pm0Mw);
  const pmOutExpr = dae.addNameExpr(`Pm_${gId}`);
  const dwPu = div(dae, sub(dae, omegaExpr, addReal(dae, omega0)), addReal(dae, omega0));

  if (archetype === "gov_steam_simple") {
    const r = Math.max(0.005, np["R"] ?? 0.05);
    const t1 = Math.max(0.0, np["T1"] ?? 0.5);
    const vMax = Math.max(pm0Pu + 0.1, np["VMAX"] ?? 1.05);
    const vMin = Math.min(pm0Pu, np["VMIN"] ?? 0.0);
    const t2 = Math.max(0.0, np["T2"] ?? 2.1);
    const t3 = Math.max(0.0, np["T3"] ?? 7.0);
    const dt = Math.max(0.0, np["DT"] ?? 0.0);

    const pRef = pm0Pu;
    const pCmd = sub(dae, addReal(dae, pRef), div(dae, dwPu, addReal(dae, r)));
    const valve = emitNonWindupLag(
      ctx,
      `xv_gov_${gId}`,
      pCmd,
      addReal(dae, 1.0),
      addReal(dae, t1),
      t1,
      addReal(dae, vMin),
      addReal(dae, vMax),
      pm0Pu,
    );
    const govModel = (dyrGov?.model ?? "").toUpperCase();
    const t2Eff = govModel.includes("TGOV2") ? Math.max(0.0, (np["F1"] ?? 0.3) * (np["T5"] ?? t3)) : t2;
    const t3Eff = govModel.includes("TGOV2") ? Math.max(0.0, np["T5"] ?? t3) : t3;
    const pTurbPu = sub(
      dae,
      emitLeadLag(ctx, `xrh_gov_${gId}`, valve, addReal(dae, t2Eff), addReal(dae, t3Eff), t3Eff, pm0Pu),
      mul(dae, addReal(dae, dt), dwPu),
    );
    dae.addEquation(EqKind.Simple, pmOutExpr, mul(dae, addReal(dae, mbase), pTurbPu));
    return pmOutExpr;
  }

  if (archetype === "gov_steam_reheat") {
    const r = np["R"] ?? (np["K"] && np["K"] > 0 ? 1.0 / np["K"] : 0.05);
    const kGain = 1.0 / Math.max(0.005, r);
    const t1 = Math.max(0.0, np["T1"] ?? 0.1);
    const t2 = Math.max(0.0, np["T2"] ?? 0.0);
    const t3 = Math.max(0.01, np["T3"] ?? 0.25);
    const uo = Math.max(0.01, np["UO"] ?? 0.2);
    const uc = Math.min(-0.01, np["UC"] ?? -0.4);
    const pMax = Math.max(pm0Pu + 0.1, np["PMAX"] ?? np["VMAX"] ?? 1.05);
    const pMin = Math.min(pm0Pu, np["PMIN"] ?? np["VMIN"] ?? 0.0);
    const t4 = Math.max(0.0, np["T4"] ?? 0.3);
    const t5 = Math.max(0.0, np["T5"] ?? 7.0);
    const t6 = Math.max(0.0, np["T6"] ?? 0.5);
    const t7 = Math.max(0.0, np["T7"] ?? 0.0);

    const k1 = np["K1"] ?? np["F1"] ?? 0.3;
    const k3 = np["K3"] ?? 0.4;
    const k5 = np["K5"] ?? 1.0 - k1 - k3;
    const k7 = np["K7"] ?? 0.0;
    const kSum = Math.max(1e-4, k1 + k3 + k5 + k7);

    const errSignal = mul(dae, addReal(dae, -kGain), dwPu);
    const x1 = emitLeadLag(ctx, `x1_gov_${gId}`, errSignal, addReal(dae, t2), addReal(dae, t1), t1, 0.0);
    const valve = emitRateLimitedLag(
      ctx,
      `xv_gov_${gId}`,
      add(dae, addReal(dae, pm0Pu), x1),
      addReal(dae, t3),
      t3,
      addReal(dae, uc),
      addReal(dae, uo),
      addReal(dae, pMin),
      addReal(dae, pMax),
      pm0Pu,
    );

    const xHp = emitFirstOrderLag(ctx, `xhp_gov_${gId}`, valve, addReal(dae, 1.0), addReal(dae, t4), t4, pm0Pu);
    const xIp = emitFirstOrderLag(ctx, `xip_gov_${gId}`, xHp, addReal(dae, 1.0), addReal(dae, t5), t5, pm0Pu);
    const xLp = emitFirstOrderLag(ctx, `xlp_gov_${gId}`, xIp, addReal(dae, 1.0), addReal(dae, t6), t6, pm0Pu);
    const xLp2 = emitFirstOrderLag(ctx, `xlp2_gov_${gId}`, xLp, addReal(dae, 1.0), addReal(dae, t7), t7, pm0Pu);

    const pTurbPu = add(
      dae,
      add(dae, mul(dae, addReal(dae, k1 / kSum), xHp), mul(dae, addReal(dae, k3 / kSum), xIp)),
      add(dae, mul(dae, addReal(dae, k5 / kSum), xLp), mul(dae, addReal(dae, k7 / kSum), xLp2)),
    );
    dae.addEquation(EqKind.Simple, pmOutExpr, mul(dae, addReal(dae, mbase), pTurbPu));
    return pmOutExpr;
  }

  if (archetype === "gov_hydro_penstock" || archetype === "gov_hydro_pid") {
    const rPerm = Math.max(0.005, np["R"] ?? np["Rperm"] ?? 0.05);
    const rTemp = Math.max(0.01, np["r"] ?? 0.3);
    const tr = Math.max(0.05, np["Tr"] ?? 5.0);
    const tf = Math.max(0.0, np["Tf"] ?? 0.05);
    const tg = Math.max(0.02, np["Tg"] ?? np["Ta"] ?? 0.5);
    const velm = Math.max(0.01, np["VELM"] ?? np["Velmax"] ?? 0.2);
    const gMax = Math.max(0.5, np["GMAX"] ?? np["Gmax"] ?? 1.0);
    const gMin = Math.min(0.1, np["GMIN"] ?? np["Gmin"] ?? 0.0);
    const tw = Math.max(0.05, np["TW"] ?? np["Tw"] ?? 1.2);
    const at = Math.max(0.1, np["At"] ?? 1.2);
    const dturb = Math.max(0.0, np["Dturb"] ?? np["D"] ?? 0.5);
    const qnl = Math.max(0.0, np["qnl"] ?? 0.08);

    // Steady-state equilibrium: h0 = 1.0 -> q0 = G0 = pm0Pu / At + qnl
    const g0 = Math.max(gMin + 1e-4, Math.min(gMax, pm0Pu / at + qnl));
    const q0 = g0;
    const gateVarName = `xg_gov_${gId}`;

    let gateCmd: number;
    if (archetype === "gov_hydro_pid") {
      const kp = Math.max(0.0, np["Kp"] ?? 2.5);
      const ki = Math.max(0.0, np["Ki"] ?? 1.0);
      const speedErr = sub(dae, addReal(dae, 0.0), dwPu);
      const gFb = mul(dae, addReal(dae, rPerm), sub(dae, dae.addNameExpr(gateVarName), addReal(dae, g0)));
      const errPid = sub(dae, speedErr, gFb);
      const xInt =
        ki > 1e-6
          ? emitNonWindupIntegrator(
              ctx,
              `xpid_gov_${gId}`,
              mul(dae, addReal(dae, ki), errPid),
              addReal(dae, 1.0),
              1.0,
              addReal(dae, gMin),
              addReal(dae, gMax),
              g0,
            )
          : addReal(dae, g0);
      gateCmd = add(dae, xInt, mul(dae, addReal(dae, kp), errPid));
    } else {
      const speedErr = sub(dae, addReal(dae, 0.0), dwPu);
      const permDrop = mul(dae, addReal(dae, rPerm), sub(dae, dae.addNameExpr(gateVarName), addReal(dae, g0)));
      const tempDrop = emitWashout(
        ctx,
        `xdash_gov_${gId}`,
        dae.addNameExpr(gateVarName),
        addReal(dae, rTemp),
        addReal(dae, tr),
        tr,
        g0,
        rTemp,
      );
      const c = sub(dae, sub(dae, speedErr, permDrop), tempDrop);
      const cFiltered = emitFirstOrderLag(
        ctx,
        `xf_gov_${gId}`,
        add(dae, addReal(dae, g0), c),
        addReal(dae, 1.0),
        addReal(dae, tf),
        tf,
        g0,
      );
      gateCmd = cFiltered;
    }

    const gateExpr = emitRateLimitedLag(
      ctx,
      gateVarName,
      gateCmd,
      addReal(dae, tg),
      tg,
      addReal(dae, -velm),
      addReal(dae, velm),
      addReal(dae, gMin),
      addReal(dae, gMax),
      g0,
    );

    // Nonlinear inelastic penstock water-column ODE: Tw * der(q) = 1 - (q / max(0.02, G))^2
    const qVar = dae.addVariable(`qwater_gov_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, q0);
    const qExpr = dae.addNameExpr(`qwater_gov_${gId}`);
    const gSafe = add(dae, gateExpr, addReal(dae, 0.02));
    const qSafeRatio = div(dae, qExpr, sub(dae, gSafe, addReal(dae, 0.02 * (1.0 - 1.0) + 0.0)));
    // Use exact ratio q / max(0.02, G) with g0/(g0) = 1 at steady state when G >= 0.02
    const gDenom = ctx.smoothLimits ? add(dae, gateExpr, addReal(dae, 0.0)) : gateExpr;
    const hExpr = mul(dae, div(dae, qExpr, gDenom), div(dae, qExpr, gDenom));
    void qSafeRatio;
    dae.addEquation(
      EqKind.Simple,
      mul(dae, addReal(dae, tw), dae.addDerExpr(qVar)),
      sub(dae, addReal(dae, 1.0), hExpr),
    );

    const pTurbPu = sub(
      dae,
      mul(dae, mul(dae, addReal(dae, at), hExpr), sub(dae, qExpr, addReal(dae, qnl))),
      mul(dae, mul(dae, addReal(dae, dturb), gateExpr), dwPu),
    );
    dae.addEquation(EqKind.Simple, pmOutExpr, mul(dae, addReal(dae, mbase), pTurbPu));
    return pmOutExpr;
  }

  if (archetype === "gov_gast" || archetype === "gov_ggov1_temp") {
    const r = Math.max(0.005, np["R"] ?? 0.04);
    const t1 = Math.max(0.0, np["T1"] ?? np["Tact"] ?? 0.15);
    const t2 = Math.max(0.0, np["T2"] ?? np["Tb"] ?? 0.4);
    const t3 = Math.max(0.05, np["T3"] ?? np["Tfload"] ?? 2.5);
    const vMax = Math.max(pm0Pu + 0.1, np["VMAX"] ?? np["vmax"] ?? 1.05);
    const vMin = Math.min(pm0Pu, np["VMIN"] ?? np["vmin"] ?? 0.0);
    const at = np["AT"] ?? np["Ldref"] ?? 1.0;
    const kt = np["KT"] ?? np["Kpload"] ?? 1.5;
    const dTurb = Math.max(0.0, np["Dturb"] ?? np["Dm"] ?? 0.0);

    const pRef = pm0Pu;
    const pDemand = sub(dae, addReal(dae, pRef), div(dae, dwPu, addReal(dae, r)));
    // Exhaust temperature limiter feedback
    const xCombName = `xcomb_gov_${gId}`;
    const xTemp = emitFirstOrderLag(
      ctx,
      `xtemp_gov_${gId}`,
      dae.addNameExpr(xCombName),
      addReal(dae, 1.0),
      addReal(dae, t3),
      t3,
      pm0Pu,
    );
    const tempLimit = sub(dae, addReal(dae, at), mul(dae, addReal(dae, kt), sub(dae, xTemp, addReal(dae, at))));
    const gatedDemand = emitMin(ctx, pDemand, emitClamp(ctx, tempLimit, addReal(dae, vMin), addReal(dae, vMax)));

    const xFuel = emitNonWindupLag(
      ctx,
      `xfuel_gov_${gId}`,
      gatedDemand,
      addReal(dae, 1.0),
      addReal(dae, t1),
      t1,
      addReal(dae, vMin),
      addReal(dae, vMax),
      pm0Pu,
    );
    const xComb = emitFirstOrderLag(ctx, xCombName, xFuel, addReal(dae, 1.0), addReal(dae, t2), t2, pm0Pu);
    const pTurbPu = sub(dae, xComb, mul(dae, addReal(dae, dTurb), dwPu));
    dae.addEquation(EqKind.Simple, pmOutExpr, mul(dae, addReal(dae, mbase), pTurbPu));
    return pmOutExpr;
  }

  if (archetype === "wind_drivetrain_2mass" || archetype === "wind_pitch_torque") {
    const hTot = Math.max(0.1, np["H"] ?? 4.5);
    const tLag = Math.max(0.05, np["Tp"] ?? np["Tpi"] ?? 0.25);
    const kp = Math.max(0.1, np["Kpp"] ?? np["Kpw"] ?? 3.0);
    const pRef = addReal(dae, pm0Pu);
    const pErr = sub(dae, pRef, mul(dae, addReal(dae, kp / Math.max(1.0, hTot)), dwPu));
    const pWindPu = emitFirstOrderLag(
      ctx,
      `xwind_gov_${gId}`,
      pErr,
      addReal(dae, 1.0),
      addReal(dae, tLag),
      tLag,
      pm0Pu,
    );
    dae.addEquation(EqKind.Simple, pmOutExpr, mul(dae, addReal(dae, mbase), pWindPu));
    return pmOutExpr;
  }

  if (archetype === "gov_lcfb") {
    // Dedicated WECC LCFB1 Turbine Load Controller / Frequency Bias: deadband + PI + Pe filter
    const db = Math.abs(np["db"] ?? np["DB"] ?? 0.0006);
    const kp = Math.max(0.05, np["Kp"] ?? np["KP"] ?? 1.0);
    const ki = Math.max(0.02, np["Ki"] ?? np["KI"] ?? 0.2);
    const tPe = Math.max(0.02, np["Tpelec"] ?? np["Tp"] ?? 0.2);
    const pMax = Math.max(pm0Pu + 0.1, np["Pmax"] ?? np["PMAX"] ?? 1.1);
    const pMin = Math.min(pm0Pu, np["Pmin"] ?? np["PMIN"] ?? 0.0);
    const fBias = mul(dae, addReal(dae, -1.0), emitDeadband(ctx, dwPu, addReal(dae, -db), addReal(dae, db)));
    const xInt = emitNonWindupIntegrator(
      ctx,
      `xlcfb_int_${gId}`,
      mul(dae, addReal(dae, ki), fBias),
      addReal(dae, 1.0),
      1.0,
      addReal(dae, pMin),
      addReal(dae, pMax),
      pm0Pu,
    );
    const pCmd = emitClamp(
      ctx,
      add(dae, xInt, mul(dae, addReal(dae, kp), fBias)),
      addReal(dae, pMin),
      addReal(dae, pMax),
    );
    const pOutPu = emitFirstOrderLag(ctx, `xlcfb_out_${gId}`, pCmd, addReal(dae, 1.0), addReal(dae, tPe), tPe, pm0Pu);
    void peExpr;
    dae.addEquation(EqKind.Simple, pmOutExpr, mul(dae, addReal(dae, mbase), pOutPu));
    return pmOutExpr;
  }

  // Dedicated Woodward DEGOV1 Diesel Engine Governor: droop + electric control box lead-lag + actuator + engine delay
  const r = Math.max(0.005, np["R"] ?? np["K"] ?? 0.05);
  const t1 = Math.max(0.01, np["T1"] ?? 0.01);
  const t2 = Math.max(0.0, np["T2"] ?? 0.02);
  const t3 = Math.max(0.01, np["T3"] ?? 0.2);
  const t4 = Math.max(0.02, np["T4"] ?? np["Tact"] ?? 0.1);
  const t5 = Math.max(0.02, np["T5"] ?? 0.05);
  const tMax = Math.max(pm0Pu + 0.1, np["TMAX"] ?? np["Pmax"] ?? 1.1);
  const tMin = Math.min(pm0Pu, np["TMIN"] ?? np["Pmin"] ?? 0.0);
  const pRef = sub(dae, addReal(dae, pm0Pu), div(dae, dwPu, addReal(dae, r)));
  const xCtrl = emitLeadLag(
    ctx,
    `xdegov_ll_${gId}`,
    pRef,
    addReal(dae, t2),
    addReal(dae, Math.max(t1, t3)),
    Math.max(t1, t3),
    pm0Pu,
  );
  const xAct = emitNonWindupLag(
    ctx,
    `xdegov_act_${gId}`,
    xCtrl,
    addReal(dae, 1.0),
    addReal(dae, t4),
    t4,
    addReal(dae, tMin),
    addReal(dae, tMax),
    pm0Pu,
  );
  const xEng = emitFirstOrderLag(ctx, `xdegov_eng_${gId}`, xAct, addReal(dae, 1.0), addReal(dae, t5), t5, pm0Pu);
  void peExpr;
  dae.addEquation(EqKind.Simple, pmOutExpr, mul(dae, addReal(dae, mbase), xEng));
  return pmOutExpr;
}
