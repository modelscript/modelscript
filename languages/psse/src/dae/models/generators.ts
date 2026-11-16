// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { DaeArchetypeId } from "../../schema/index.js";
import type { PsseDyrRecord } from "../../types.js";
import {
  add,
  addReal,
  div,
  emitFirstOrderLag,
  emitSaturationCurve,
  mul,
  sub,
  type DaeBlockContext,
} from "../blocks.js";
import type { GeneratorSteadyInit } from "../init-steady-state.js";

export interface LoweredGeneratorPort {
  /** Machine-base rotor electrical angular speed `omega` (rad/s). */
  omegaExpr: number;
  /** Terminal voltage magnitude `Vt` (p.u.). */
  vtExpr: number;
  /** Electrical air-gap active power `Pe` (MW). */
  peExpr: number;
  /** Stator current `Id` (p.u. on mbase) & `Iq` (p.u. on mbase). */
  idExpr: number;
  iqExpr: number;
  /** Field current proxy `Ifd` (p.u.) for OEL/AC exciter demagnetization. */
  ifdExpr: number;
  /** System-base network current injections `Ir`, `Ii` (p.u. on sbase) into bus. */
  irSysExpr: number;
  iiSysExpr: number;
}

/**
 * Lowers a synchronous, induction, or wind Type-1/2/3 generator model attached to a bus
 * into exact linear-memory `DAEBuilder` differential-algebraic equations with Park
 * `d/q <-> (Vr, Vi)` network coupling.
 */
export function lowerGeneratorUnitToDae(
  ctx: DaeBlockContext,
  genInit: GeneratorSteadyInit,
  dyrGen: PsseDyrRecord | undefined,
  archetype: DaeArchetypeId,
  sbase: number,
  omega0: number,
  vrBusExpr: number,
  viBusExpr: number,
  pmExpr: number,
  efdExpr: number,
): LoweredGeneratorPort {
  const { dae } = ctx;
  const gId = genInit.genKey;
  const np = dyrGen?.namedParams ?? {};

  const H = Math.max(0.05, np["H"] ?? 3.5);
  const D = Math.max(0.0, np["D"] ?? 1.0);
  const ra = genInit.ra;
  const xd = genInit.xd;
  const xq = genInit.xq;
  const xdp = genInit.xdp;
  const xqp = genInit.xqp;
  const xdpp = genInit.xdpp;
  const xqpp = genInit.xqpp;
  const xl = genInit.xl;
  const mbaseScale = genInit.mbase / sbase;

  // Declare common machine terminal/stator/swing variables
  const deltaVar = dae.addVariable(
    `delta_${gId}`,
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    genInit.delta0,
  );
  const omegaVar = dae.addVariable(`omega_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, omega0);
  dae.addVariable(`Id_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.id0);
  dae.addVariable(`Iq_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.iq0);
  dae.addVariable(`Pe_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.pgMw);

  const deltaExpr = dae.addNameExpr(`delta_${gId}`);
  const omegaExpr = dae.addNameExpr(`omega_${gId}`);
  const idExpr = dae.addNameExpr(`Id_${gId}`);
  const iqExpr = dae.addNameExpr(`Iq_${gId}`);
  const peExpr = dae.addNameExpr(`Pe_${gId}`);

  const vtExpr = dae.addCallExpr("sqrt", [add(dae, mul(dae, vrBusExpr, vrBusExpr), mul(dae, viBusExpr, viBusExpr))]);
  const sinD = dae.addCallExpr("sin", [deltaExpr]);
  const cosD = dae.addCallExpr("cos", [deltaExpr]);

  // Park transform: Vd = Vr*sin(delta) - Vi*cos(delta), Vq = Vr*cos(delta) + Vi*sin(delta)
  const vdExpr = sub(dae, mul(dae, vrBusExpr, sinD), mul(dae, viBusExpr, cosD));
  const vqExpr = add(dae, mul(dae, vrBusExpr, cosD), mul(dae, viBusExpr, sinD));

  // Eq 1: der(delta) = omega - omega0
  const omegaDiff = sub(dae, omegaExpr, addReal(dae, omega0));
  dae.addEquation(EqKind.Simple, dae.addDerExpr(deltaVar), omegaDiff);

  // Eq 2: (2*H / omega0) * der(omega) = Tm_pu - Te_pu - D * (omega - omega0) / omega0
  const mInertia = addReal(dae, (2.0 * H) / omega0);
  const lhsSwing = mul(dae, mInertia, dae.addDerExpr(omegaVar));
  const tmPu = div(dae, pmExpr, addReal(dae, genInit.mbase));
  const dampTerm = mul(dae, addReal(dae, D / omega0), omegaDiff);

  let psippdExpr: number;
  let psippqExpr: number;
  let ifdExpr: number;

  if (archetype === "sync_classical_2o" || !dyrGen) {
    // Classical constant voltage E' behind X'd: Vq + Ra*Iq + X'd*Id = E'q0, Vd + Ra*Id - X'd*Iq = E'd0
    const eqConst = addReal(dae, genInit.eqp0);
    const edConst = addReal(dae, genInit.vd0 + ra * genInit.id0 - xdp * genInit.iq0);
    dae.addEquation(
      EqKind.Simple,
      add(dae, add(dae, vqExpr, mul(dae, addReal(dae, ra), iqExpr)), mul(dae, addReal(dae, xdp), idExpr)),
      eqConst,
    );
    dae.addEquation(
      EqKind.Simple,
      sub(dae, add(dae, vdExpr, mul(dae, addReal(dae, ra), idExpr)), mul(dae, addReal(dae, xdp), iqExpr)),
      edConst,
    );
    psippdExpr = eqConst;
    psippqExpr = edConst;
    ifdExpr = eqConst;
  } else if (archetype === "sync_transient_3o") {
    const td0p = Math.max(0.05, np["Td0p"] ?? 6.0);
    const eqpVar = dae.addVariable(`Eqp_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.eqp0);
    const eqpExpr = dae.addNameExpr(`Eqp_${gId}`);
    const eAgExpr = dae.addCallExpr("sqrt", [
      add(
        dae,
        mul(
          dae,
          add(dae, vqExpr, mul(dae, addReal(dae, xl), idExpr)),
          add(dae, vqExpr, mul(dae, addReal(dae, xl), idExpr)),
        ),
        mul(
          dae,
          sub(dae, vdExpr, mul(dae, addReal(dae, xl), iqExpr)),
          sub(dae, vdExpr, mul(dae, addReal(dae, xl), iqExpr)),
        ),
      ),
    ]);
    const satExpr = emitSaturationCurve(ctx, eAgExpr, 1.0, genInit.s10, 1.2, genInit.s12);
    const satTerm = mul(dae, satExpr, eqpExpr);
    ifdExpr = add(dae, add(dae, eqpExpr, mul(dae, addReal(dae, xd - xdp), idExpr)), satTerm);
    dae.addEquation(EqKind.Simple, mul(dae, addReal(dae, td0p), dae.addDerExpr(eqpVar)), sub(dae, efdExpr, ifdExpr));

    dae.addEquation(
      EqKind.Simple,
      add(dae, add(dae, vqExpr, mul(dae, addReal(dae, ra), iqExpr)), mul(dae, addReal(dae, xdp), idExpr)),
      eqpExpr,
    );
    dae.addEquation(
      EqKind.Simple,
      sub(dae, add(dae, vdExpr, mul(dae, addReal(dae, ra), idExpr)), mul(dae, addReal(dae, xq), iqExpr)),
      addReal(dae, 0.0),
    );
    psippdExpr = eqpExpr;
    psippqExpr = addReal(dae, 0.0);
  } else if (
    archetype === "induction_machine_4o" ||
    archetype === "wind_ind_gen_4o" ||
    archetype === "wind_type3_dfag"
  ) {
    const t0p = Math.max(0.05, np["T0p"] ?? 0.8);
    const xOpen = Math.max(0.5, np["X"] ?? 3.2);
    const xpBlk = Math.max(0.05, np["Xp"] ?? np["Xeq"] ?? 0.25);
    const eqpVar = dae.addVariable(`Eqp_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.eqp0);
    const edpVar = dae.addVariable(`Edp_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.edp0);
    const eqpExpr = dae.addNameExpr(`Eqp_${gId}`);
    const edpExpr = dae.addNameExpr(`Edp_${gId}`);
    const slipExpr = div(dae, sub(dae, addReal(dae, omega0), omegaExpr), addReal(dae, omega0));

    // Induction rotor voltage flux dynamics: T0'*der(Eq') = -Eq' - (X - X')*Id + T0'*omega0*s*Ed'
    dae.addEquation(
      EqKind.Simple,
      mul(dae, addReal(dae, t0p), dae.addDerExpr(eqpVar)),
      add(
        dae,
        sub(dae, mul(dae, addReal(dae, -1.0), eqpExpr), mul(dae, addReal(dae, xOpen - xpBlk), idExpr)),
        mul(dae, mul(dae, addReal(dae, t0p * omega0), slipExpr), edpExpr),
      ),
    );
    dae.addEquation(
      EqKind.Simple,
      mul(dae, addReal(dae, t0p), dae.addDerExpr(edpVar)),
      sub(
        dae,
        add(dae, mul(dae, addReal(dae, -1.0), edpExpr), mul(dae, addReal(dae, xOpen - xpBlk), iqExpr)),
        mul(dae, mul(dae, addReal(dae, t0p * omega0), slipExpr), eqpExpr),
      ),
    );
    dae.addEquation(
      EqKind.Simple,
      add(dae, add(dae, vqExpr, mul(dae, addReal(dae, ra), iqExpr)), mul(dae, addReal(dae, xpBlk), idExpr)),
      eqpExpr,
    );
    dae.addEquation(
      EqKind.Simple,
      sub(dae, add(dae, vdExpr, mul(dae, addReal(dae, ra), idExpr)), mul(dae, addReal(dae, xpBlk), iqExpr)),
      edpExpr,
    );
    psippdExpr = eqpExpr;
    psippqExpr = edpExpr;
    ifdExpr = eqpExpr;
  } else {
    // Full 5th-order (GENSAL/GENSAE) or 6th-order (GENROU/GENROE/GENTPJ) subtransient synchronous machine
    const isSalient = archetype === "sync_subtrans_salient_5o";
    const td0p = Math.max(0.05, np["Td0p"] ?? 6.5);
    const td0pp = Math.max(0.005, np["Td0pp"] ?? 0.035);
    const tq0p = Math.max(0.02, np["Tq0p"] ?? 1.0);
    const tq0pp = Math.max(0.005, np["Tq0pp"] ?? 0.05);
    const kis = archetype === "sync_gentpj_6o" ? Math.max(0.0, np["Kis"] ?? 0.05) : 0.0;

    const eqpVar = dae.addVariable(`Eqp_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.eqp0);
    const psikdVar = dae.addVariable(
      `psikd_${gId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      genInit.psikd0,
    );
    const psikqVar = dae.addVariable(
      `psikq_${gId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      genInit.psikq0,
    );

    const eqpExpr = dae.addNameExpr(`Eqp_${gId}`);
    const psikdExpr = dae.addNameExpr(`psikd_${gId}`);
    const psikqExpr = dae.addNameExpr(`psikq_${gId}`);

    let edpExpr: number;
    let edpVar = -1;
    if (isSalient) {
      edpExpr = addReal(dae, 0.0);
    } else {
      edpVar = dae.addVariable(`Edp_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, genInit.edp0);
      edpExpr = dae.addNameExpr(`Edp_${gId}`);
    }

    const denomD = Math.max(1e-4, xdp - xl);
    const kd1 = (xdpp - xl) / denomD;
    const kd2 = (xdp - xdpp) / denomD;
    psippdExpr = add(dae, mul(dae, addReal(dae, kd1), eqpExpr), mul(dae, addReal(dae, kd2), psikdExpr));

    const denomQ = Math.max(1e-4, xqp - xl);
    const kq1 = (xqpp - xl) / denomQ;
    const kq2 = (xqp - xqpp) / denomQ;
    psippqExpr = isSalient
      ? psikqExpr
      : add(dae, mul(dae, addReal(dae, kq1), edpExpr), mul(dae, addReal(dae, kq2), psikqExpr));

    // Air-gap flux magnitude for magnetic saturation (+ Kis*It for GENTPJ)
    const psiAgD = add(dae, vqExpr, add(dae, mul(dae, addReal(dae, ra), iqExpr), mul(dae, addReal(dae, xl), idExpr)));
    const psiAgQ = sub(dae, add(dae, vdExpr, mul(dae, addReal(dae, ra), idExpr)), mul(dae, addReal(dae, xl), iqExpr));
    let eSatArg = dae.addCallExpr("sqrt", [add(dae, mul(dae, psiAgD, psiAgD), mul(dae, psiAgQ, psiAgQ))]);
    if (kis > 0) {
      const iMag = dae.addCallExpr("sqrt", [add(dae, mul(dae, idExpr, idExpr), mul(dae, iqExpr, iqExpr))]);
      eSatArg = add(dae, eSatArg, mul(dae, addReal(dae, kis), iMag));
    }
    const satExpr = emitSaturationCurve(ctx, eSatArg, 1.0, genInit.s10, 1.2, genInit.s12);
    const satD = mul(dae, satExpr, eqpExpr);

    // d-axis transient flux ODE: Td0' * der(Eq') = Efd - Eq' - (Xd - X'd)*[Id - ((X'd - X''d)/(X'd - Xl)^2)*(psikd - Eq' + (X'd - Xl)*Id)] - S_d
    const kdDamperDiff = add(dae, sub(dae, psikdExpr, eqpExpr), mul(dae, addReal(dae, denomD), idExpr));
    const kdCoeff = (xdp - xdpp) / (denomD * denomD);
    const idEff = sub(dae, idExpr, mul(dae, addReal(dae, kdCoeff), kdDamperDiff));
    ifdExpr = add(dae, add(dae, eqpExpr, mul(dae, addReal(dae, xd - xdp), idEff)), satD);
    dae.addEquation(EqKind.Simple, mul(dae, addReal(dae, td0p), dae.addDerExpr(eqpVar)), sub(dae, efdExpr, ifdExpr));

    // d-axis subtransient damper ODE: Td0'' * der(psikd) = -psikd + Eq' - (X'd - Xl)*Id
    dae.addEquation(
      EqKind.Simple,
      mul(dae, addReal(dae, td0pp), dae.addDerExpr(psikdVar)),
      sub(dae, sub(dae, eqpExpr, psikdExpr), mul(dae, addReal(dae, denomD), idExpr)),
    );

    if (isSalient) {
      // 5th-order salient-pole q-axis damper: Tq0'' * der(psikq) = -psikq + (Xq - X''q)*Iq
      dae.addEquation(
        EqKind.Simple,
        mul(dae, addReal(dae, tq0pp), dae.addDerExpr(psikqVar)),
        sub(dae, mul(dae, addReal(dae, xq - xqpp), iqExpr), psikqExpr),
      );
    } else {
      const satQ = mul(dae, mul(dae, satExpr, addReal(dae, (xq - xl) / Math.max(0.1, xd - xl))), edpExpr);
      const kqDamperDiff = sub(dae, sub(dae, psikqExpr, edpExpr), mul(dae, addReal(dae, denomQ), iqExpr));
      const kqCoeff = (xqp - xqpp) / (denomQ * denomQ);
      const iqEff = sub(dae, iqExpr, mul(dae, addReal(dae, kqCoeff), kqDamperDiff));
      // Tq0' * der(Ed') = -Ed' + (Xq - X'q)*Iq_eff - S_q
      dae.addEquation(
        EqKind.Simple,
        mul(dae, addReal(dae, tq0p), dae.addDerExpr(edpVar)),
        sub(dae, sub(dae, mul(dae, addReal(dae, xq - xqp), iqEff), edpExpr), satQ),
      );
      // Tq0'' * der(psikq) = -psikq + Ed' + (X'q - Xl)*Iq
      dae.addEquation(
        EqKind.Simple,
        mul(dae, addReal(dae, tq0pp), dae.addDerExpr(psikqVar)),
        add(dae, sub(dae, edpExpr, psikqExpr), mul(dae, addReal(dae, denomQ), iqExpr)),
      );
    }

    // Stator algebraic equations: Vq + Ra*Iq + X''d*Id = psippd, Vd + Ra*Id - X''q*Iq = psippq
    dae.addEquation(
      EqKind.Simple,
      add(dae, add(dae, vqExpr, mul(dae, addReal(dae, ra), iqExpr)), mul(dae, addReal(dae, xdpp), idExpr)),
      psippdExpr,
    );
    dae.addEquation(
      EqKind.Simple,
      sub(dae, add(dae, vdExpr, mul(dae, addReal(dae, ra), idExpr)), mul(dae, addReal(dae, xqpp), iqExpr)),
      psippqExpr,
    );
  }

  // Electromagnetic torque Te_pu = psippd * Iq + psippq * Id + (X''q - X''d) * Id * Iq
  const tePu = add(
    dae,
    add(dae, mul(dae, psippdExpr, iqExpr), mul(dae, psippqExpr, idExpr)),
    mul(dae, addReal(dae, xqpp - xdpp), mul(dae, idExpr, iqExpr)),
  );

  // Swing equation completion
  dae.addEquation(EqKind.Simple, lhsSwing, sub(dae, sub(dae, tmPu, tePu), dampTerm));

  // Electrical active power output Pe (MW) = (Vd * Id + Vq * Iq) * mbase
  const pTerminalPu = add(dae, mul(dae, vdExpr, idExpr), mul(dae, vqExpr, iqExpr));
  dae.addEquation(EqKind.Simple, peExpr, mul(dae, addReal(dae, genInit.mbase), pTerminalPu));

  // Inverse Park transform to system-base network current injections (Ir, Ii)
  const irMach = add(dae, mul(dae, idExpr, sinD), mul(dae, iqExpr, cosD));
  const iiMach = sub(dae, mul(dae, iqExpr, sinD), mul(dae, idExpr, cosD));
  const irSysExpr = mul(dae, addReal(dae, mbaseScale), irMach);
  const iiSysExpr = mul(dae, addReal(dae, mbaseScale), iiMach);

  // Unused helper suppression if needed
  void emitFirstOrderLag;
  void BinOp;

  return {
    omegaExpr,
    vtExpr,
    peExpr,
    idExpr,
    iqExpr,
    ifdExpr,
    irSysExpr,
    iiSysExpr,
  };
}
