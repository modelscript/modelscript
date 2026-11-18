// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { DaeArchetypeId } from "../../schema/index.js";
import type { PsseDyrRecord } from "../../types.js";
import {
  add,
  addReal,
  computeQuadraticSatCoeffs,
  div,
  emitClamp,
  emitFirstOrderLag,
  emitLeadLag,
  emitMax,
  emitMin,
  emitNonWindupIntegrator,
  emitNonWindupLag,
  emitSaturationCurve,
  emitWashout,
  evalQuadraticSat,
  mul,
  sub,
  type DaeBlockContext,
} from "../blocks.js";
import type { GeneratorSteadyInit } from "../init-steady-state.js";

/**
 * Lowers IEEE Std 421.5 / WECC excitation systems, compensators, and OEL/UEL/VHz limiters
 * directly into linear-memory `DAEBuilder` variables and equations with exact steady-state Vref0.
 */
export function lowerExciterUnitToDae(
  ctx: DaeBlockContext,
  genInit: GeneratorSteadyInit,
  dyrExc: PsseDyrRecord,
  archetype: DaeArchetypeId,
  vtBusExpr: number,
  vsPssExpr: number,
  ifdExpr: number,
  idExpr: number,
  iqExpr: number,
  limiters: PsseDyrRecord[] = [],
): number {
  const { dae } = ctx;
  const gId = genInit.genKey;
  const np = dyrExc.namedParams;
  const efd0 = genInit.efd0;

  // 1. Optional reactive current compensator (COMP / IEEEVC)
  let vtCompExpr = vtBusExpr;
  const compRec = limiters.find((r) => r.model === "COMP" || r.model === "COMPCC" || r.model === "IEEEVC");
  if (compRec) {
    const rc = compRec.namedParams["Rc"] ?? 0.0;
    const xc = compRec.namedParams["Xc"] ?? 0.0;
    if (Math.abs(rc) > 1e-6 || Math.abs(xc) > 1e-6) {
      // Linearized reactive-droop compensation: Vc = Vt + Rc*Ip_eq + Xc*Iq_eq
      const iProj = div(
        dae,
        addReal(dae, genInit.pPu * rc + genInit.qPu * xc),
        emitMax(ctx, addReal(dae, 0.2), vtBusExpr),
      );
      vtCompExpr = add(dae, vtBusExpr, iProj);
    }
  }

  // 2. Voltage sensing transducer TR
  const trNum = Math.max(0.0, np["TR"] ?? 0.02);
  const vtFiltExpr = emitFirstOrderLag(
    ctx,
    `Vt_f_${gId}`,
    vtCompExpr,
    addReal(dae, 1.0),
    addReal(dae, trNum),
    trNum,
    genInit.vt,
  );

  // 3. Optional OEL / UEL / VHz limiters attached to this generator unit
  let limSummingAdd = addReal(dae, 0.0);
  let uelHvGateExpr: number | null = null;
  let oelLvGateExpr: number | null = null;

  for (const lim of limiters) {
    const lnp = lim.namedParams;
    if (lim.model.startsWith("MAXEX") || lim.model.startsWith("OEL")) {
      const ifdLim = Math.max(1.0, lnp["Ifdlim"] ?? 2.8);
      const kr = Math.max(0.1, lnp["Kr"] ?? 2.0);
      const trLim = Math.max(0.0, lnp["Tr"] ?? 0.05);
      const vMin = lnp["Vrefmin"] ?? -0.5;
      const ifdF = emitFirstOrderLag(
        ctx,
        `Ifd_oel_${gId}`,
        ifdExpr,
        addReal(dae, 1.0),
        addReal(dae, trLim),
        trLim,
        efd0,
      );
      const overIfd = emitMax(ctx, addReal(dae, 0.0), sub(dae, ifdF, addReal(dae, ifdLim)));
      const oelOut = emitMax(ctx, addReal(dae, vMin), mul(dae, addReal(dae, -kr), overIfd));
      if (lim.icons?.[0] === 0) {
        limSummingAdd = add(dae, limSummingAdd, oelOut);
      } else {
        oelLvGateExpr = oelOut;
      }
    } else if (lim.model.startsWith("UEL") || lim.model.startsWith("MNLEX")) {
      const qMin0 = lnp["Qmin0"] ?? -0.4;
      const k1 = Math.max(0.1, lnp["K1"] ?? 2.0);
      const vMax = lnp["Vuelmax"] ?? 0.5;
      const vMin = lnp["Vuelmin"] ?? 0.0;
      const qUnitExpr = sub(dae, mul(dae, vtBusExpr, idExpr), mul(dae, addReal(dae, 0.0), iqExpr));
      const underQ = emitMax(
        ctx,
        addReal(dae, 0.0),
        sub(dae, addReal(dae, qMin0), mul(dae, addReal(dae, -1.0), qUnitExpr)),
      );
      const uelOut = emitClamp(ctx, mul(dae, addReal(dae, k1), underQ), addReal(dae, vMin), addReal(dae, vMax));
      if (lim.icons?.[0] === 0) {
        limSummingAdd = add(dae, limSummingAdd, uelOut);
      } else {
        uelHvGateExpr = uelOut;
      }
    } else if (lim.model.startsWith("VHZ")) {
      const vhzLim = Math.max(1.0, lnp["VHzlim"] ?? 1.1);
      const kv = Math.max(0.1, lnp["Kv"] ?? 5.0);
      const vMin = lnp["Vlimmin"] ?? -0.5;
      const overV = emitMax(ctx, addReal(dae, 0.0), sub(dae, vtFiltExpr, addReal(dae, vhzLim)));
      limSummingAdd = add(dae, limSummingAdd, emitMax(ctx, addReal(dae, vMin), mul(dae, addReal(dae, -kv), overV)));
    }
  }

  // Output field voltage variable Efd_${gId}
  const efdVar = dae.addVariable(`Efd_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, efd0);
  const efdOutExpr = dae.addNameExpr(`Efd_${gId}`);

  if (archetype === "exc_sexs" || archetype === "exc_scrx") {
    const k = Math.max(1.0, np["K"] ?? 100.0);
    const tb = Math.max(0.0, np["TB"] ?? 10.0);
    const tatb = Math.max(0.0, np["TATB"] ?? 0.1);
    const tc = tatb * tb;
    const te = Math.max(0.0, np["TE"] ?? 0.1);
    const emin = np["EMIN"] ?? (archetype === "exc_scrx" ? -4.0 : 0.0);
    const emax = Math.max(efd0 + 0.5, np["EMAX"] ?? 5.0);

    const vref0 = genInit.vt + efd0 / k;
    const vErr = add(dae, add(dae, sub(dae, addReal(dae, vref0), vtFiltExpr), vsPssExpr), limSummingAdd);
    const vll = emitLeadLag(ctx, `xll_exc_${gId}`, vErr, addReal(dae, tc), addReal(dae, tb), tb, efd0 / k);

    const isBusFed = archetype === "exc_scrx" && (np["CSWITCH"] ?? 0) === 0;
    const eMaxEff = isBusFed ? mul(dae, addReal(dae, emax), vtBusExpr) : addReal(dae, emax);
    const eMinEff = isBusFed ? mul(dae, addReal(dae, emin), vtBusExpr) : addReal(dae, emin);

    const efdLag = emitNonWindupLag(
      ctx,
      `Efd_nw_${gId}`,
      vll,
      addReal(dae, k),
      addReal(dae, te),
      te,
      eMinEff,
      eMaxEff,
      efd0,
    );
    dae.addEquation(EqKind.Simple, efdOutExpr, efdLag);
    return efdOutExpr;
  }

  if (archetype === "exc_ieee_dc") {
    const ka = Math.max(1.0, np["KA"] ?? 50.0);
    const ta = Math.max(0.0, np["TA"] ?? 0.05);
    const tb = Math.max(0.0, np["TB"] ?? 0.0);
    const tc = Math.max(0.0, np["TC"] ?? 0.0);
    const vrMax = Math.max(1.0, np["VRMAX"] ?? 4.0);
    const vrMin = Math.min(-0.5, np["VRMIN"] ?? -4.0);
    const ke = np["KE"] ?? 1.0;
    const te = Math.max(0.01, np["TE"] ?? 0.5);
    const kf = Math.max(0.0, np["KF"] ?? 0.03);
    const tf = Math.max(0.02, np["TF"] ?? np["TF1"] ?? 1.0);
    const e1 = np["E1"] ?? 2.5;
    const se1 = np["SE1"] ?? 0.1;
    const e2 = np["E2"] ?? 3.5;
    const se2 = np["SE2"] ?? 0.5;

    const satVal0 = evalQuadraticSat(efd0, computeQuadraticSatCoeffs(e1, se1, e2, se2));
    const vr0 = (ke + satVal0) * efd0;
    const vref0 = genInit.vt + vr0 / ka;

    // Rate feedback washout: s*KF / (1 + s*TF) on Efd
    const vfExpr = emitWashout(ctx, `Vf_exc_${gId}`, efdOutExpr, addReal(dae, kf), addReal(dae, tf), tf, efd0, kf);
    const vSum = add(
      dae,
      sub(dae, add(dae, sub(dae, addReal(dae, vref0), vtFiltExpr), vsPssExpr), vfExpr),
      limSummingAdd,
    );
    const vTgr = emitLeadLag(ctx, `xll_exc_${gId}`, vSum, addReal(dae, tc), addReal(dae, tb), tb, vr0 / ka);
    const vrExpr = emitNonWindupLag(
      ctx,
      `Vr_exc_${gId}`,
      vTgr,
      addReal(dae, ka),
      addReal(dae, ta),
      ta,
      addReal(dae, vrMin),
      addReal(dae, vrMax),
      vr0,
    );

    const satEfd = mul(dae, emitSaturationCurve(ctx, efdOutExpr, e1, se1, e2, se2), efdOutExpr);
    // TE * der(Efd) = Vr - (KE * Efd + SE(Efd) * Efd)
    dae.addEquation(
      EqKind.Simple,
      mul(dae, addReal(dae, te), dae.addDerExpr(efdVar)),
      sub(dae, vrExpr, add(dae, mul(dae, addReal(dae, ke), efdOutExpr), satEfd)),
    );
    return efdOutExpr;
  }

  if (archetype === "exc_ieee_ac") {
    const ka = Math.max(1.0, np["KA"] ?? 200.0);
    const ta = Math.max(0.0, np["TA"] ?? 0.04);
    const tb = Math.max(0.0, np["TB"] ?? 0.0);
    const tc = Math.max(0.0, np["TC"] ?? 0.0);
    const vrMax = Math.max(1.0, np["VRMAX"] ?? 8.0);
    const vrMin = Math.min(-0.5, np["VRMIN"] ?? -6.0);
    const te = Math.max(0.01, np["TE"] ?? 0.8);
    const kf = Math.max(0.0, np["KF"] ?? 0.03);
    const tf = Math.max(0.02, np["TF"] ?? 1.0);
    const kc = Math.max(0.0, np["KC"] ?? 0.2);
    const kd = Math.max(0.0, np["KD"] ?? 0.38);
    const ke = np["KE"] ?? 1.0;
    const e1 = np["E1"] ?? 3.1;
    const se1 = np["SE1"] ?? 0.03;
    const e2 = np["E2"] ?? 4.2;
    const se2 = np["SE2"] ?? 0.1;

    const excModel = (dyrExc?.model ?? "").toUpperCase();
    const kh = excModel.includes("AC2A") ? Math.max(0.0, np["KH"] ?? 1.0) : 0.0;
    const vlr = excModel.includes("AC2A") ? Math.max(0.5, np["VLR"] ?? 4.4) : 999.0;
    const klv = excModel.includes("AC3A") ? Math.max(0.0, np["KLV"] ?? 0.0) : 0.0;
    const vlv = excModel.includes("AC3A") ? Math.max(0.1, np["VLV"] ?? 0.79) : 0.0;
    const kpAc8 = excModel.includes("AC8B") ? Math.max(0.0, np["KP"] ?? 18.0) : 0.0;
    const kiAc8 = excModel.includes("AC8B") ? Math.max(0.0, np["KI"] ?? 5.0) : 0.0;

    // Steady-state Ve0 solving Efd0 = Ve0 * F_EX(KC * Ifd0 / Ve0)
    const ve0 = Math.max(0.5, efd0 + 0.577 * kc * efd0);
    const satVe0 = evalQuadraticSat(ve0, computeQuadraticSatCoeffs(e1, se1, e2, se2));
    const vfe0 = (ke + satVe0) * ve0 + kd * efd0;
    const vr0 = vfe0;
    const vref0 = excModel.includes("AC8B") ? genInit.vt : genInit.vt + vr0 / ka;

    const veVar = dae.addVariable(`Ve_exc_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, ve0);
    const veExpr = dae.addNameExpr(`Ve_exc_${gId}`);

    const uVf0 = ke * ve0 + kd * efd0;
    const vfExpr = emitWashout(
      ctx,
      `Vf_exc_${gId}`,
      add(dae, mul(dae, addReal(dae, ke), veExpr), mul(dae, addReal(dae, kd), ifdExpr)),
      addReal(dae, kf),
      addReal(dae, tf),
      tf,
      uVf0,
      kf,
    );
    const vSum = add(
      dae,
      sub(dae, add(dae, sub(dae, addReal(dae, vref0), vtFiltExpr), vsPssExpr), vfExpr),
      limSummingAdd,
    );
    const vTgr = emitLeadLag(
      ctx,
      `xll_exc_${gId}`,
      vSum,
      addReal(dae, tc),
      addReal(dae, tb),
      tb,
      excModel.includes("AC8B") ? 0.0 : vr0 / ka,
    );
    let avrDrive = vTgr;
    if (excModel.includes("AC8B")) {
      const xiVar = dae.addVariable(`xi_ac8b_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, vr0 / ka);
      dae.addEquation(EqKind.Simple, dae.addDerExpr(xiVar), mul(dae, addReal(dae, kiAc8), vTgr));
      avrDrive = add(dae, mul(dae, addReal(dae, kpAc8), vTgr), dae.addNameExpr(`xi_ac8b_${gId}`));
    }
    const vrExprRaw = emitNonWindupLag(
      ctx,
      `Vr_exc_${gId}`,
      avrDrive,
      addReal(dae, ka),
      addReal(dae, ta),
      ta,
      addReal(dae, vrMin),
      addReal(dae, vrMax),
      vr0,
    );

    const satVe = mul(dae, emitSaturationCurve(ctx, veExpr, e1, se1, e2, se2), veExpr);
    const vfeExpr = add(dae, add(dae, mul(dae, addReal(dae, ke), veExpr), satVe), mul(dae, addReal(dae, kd), ifdExpr));
    // ESAC2A high-level field current limiter feedback: KH * max(0, Vfe - VLR)
    const vfeLimFb =
      kh > 0
        ? mul(dae, addReal(dae, kh), emitMax(ctx, addReal(dae, 0.0), sub(dae, vfeExpr, addReal(dae, vlr))))
        : addReal(dae, 0.0);
    // ESAC3A low-voltage limiter ceiling reduction: KLV * max(0, VLV - Vt)
    const ac3aLimFb =
      klv > 0
        ? mul(dae, addReal(dae, klv), emitMax(ctx, addReal(dae, 0.0), sub(dae, addReal(dae, vlv), vtFiltExpr)))
        : addReal(dae, 0.0);
    const vrExpr = sub(dae, sub(dae, vrExprRaw, vfeLimFb), ac3aLimFb);
    // TE * der(Ve) = Vr - Vfe
    dae.addEquation(EqKind.Simple, mul(dae, addReal(dae, te), dae.addDerExpr(veVar)), sub(dae, vrExpr, vfeExpr));

    // IEEE Std 421.5 3-segment rectifier regulation curve F_EX(I_N)
    const inExpr = div(dae, mul(dae, addReal(dae, kc), ifdExpr), emitMax(ctx, addReal(dae, 0.1), veExpr));
    let fexExpr: number;
    if (ctx.smoothLimits) {
      fexExpr = emitMax(ctx, addReal(dae, 0.0), sub(dae, addReal(dae, 1.0), mul(dae, addReal(dae, 0.577), inExpr)));
    } else {
      const seg1 = sub(dae, addReal(dae, 1.0), mul(dae, addReal(dae, 0.577), inExpr));
      const rad2 = emitMax(ctx, addReal(dae, 0.0), sub(dae, addReal(dae, 0.75), mul(dae, inExpr, inExpr)));
      const seg2 = dae.addCallExpr("sqrt", [rad2]);
      const seg3 = mul(dae, addReal(dae, 1.732), sub(dae, addReal(dae, 1.0), inExpr));
      fexExpr = dae.addIfElseExpr(
        dae.addBinaryExpr(BinOp.Lte, inExpr, addReal(dae, 0.433)),
        seg1,
        dae.addIfElseExpr(
          dae.addBinaryExpr(BinOp.Lt, inExpr, addReal(dae, 0.75)),
          seg2,
          dae.addIfElseExpr(dae.addBinaryExpr(BinOp.Lte, inExpr, addReal(dae, 1.0)), seg3, addReal(dae, 0.0)),
        ),
      );
    }
    dae.addEquation(EqKind.Simple, efdOutExpr, mul(dae, veExpr, fexExpr));
    return efdOutExpr;
  }

  if (archetype === "exc_st4b_pi" || archetype === "exc_pid") {
    const kpr = Math.max(0.1, np["KPR"] ?? np["KP"] ?? 10.0);
    const kir = Math.max(0.0, np["KIR"] ?? np["KI"] ?? 10.0);
    const vrMax = Math.max(1.0, np["VRMAX"] ?? 8.0);
    const vrMin = Math.min(-0.5, np["VRMIN"] ?? -6.0);
    const ta = Math.max(0.0, np["TA"] ?? 0.02);
    const vbMax = Math.max(efd0 + 1.0, np["VBMAX"] ?? vrMax);
    const kpPot = Math.max(0.5, np["KP"] ?? 5.0);
    const kc = Math.max(0.0, np["KC"] ?? 0.08);

    const kpm = archetype === "exc_st4b_pi" ? Math.max(0.1, np["KPM"] ?? 1.0) : 1.0;
    const vrTarget0 = efd0 / Math.max(0.1, kpm);
    const vref0 = genInit.vt;

    const vErr = add(dae, add(dae, sub(dae, addReal(dae, vref0), vtFiltExpr), vsPssExpr), limSummingAdd);
    const xInt =
      kir > 1e-6
        ? emitNonWindupIntegrator(
            ctx,
            `xpi_exc_${gId}`,
            mul(dae, addReal(dae, kir), vErr),
            addReal(dae, 1.0),
            1.0,
            addReal(dae, vrMin),
            addReal(dae, vrMax),
            vrTarget0,
          )
        : addReal(dae, vrTarget0);
    const vrCmd = emitClamp(
      ctx,
      add(dae, mul(dae, addReal(dae, kpr), vErr), xInt),
      addReal(dae, vrMin),
      addReal(dae, vrMax),
    );
    const maxAvail = mul(dae, addReal(dae, vbMax), addReal(dae, 1.0));
    const ceiling = emitMin(
      ctx,
      maxAvail,
      sub(dae, mul(dae, addReal(dae, kpPot), vtBusExpr), mul(dae, addReal(dae, kc), ifdExpr)),
    );
    const efdLag = emitNonWindupLag(
      ctx,
      `Efd_nw_${gId}`,
      vrCmd,
      addReal(dae, kpm),
      addReal(dae, ta),
      ta,
      addReal(dae, vrMin),
      emitMax(ctx, addReal(dae, 0.5), ceiling),
      efd0,
    );
    dae.addEquation(EqKind.Simple, efdOutExpr, efdLag);
    return efdOutExpr;
  }

  // Default: IEEE ST1 / ESST1A / ESAC4A potential/controlled-rectifier static exciter (`exc_ieee_st`)
  const ka = Math.max(1.0, np["KA"] ?? 200.0);
  const ta = Math.max(0.0, np["TA"] ?? 0.02);
  const tb = Math.max(0.0, np["TB"] ?? 1.0);
  const tc = Math.max(0.0, np["TC"] ?? 1.0);
  const tb1 = Math.max(0.0, np["TB1"] ?? 0.0);
  const tc1 = Math.max(0.0, np["TC1"] ?? 0.0);
  const viMax = np["VIMAX"] ?? 0.2;
  const viMin = np["VIMIN"] ?? -0.2;
  const vrMax = Math.max(1.0, np["VRMAX"] ?? 5.0);
  const vrMin = Math.min(-0.5, np["VRMIN"] ?? -5.0);
  const kc = Math.max(0.0, np["KC"] ?? 0.05);
  const kf = Math.max(0.0, np["KF"] ?? 0.0);
  const tf = Math.max(0.02, np["TF"] ?? 1.0);

  const vref0 = genInit.vt + efd0 / ka;
  const vfExpr = emitWashout(ctx, `Vf_exc_${gId}`, efdOutExpr, addReal(dae, kf), addReal(dae, tf), tf, efd0, kf);

  let vSum = add(dae, sub(dae, add(dae, sub(dae, addReal(dae, vref0), vtFiltExpr), vsPssExpr), vfExpr), limSummingAdd);
  if (uelHvGateExpr !== null) vSum = emitMax(ctx, vSum, uelHvGateExpr);
  if (oelLvGateExpr !== null) vSum = emitMin(ctx, vSum, oelLvGateExpr);

  const vErrClamped = emitClamp(ctx, vSum, addReal(dae, viMin), addReal(dae, viMax));
  const vTgr1 = emitLeadLag(ctx, `xll1_exc_${gId}`, vErrClamped, addReal(dae, tc), addReal(dae, tb), tb, efd0 / ka);
  const vTgr2 = emitLeadLag(ctx, `xll2_exc_${gId}`, vTgr1, addReal(dae, tc1), addReal(dae, tb1), tb1, efd0 / ka);

  const ilr = np["ILR"] ?? 4.0;
  const klr = Math.max(0.0, np["KLR"] ?? 0.0);
  const lrTerm =
    dyrExc.model === "ESST1A" && klr > 0
      ? mul(dae, addReal(dae, klr), emitMax(ctx, addReal(dae, 0.0), sub(dae, ifdExpr, addReal(dae, ilr))))
      : addReal(dae, 0.0);

  const efdCeilingHi = sub(
    dae,
    sub(dae, mul(dae, addReal(dae, vrMax), vtBusExpr), mul(dae, addReal(dae, kc), ifdExpr)),
    lrTerm,
  );
  const efdCeilingLo = mul(dae, addReal(dae, vrMin), vtBusExpr);
  const vrOut = emitNonWindupLag(
    ctx,
    `Vr_exc_${gId}`,
    vTgr2,
    addReal(dae, ka),
    addReal(dae, ta),
    ta,
    efdCeilingLo,
    emitMax(ctx, addReal(dae, 0.2), efdCeilingHi),
    efd0,
  );
  dae.addEquation(EqKind.Simple, efdOutExpr, vrOut);
  return efdOutExpr;
}
