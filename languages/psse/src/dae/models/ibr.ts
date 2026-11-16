// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, EqKind, Variability, VarType } from "@modelscript/runtime";
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
  emitMax,
  emitMin,
  emitNonWindupIntegrator,
  emitRateLimitedLag,
  mul,
  sub,
  type DaeBlockContext,
} from "../blocks.js";
import type { GeneratorSteadyInit } from "../init-steady-state.js";

export interface LoweredIbrPort {
  irSysExpr: number;
  iiSysExpr: number;
  pOutMwExpr: number;
  qOutMvarExpr: number;
}

/**
 * Lowers WECC 2nd/3rd-Gen IBR chains (`REPC_A/B` -> `REEC_A/B/C/D` -> `REGC_A/B/C`),
 * `DER_A` aggregate DER, and `REGFM_A1` grid-forming VSM/droop inverters into `DAEBuilder`.
 */
export function lowerIbrUnitToDae(
  ctx: DaeBlockContext,
  genInit: GeneratorSteadyInit,
  dyrGen: PsseDyrRecord,
  dyrReec: PsseDyrRecord | undefined,
  dyrRepc: PsseDyrRecord | undefined,
  archetype: DaeArchetypeId,
  sbase: number,
  omega0: number,
  vrBusExpr: number,
  viBusExpr: number,
  busFreqPuExpr: number,
): LoweredIbrPort {
  const { dae } = ctx;
  const gId = genInit.genKey;
  const mbase = genInit.mbase;
  const mbaseScale = mbase / sbase;
  const vt0 = Math.max(0.1, genInit.vt);
  const p0Pu = genInit.pPu;
  const q0Pu = genInit.qPu;

  const vt2 = add(dae, mul(dae, vrBusExpr, vrBusExpr), mul(dae, viBusExpr, viBusExpr));
  const vtExpr = dae.addCallExpr("sqrt", [emitMax(ctx, addReal(dae, 1e-4), vt2)]);
  const vtSafe = emitMax(ctx, addReal(dae, 0.05), vtExpr);

  // Unit voltage phasor cos/sin(theta_V) for rotating (Ip, Iq) into network (Ir, Ii)
  const cosTheta = div(dae, vrBusExpr, vtSafe);
  const sinTheta = div(dae, viBusExpr, vtSafe);

  const gnp = dyrGen.namedParams;

  // === Grid-Forming Inverter (REGFM_A1 / WECCGFM) ===
  if (archetype === "ibr_regfm_vsm") {
    const mp = Math.max(0.002, gnp["mp"] ?? 0.05);
    const mq = Math.max(0.0, gnp["mq"] ?? 0.05);
    const tp = Math.max(0.005, gnp["Tp"] ?? 0.02);
    const tq = Math.max(0.005, gnp["Tq"] ?? 0.02);
    const rv = Math.max(0.001, gnp["Rv"] ?? 0.01);
    const xv = Math.max(0.02, gnp["Xv"] ?? 0.15);
    const hSynth = Math.max(0.0, gnp["H"] ?? 2.0);
    const modeVsm = dyrGen.icons?.[0] === 1;

    // Internal EMF E_gfm behind Rv + j*Xv
    const e0r = genInit.vr + rv * genInit.irNet - xv * genInit.iiNet;
    const e0i = genInit.vi + rv * genInit.iiNet + xv * genInit.irNet;
    const e0Mag = Math.max(0.2, Math.hypot(e0r, e0i));
    const delta0 = Math.atan2(e0i, e0r);

    const deltaVar = dae.addVariable(`delta_gfm_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, delta0);
    dae.addVariable(`Ir_gfm_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.irNet);
    dae.addVariable(`Ii_gfm_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.iiNet);
    const deltaExpr = dae.addNameExpr(`delta_gfm_${gId}`);
    const irExpr = dae.addNameExpr(`Ir_gfm_${gId}`);
    const iiExpr = dae.addNameExpr(`Ii_gfm_${gId}`);

    const pMeas = add(dae, mul(dae, vrBusExpr, irExpr), mul(dae, viBusExpr, iiExpr));
    const qMeas = sub(dae, mul(dae, viBusExpr, irExpr), mul(dae, vrBusExpr, iiExpr));
    const pFltr = emitFirstOrderLag(ctx, `Pfltr_gfm_${gId}`, pMeas, addReal(dae, 1.0), addReal(dae, tp), tp, p0Pu);
    const qFltr = emitFirstOrderLag(ctx, `Qfltr_gfm_${gId}`, qMeas, addReal(dae, 1.0), addReal(dae, tq), tq, q0Pu);

    if (modeVsm && hSynth > 0.05) {
      const omegaVar = dae.addVariable(
        `omega_gfm_${gId}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        omega0,
      );
      const omegaExpr = dae.addNameExpr(`omega_gfm_${gId}`);
      const dwPu = div(dae, sub(dae, omegaExpr, addReal(dae, omega0)), addReal(dae, omega0));
      dae.addEquation(EqKind.Simple, dae.addDerExpr(deltaVar), sub(dae, omegaExpr, addReal(dae, omega0)));
      // 2*H * der(dwPu) = (P0 - Pfltr) - (1/mp) * dwPu
      dae.addEquation(
        EqKind.Simple,
        mul(dae, addReal(dae, (2.0 * hSynth) / omega0), dae.addDerExpr(omegaVar)),
        sub(dae, sub(dae, addReal(dae, p0Pu), pFltr), div(dae, dwPu, addReal(dae, mp))),
      );
    } else {
      // P-f droop: der(delta) = omega0 * mp * (P0 - Pfltr)
      dae.addEquation(
        EqKind.Simple,
        dae.addDerExpr(deltaVar),
        mul(dae, addReal(dae, omega0 * mp), sub(dae, addReal(dae, p0Pu), pFltr)),
      );
    }

    const eMagExpr = add(dae, addReal(dae, e0Mag), mul(dae, addReal(dae, mq), sub(dae, addReal(dae, q0Pu), qFltr)));
    const erExpr = mul(dae, eMagExpr, dae.addCallExpr("cos", [deltaExpr]));
    const eiExpr = mul(dae, eMagExpr, dae.addCallExpr("sin", [deltaExpr]));

    // Virtual impedance stator algebraic: Er - Vr = Rv*Ir - Xv*Ii ; Ei - Vi = Rv*Ii + Xv*Ir
    dae.addEquation(
      EqKind.Simple,
      sub(dae, erExpr, vrBusExpr),
      sub(dae, mul(dae, addReal(dae, rv), irExpr), mul(dae, addReal(dae, xv), iiExpr)),
    );
    dae.addEquation(
      EqKind.Simple,
      sub(dae, eiExpr, viBusExpr),
      add(dae, mul(dae, addReal(dae, rv), iiExpr), mul(dae, addReal(dae, xv), irExpr)),
    );

    const irSysExpr = mul(dae, addReal(dae, mbaseScale), irExpr);
    const iiSysExpr = mul(dae, addReal(dae, mbaseScale), iiExpr);
    return {
      irSysExpr,
      iiSysExpr,
      pOutMwExpr: mul(dae, addReal(dae, mbase), pMeas),
      qOutMvarExpr: mul(dae, addReal(dae, mbase), qMeas),
    };
  }

  // === Aggregate Distributed Energy Resource (DER_A) ===
  if (archetype === "ibr_dera_aggregate") {
    const trv = Math.max(0.0, gnp["Trv"] ?? 0.02);
    const kqv = Math.max(0.0, gnp["Kqv"] ?? 2.0);
    const tp = Math.max(0.005, gnp["Tp"] ?? 0.02);
    const tiq = Math.max(0.005, gnp["Tiq"] ?? 0.02);
    const ddn = Math.max(0.0, gnp["Ddn"] ?? 20.0);
    const dup = Math.max(0.0, gnp["Dup"] ?? 20.0);
    const fdbd1 = gnp["fdbd1"] ?? -0.0006;
    const fdbd2 = gnp["fdbd2"] ?? 0.0006;
    const iMax = Math.max(0.5, gnp["Imax"] ?? 1.2);

    const vFltr = emitFirstOrderLag(ctx, `Vfltr_der_${gId}`, vtExpr, addReal(dae, 1.0), addReal(dae, trv), trv, vt0);
    const dfPu = sub(dae, busFreqPuExpr, addReal(dae, 1.0));
    const dfDb = emitDeadband(ctx, dfPu, addReal(dae, fdbd1), addReal(dae, fdbd2));
    const pRef = emitClamp(
      ctx,
      sub(dae, addReal(dae, p0Pu), mul(dae, addReal(dae, 0.5 * (ddn + dup)), dfDb)),
      addReal(dae, 0.0),
      addReal(dae, iMax * vt0),
    );
    const ipCmd = emitClamp(
      ctx,
      div(dae, pRef, emitMax(ctx, addReal(dae, 0.2), vFltr)),
      addReal(dae, 0.0),
      addReal(dae, iMax),
    );
    const iqCmd = emitClamp(
      ctx,
      add(dae, addReal(dae, genInit.iq0Ibr), mul(dae, addReal(dae, kqv), sub(dae, addReal(dae, vt0), vFltr))),
      addReal(dae, -iMax),
      addReal(dae, iMax),
    );

    const ipExpr = emitFirstOrderLag(ctx, `Ip_der_${gId}`, ipCmd, addReal(dae, 1.0), addReal(dae, tp), tp, genInit.ip0);
    const iqExpr = emitFirstOrderLag(
      ctx,
      `Iq_der_${gId}`,
      iqCmd,
      addReal(dae, 1.0),
      addReal(dae, tiq),
      tiq,
      genInit.iq0Ibr,
    );

    // Network current (Ir, Ii) = (Ip*cos - Iq*sin, Ip*sin + Iq*cos) on machine base
    // Note: Q = Vi*Ir - Vr*Ii = Vt * (cos*Ii - sin*Ir)? Wait: check Q sign!
    // Ir*Vr + Ii*Vi = Vt * (Ip*(cos^2+sin^2)) = Vt * Ip = P -> exact!
    // Vi*Ir - Vr*Ii = Vt * (sin*(Ip*cos - Iq*sin) - cos*(Ip*sin + Iq*cos)) = -Vt * Iq!
    // In WECC REGC_A convention, reactive current Iq > 0 is capacitive injection (+Q) so Ir = Ip*cos + Iq*sin, Ii = Ip*sin - Iq*cos!
    const irMach = add(dae, mul(dae, ipExpr, cosTheta), mul(dae, iqExpr, sinTheta));
    const iiMach = sub(dae, mul(dae, ipExpr, sinTheta), mul(dae, iqExpr, cosTheta));
    return {
      irSysExpr: mul(dae, addReal(dae, mbaseScale), irMach),
      iiSysExpr: mul(dae, addReal(dae, mbaseScale), iiMach),
      pOutMwExpr: mul(dae, addReal(dae, mbase), mul(dae, vtExpr, ipExpr)),
      qOutMvarExpr: mul(dae, addReal(dae, mbase), mul(dae, vtExpr, iqExpr)),
    };
  }

  // === Standard WECC 2nd-Gen Chain: REPC -> REEC -> REGC ===
  let pExtPu = addReal(dae, p0Pu);
  let qExtPu = addReal(dae, q0Pu);

  if (dyrRepc) {
    const pnp = dyrRepc.namedParams;
    const tFltr = Math.max(0.0, pnp["Tfltr"] ?? 0.02);
    const kpQ = Math.max(0.0, pnp["Kp"] ?? 18.0);
    const kiQ = Math.max(0.0, pnp["Ki"] ?? 5.0);
    const tft = Math.max(0.0, pnp["Tft"] ?? 0.0);
    const tfv = Math.max(0.0, pnp["Tfv"] ?? 0.05);
    const qMax = pnp["Qmax"] ?? 0.436;
    const qMin = pnp["Qmin"] ?? -0.436;
    const dbd1 = pnp["dbd1"] ?? -0.002;
    const dbd2 = pnp["dbd2"] ?? 0.002;
    const kpG = Math.max(0.0, pnp["Kpg"] ?? 1.0);
    const kiG = Math.max(0.0, pnp["Kig"] ?? 0.5);
    const tpP = Math.max(0.0, pnp["Tp"] ?? 0.25);
    const ddn = Math.max(0.0, pnp["Ddn"] ?? 20.0);
    const dup = Math.max(0.0, pnp["Dup"] ?? 0.0);
    const fdbd1 = pnp["fdbd1"] ?? -0.0006;
    const fdbd2 = pnp["fdbd2"] ?? 0.0006;
    const pMax = pnp["Pmax"] ?? 1.0;
    const pMin = pnp["Pmin"] ?? 0.0;
    const tLag = Math.max(0.0, pnp["Tlag"] ?? 0.1);

    const vPoiFltr = emitFirstOrderLag(
      ctx,
      `Vpoi_repc_${gId}`,
      vtExpr,
      addReal(dae, 1.0),
      addReal(dae, tFltr),
      tFltr,
      vt0,
    );
    const vErr = emitDeadband(ctx, sub(dae, addReal(dae, vt0), vPoiFltr), addReal(dae, dbd1), addReal(dae, dbd2));
    const qInt =
      kiQ > 1e-6
        ? emitNonWindupIntegrator(
            ctx,
            `Qint_repc_${gId}`,
            mul(dae, addReal(dae, kiQ), vErr),
            addReal(dae, 1.0),
            1.0,
            addReal(dae, qMin),
            addReal(dae, qMax),
            q0Pu,
          )
        : addReal(dae, q0Pu);
    const qPi = emitClamp(
      ctx,
      add(dae, qInt, mul(dae, addReal(dae, kpQ), vErr)),
      addReal(dae, qMin),
      addReal(dae, qMax),
    );
    qExtPu = emitLeadLag(ctx, `Qll_repc_${gId}`, qPi, addReal(dae, tft), addReal(dae, tfv), tfv, q0Pu);

    const dfDb = emitDeadband(
      ctx,
      sub(dae, busFreqPuExpr, addReal(dae, 1.0)),
      addReal(dae, fdbd1),
      addReal(dae, fdbd2),
    );
    const pDroop = sub(dae, addReal(dae, p0Pu), mul(dae, addReal(dae, 0.5 * (ddn + dup)), dfDb));
    const pMeasFltr = emitFirstOrderLag(
      ctx,
      `Pmeas_repc_${gId}`,
      mul(dae, vtExpr, addReal(dae, genInit.ip0)),
      addReal(dae, 1.0),
      addReal(dae, tpP),
      tpP,
      p0Pu,
    );
    const pErr = sub(dae, pDroop, pMeasFltr);
    const pInt =
      kiG > 1e-6
        ? emitNonWindupIntegrator(
            ctx,
            `Pint_repc_${gId}`,
            mul(dae, addReal(dae, kiG), pErr),
            addReal(dae, 1.0),
            1.0,
            addReal(dae, pMin),
            addReal(dae, pMax),
            p0Pu,
          )
        : addReal(dae, p0Pu);
    const pPi = emitClamp(
      ctx,
      add(dae, pInt, mul(dae, addReal(dae, kpG), pErr)),
      addReal(dae, pMin),
      addReal(dae, pMax),
    );
    pExtPu = emitFirstOrderLag(ctx, `Pext_repc_${gId}`, pPi, addReal(dae, 1.0), addReal(dae, tLag), tLag, p0Pu);
  }

  let ipCmdExpr = div(dae, pExtPu, emitMax(ctx, addReal(dae, 0.2), vtExpr));
  let iqCmdExpr = div(dae, qExtPu, emitMax(ctx, addReal(dae, 0.2), vtExpr));

  if (dyrReec) {
    const enp = dyrReec.namedParams;
    const trv = Math.max(0.0, enp["Trv"] ?? 0.01);
    const dbd1 = enp["dbd1"] ?? -0.05;
    const dbd2 = enp["dbd2"] ?? 0.05;
    const kqv = Math.max(0.0, enp["Kqv"] ?? 2.0);
    const iqh1 = enp["Iqh1"] ?? 1.05;
    const iql1 = enp["Iql1"] ?? -1.05;
    const qMax = enp["Qmax"] ?? 0.436;
    const qMin = enp["Qmin"] ?? -0.436;
    const kqp = Math.max(0.0, enp["Kqp"] ?? 0.0);
    const kqi = Math.max(0.0, enp["Kqi"] ?? 0.1);
    const tiq = Math.max(0.0, enp["Tiq"] ?? 0.02);
    const dPmax = Math.max(0.05, enp["dPmax"] ?? 99.0);
    const dPmin = Math.min(-0.05, enp["dPmin"] ?? -99.0);
    const pMax = enp["Pmax"] ?? 1.0;
    const pMin = enp["Pmin"] ?? 0.0;
    const iMax = Math.max(0.5, enp["Imax"] ?? 1.3);
    const tpOrd = Math.max(0.0, enp["Tpord"] ?? 0.02);
    const pqFlag = dyrReec.icons?.[4] === 1;

    const vFltr = emitFirstOrderLag(ctx, `Vfltr_reec_${gId}`, vtExpr, addReal(dae, 1.0), addReal(dae, trv), trv, vt0);
    const vErrDb = emitDeadband(ctx, sub(dae, addReal(dae, vt0), vFltr), addReal(dae, dbd1), addReal(dae, dbd2));
    const iqInj = emitClamp(ctx, mul(dae, addReal(dae, kqv), vErrDb), addReal(dae, iql1), addReal(dae, iqh1));

    // Inner Q regulator
    const qErr = sub(dae, qExtPu, addReal(dae, q0Pu));
    const qInt =
      kqi > 1e-6
        ? emitNonWindupIntegrator(
            ctx,
            `Qint_reec_${gId}`,
            mul(dae, addReal(dae, kqi), qErr),
            addReal(dae, 1.0),
            1.0,
            addReal(dae, qMin),
            addReal(dae, qMax),
            q0Pu,
          )
        : addReal(dae, q0Pu);
    const qReg = emitClamp(
      ctx,
      add(dae, qInt, mul(dae, addReal(dae, kqp), qErr)),
      addReal(dae, qMin),
      addReal(dae, qMax),
    );
    const iqBase = emitFirstOrderLag(
      ctx,
      `Iqbase_reec_${gId}`,
      div(dae, qReg, emitMax(ctx, addReal(dae, 0.2), vFltr)),
      addReal(dae, 1.0),
      addReal(dae, tiq),
      tiq,
      genInit.iq0Ibr,
    );
    const iqTotal = add(dae, iqBase, iqInj);

    // Active power order ramp & lag
    const pOrd = emitRateLimitedLag(
      ctx,
      `Pord_reec_${gId}`,
      pExtPu,
      addReal(dae, Math.max(0.01, tpOrd)),
      Math.max(0.01, tpOrd),
      addReal(dae, dPmin),
      addReal(dae, dPmax),
      addReal(dae, pMin),
      addReal(dae, pMax),
      p0Pu,
    );
    const ipRaw = div(dae, pOrd, emitMax(ctx, addReal(dae, 0.2), vFltr));

    // Current circle allocation with named intermediate algebraic vars (prevents AST blowup on smoothLimits)
    dae.addVariable(`Iqcmd_reec_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.iq0Ibr);
    dae.addVariable(`Ipcmd_reec_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.ip0);
    const iqCmdVarExpr = dae.addNameExpr(`Iqcmd_reec_${gId}`);
    const ipCmdVarExpr = dae.addNameExpr(`Ipcmd_reec_${gId}`);
    if (pqFlag) {
      dae.addEquation(EqKind.Simple, ipCmdVarExpr, emitClamp(ctx, ipRaw, addReal(dae, -iMax), addReal(dae, iMax)));
      const iqRem = dae.addCallExpr("sqrt", [
        emitMax(ctx, addReal(dae, 0.0), sub(dae, addReal(dae, iMax * iMax), mul(dae, ipCmdVarExpr, ipCmdVarExpr))),
      ]);
      dae.addEquation(EqKind.Simple, iqCmdVarExpr, emitClamp(ctx, iqTotal, mul(dae, addReal(dae, -1.0), iqRem), iqRem));
    } else {
      dae.addEquation(EqKind.Simple, iqCmdVarExpr, emitClamp(ctx, iqTotal, addReal(dae, -iMax), addReal(dae, iMax)));
      const ipRem = dae.addCallExpr("sqrt", [
        emitMax(ctx, addReal(dae, 0.0), sub(dae, addReal(dae, iMax * iMax), mul(dae, iqCmdVarExpr, iqCmdVarExpr))),
      ]);
      dae.addEquation(EqKind.Simple, ipCmdVarExpr, emitClamp(ctx, ipRaw, mul(dae, addReal(dae, -1.0), ipRem), ipRem));
    }
    ipCmdExpr = ipCmdVarExpr;
    iqCmdExpr = iqCmdVarExpr;
  }

  // === REGC_A / REGC_B / REGC_C / WT4G1 Converter Interface ===
  const tg = Math.max(0.005, gnp["Tg"] ?? gnp["Tp"] ?? 0.02);
  const tFltr = Math.max(0.005, gnp["Tfltr"] ?? gnp["Tiq"] ?? 0.02);
  const khv = Math.max(0.0, gnp["Khv"] ?? 0.7);
  const vOlim = gnp["Volim"] ?? 1.2;
  const lv1 = gnp["Lvpnt1"] ?? 0.8;
  const lv0 = gnp["Lvpnt0"] ?? 0.4;
  const brkpt = gnp["Brkpt"] ?? 0.9;
  const zerox = gnp["Zerox"] ?? 0.4;
  const lvpl1 = gnp["Lvpl1"] ?? 1.22;

  const vFltrC = emitFirstOrderLag(
    ctx,
    `Vfltr_regc_${gId}`,
    vtExpr,
    addReal(dae, 1.0),
    addReal(dae, tFltr),
    tFltr,
    vt0,
  );

  // LVPL active current upper bound
  const lvplSlope = lvpl1 / Math.max(0.05, brkpt - zerox);
  const ipLvplMax = ctx.smoothLimits
    ? addReal(dae, 2.0)
    : dae.addIfElseExpr(
        dae.addBinaryExpr(BinOp.Gte, vFltrC, addReal(dae, brkpt)),
        addReal(dae, 99.0),
        emitMax(ctx, addReal(dae, 0.0), mul(dae, addReal(dae, lvplSlope), sub(dae, vFltrC, addReal(dae, zerox)))),
      );
  const ipBounded = emitMin(ctx, ipCmdExpr, ipLvplMax);
  const ipExpr = emitFirstOrderLag(
    ctx,
    `Ip_regc_${gId}`,
    ipBounded,
    addReal(dae, 1.0),
    addReal(dae, tg),
    tg,
    genInit.ip0,
  );

  // HV reactive current clamp + low-voltage current scaling
  const hvClamp = mul(dae, addReal(dae, khv), emitMax(ctx, addReal(dae, 0.0), sub(dae, vFltrC, addReal(dae, vOlim))));
  const lvScale = emitClamp(
    ctx,
    div(dae, sub(dae, vFltrC, addReal(dae, lv0)), addReal(dae, Math.max(0.05, lv1 - lv0))),
    addReal(dae, 0.0),
    addReal(dae, 1.0),
  );
  const iqTarget = mul(dae, sub(dae, iqCmdExpr, hvClamp), lvScale);
  const iqExpr = emitFirstOrderLag(
    ctx,
    `Iq_regc_${gId}`,
    iqTarget,
    addReal(dae, 1.0),
    addReal(dae, tFltr),
    tFltr,
    genInit.iq0Ibr,
  );

  const irMach = add(dae, mul(dae, ipExpr, cosTheta), mul(dae, iqExpr, sinTheta));
  const iiMach = sub(dae, mul(dae, ipExpr, sinTheta), mul(dae, iqExpr, cosTheta));

  return {
    irSysExpr: mul(dae, addReal(dae, mbaseScale), irMach),
    iiSysExpr: mul(dae, addReal(dae, mbaseScale), iiMach),
    pOutMwExpr: mul(dae, addReal(dae, mbase), mul(dae, vtExpr, ipExpr)),
    qOutMvarExpr: mul(dae, addReal(dae, mbase), mul(dae, vtExpr, iqExpr)),
  };
}
