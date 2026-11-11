// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Direct Linear-Memory DAE Arena Lowering for PSS/E Transmission Grids.
 *
 * Compiles multi-machine transient stability and AC power flow equations directly into
 * ModelScript's zero-GC WebAssembly DAEBuilder struct-of-arrays arena:
 *   1. Bus voltage variables: rectangular coordinates (V_{bus}_r, V_{bus}_i) and power injections
 *   2. Synchronous machine rotor angle delta_{gen} and speed omega_{gen} states:
 *        der(delta) = omega - omega_0
 *        (2H / omega_0) * der(omega) = Pm - Pe - D * (omega - omega_0)
 *   3. Algebraic AC nodal active and reactive power balance equations:
 *        P_inj = P_gen - P_load
 *        Q_inj = Q_gen - Q_load
 *        V_r^2 + V_i^2 = V_mag^2
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { getPsseModelPortSpecs, PSSE_MODEL_DEFAULTS } from "../builtins.js";
import { extractPowerFlowNetlist } from "../netlist/powerflow-netlist.js";
import { DYR_MODEL_SCHEMAS } from "../parser/dyr-parser.js";
import type { PsseCase } from "../types.js";

export interface PsseDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  baseFrequency?: number | undefined; // Hz (default: 60.0)
}

export function lowerPsseToDae(psseCase: PsseCase, options?: PsseDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (psseCase.title1 || "TransmissionGrid")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const freq = options?.baseFrequency ?? psseCase.header.basfrq ?? 60.0;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const omega0 = 2 * Math.PI * freq;
  const netlist = extractPowerFlowNetlist(psseCase);

  // 1. Declare bus voltage & injection algebraic variables (4 per bus)
  for (const [busNum, bus] of psseCase.buses) {
    const vMag = bus.vm || 1.0;
    const vAng = ((bus.va || 0.0) * Math.PI) / 180.0;
    const vr = vMag * Math.cos(vAng);
    const vi = vMag * Math.sin(vAng);

    dae.addVariable(`V_${busNum}_r`, VarType.Real, Variability.Continuous, Causality.Local, vr);
    dae.addVariable(`V_${busNum}_i`, VarType.Real, Variability.Continuous, Causality.Local, vi);
    dae.addVariable(`P_${busNum}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_${busNum}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 2. Declare synchronous machine rotor dynamics, .dyr GENROU/EXST1/TGOV1 states & air-gap power coupling
  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue; // offline generator
    const genId = `${gen.i}_${gen.id.trim()}`;
    const dyrGen =
      psseCase.dyr?.generatorsByBusId.get(genId) ??
      psseCase.dyr?.generatorsByBusId.get(String(gen.i)) ??
      psseCase.dyr?.records?.find((m) => m.ibus === gen.i && m.category === "generator");
    const dyrExc =
      psseCase.dyr?.excitersByBusId.get(genId) ??
      psseCase.dyr?.excitersByBusId.get(String(gen.i)) ??
      psseCase.dyr?.records?.find((m) => m.ibus === gen.i && m.category === "exciter");
    const dyrGov =
      psseCase.dyr?.governorsByBusId.get(genId) ??
      psseCase.dyr?.governorsByBusId.get(String(gen.i)) ??
      psseCase.dyr?.records?.find((m) => m.ibus === gen.i && m.category === "governor");

    const H = dyrGen?.namedParams["H"] !== undefined && dyrGen.namedParams["H"] > 0 ? dyrGen.namedParams["H"] : 3.5;
    const D = dyrGen?.namedParams["D"] !== undefined && dyrGen.namedParams["D"] >= 0 ? dyrGen.namedParams["D"] : 1.0;
    const bus = psseCase.buses.get(gen.i);
    const theta0 = ((bus?.va ?? 0.0) * Math.PI) / 180.0;
    const dyrXdp = dyrGen?.namedParams["Xdp"];
    const xd = dyrXdp !== undefined && dyrXdp > 0 ? dyrXdp : gen.zx > 0 ? gen.zx : 0.25;
    const delta0 = theta0 + (gen.pg / sbase) * xd;

    // delta (rotor angle in rad)
    const deltaVar = dae.addVariable(`delta_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, delta0);
    // omega (electrical rotor angular velocity in rad/s)
    const omegaVar = dae.addVariable(`omega_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, omega0);
    // Pe (electrical active power output in MW)
    dae.addVariable(`Pe_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, gen.pg);

    // Eq 1: der(delta) = omega - omega0
    const derDelta = dae.addDer(deltaVar);
    const omegaExpr = dae.addNameExpr(`omega_${genId}`);
    const omegaDiff = dae.addBinaryExpr(BinOp.Sub, omegaExpr, dae.addRealLiteral(omega0));
    dae.addEquation(EqKind.Simple, derDelta, omegaDiff);

    // Optional TGOV1 / IEEEG1 / GGOV1 / GAST / WPID / PIDGOV / CCGOV1 / DEGOV1 / REPC_A / REPC_B governor state: Pm_${genId}
    let pmExpr = dae.addRealLiteral(gen.pg);
    if (dyrGov) {
      const pmVar = dae.addVariable(`Pm_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, gen.pg);
      const rDroop = Math.max(
        0.005,
        dyrGov.namedParams["R"] ??
          dyrGov.namedParams["Rperm"] ??
          (dyrGov.namedParams["K"] ? 1.0 / Math.max(1.0, dyrGov.namedParams["K"]) : undefined) ??
          dyrGov.con[0] ??
          0.05,
      );
      const t1Gov = Math.max(
        0.01,
        dyrGov.namedParams["T1"] ??
          dyrGov.namedParams["Tg"] ??
          dyrGov.namedParams["Tact"] ??
          dyrGov.namedParams["Ta"] ??
          dyrGov.namedParams["Tw"] ??
          dyrGov.con[1] ??
          0.5,
      );
      const derPm = dae.addDer(pmVar);
      const lhsGov = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(t1Gov), derPm);
      const droopGain = sbase / (rDroop * omega0);
      const droopTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(droopGain), omegaDiff);
      const pRefMinusDroop = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(gen.pg), droopTerm);
      const pmNameExpr = dae.addNameExpr(`Pm_${genId}`);
      const rhsGov = dae.addBinaryExpr(BinOp.Sub, pRefMinusDroop, pmNameExpr);
      dae.addEquation(EqKind.Simple, lhsGov, rhsGov);
      pmExpr = pmNameExpr;
    }

    // Optional EXST1 / ESDC1A / ESAC1A / ESAC4A / ESST1A / ESST4B / EXAC1 / EXAC2 / SCRX / REEC_A / REEC_B / REEC_C exciter state: Efd_${genId}
    let efdExpr = dae.addRealLiteral(1.05);
    const vrBusExpr = bus ? dae.addNameExpr(`V_${gen.i}_r`) : dae.addRealLiteral(1.0);
    const viBusExpr = bus ? dae.addNameExpr(`V_${gen.i}_i`) : dae.addRealLiteral(0.0);
    const vtBusExpr = bus
      ? dae.addCallExpr("sqrt", [
          dae.addBinaryExpr(
            BinOp.Add,
            dae.addBinaryExpr(BinOp.Mul, vrBusExpr, vrBusExpr),
            dae.addBinaryExpr(BinOp.Mul, viBusExpr, viBusExpr),
          ),
        ])
      : dae.addRealLiteral(1.0);
    if (dyrExc) {
      const efd0 = 1.05;
      const efdVar = dae.addVariable(`Efd_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, efd0);
      const kaExc = Math.max(
        1.0,
        dyrExc.namedParams["KA"] ??
          dyrExc.namedParams["KPR"] ??
          dyrExc.namedParams["Kqv"] ??
          dyrExc.namedParams["K"] ??
          dyrExc.con[2] ??
          200.0,
      );
      const taExc = Math.max(
        0.005,
        dyrExc.namedParams["TA"] ??
          dyrExc.namedParams["Tiq"] ??
          dyrExc.namedParams["TE"] ??
          dyrExc.namedParams["Trv"] ??
          dyrExc.con[3] ??
          0.02,
      );
      const vRef = (bus?.vm ?? 1.0) + efd0 / kaExc;
      const derEfd = dae.addDer(efdVar);
      const lhsExc = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(taExc), derEfd);
      const vErr = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(vRef), vtBusExpr);
      const kaVerr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kaExc), vErr);
      const efdNameExpr = dae.addNameExpr(`Efd_${genId}`);
      const rhsExc = dae.addBinaryExpr(BinOp.Sub, kaVerr, efdNameExpr);
      dae.addEquation(EqKind.Simple, lhsExc, rhsExc);
      efdExpr = efdNameExpr;
    }

    // Optional GENROU / GENSAL / GENTPJ / GENSAE transient flux linkage states: Eqp_${genId} (E'_q) and Edp_${genId} (E'_d),
    // or REGC_A / REGC_B / REGC_C inverter current regulator state Ip_${genId}
    let eqpExpr: number | null = null;
    if (
      dyrGen &&
      (dyrGen.model === "GENROU" || dyrGen.model === "GENSAL" || dyrGen.model === "GENTPJ" || dyrGen.model === "GENSAE")
    ) {
      const eqp0 = 1.05;
      const edp0 = 0.0;
      const eqpVar = dae.addVariable(`Eqp_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, eqp0);
      const edpVar = dae.addVariable(`Edp_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, edp0);

      const td0p = Math.max(0.05, dyrGen.namedParams["Td0p"] ?? dyrGen.con[0] ?? 6.5);
      const tq0p = Math.max(0.05, dyrGen.namedParams["Tq0p"] ?? dyrGen.con[2] ?? 1.0);
      const xdSync = Math.max(xd, dyrGen.namedParams["Xd"] ?? dyrGen.con[5] ?? 1.8);
      const xqSync = Math.max(xd, dyrGen.namedParams["Xq"] ?? dyrGen.con[6] ?? 1.7);
      const xqp = Math.max(0.05, dyrGen.namedParams["Xqp"] ?? dyrGen.con[8] ?? 0.55);

      // Td0' * der(Eqp) = Efd - Eqp - ((Xd - Xd') / Xd') * (Eqp - Vt)
      const derEqp = dae.addDer(eqpVar);
      const lhsEqp = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(td0p), derEqp);
      const eqpNameExpr = dae.addNameExpr(`Eqp_${genId}`);
      const idDrop = dae.addBinaryExpr(
        BinOp.Mul,
        dae.addRealLiteral((xdSync - xd) / xd),
        dae.addBinaryExpr(BinOp.Sub, eqpNameExpr, vtBusExpr),
      );
      const rhsEqp = dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Sub, efdExpr, eqpNameExpr), idDrop);
      dae.addEquation(EqKind.Simple, lhsEqp, rhsEqp);

      // Tq0' * der(Edp) = -Edp + ((Xq - Xq') / Xq') * (delta - delta0)
      const derEdp = dae.addDer(edpVar);
      const lhsEdp = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(tq0p), derEdp);
      const edpNameExpr = dae.addNameExpr(`Edp_${genId}`);
      const deltaDevForEdp = dae.addBinaryExpr(
        BinOp.Sub,
        dae.addNameExpr(`delta_${genId}`),
        dae.addRealLiteral(delta0),
      );
      const iqTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral((xqSync - xqp) / xqp), deltaDevForEdp);
      const rhsEdp = dae.addBinaryExpr(BinOp.Sub, iqTerm, edpNameExpr);
      dae.addEquation(EqKind.Simple, lhsEdp, rhsEdp);

      eqpExpr = eqpNameExpr;
    } else if (dyrGen && (dyrGen.model === "REGC_A" || dyrGen.model === "REGC_B" || dyrGen.model === "REGC_C")) {
      // WECC REGC_A/B/C converter current regulator lag state: Tg * der(Ip) = (Pm / Sbase) - Ip
      const tgConv = Math.max(0.005, dyrGen.namedParams["Tg"] ?? dyrGen.con[0] ?? 0.02);
      const ip0 = gen.pg / sbase;
      const ipVar = dae.addVariable(`Ip_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, ip0);
      const derIp = dae.addDer(ipVar);
      const lhsIp = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(tgConv), derIp);
      const ipCmd = dae.addBinaryExpr(BinOp.Div, pmExpr, dae.addRealLiteral(sbase));
      const ipNameExpr = dae.addNameExpr(`Ip_${genId}`);
      const rhsIp = dae.addBinaryExpr(BinOp.Sub, ipCmd, ipNameExpr);
      dae.addEquation(EqKind.Simple, lhsIp, rhsIp);
    }

    // Eq 2: (2H / omega0) * der(omega) = Pm - Pe - D * (omega - omega0)
    const derOmega = dae.addDer(omegaVar);
    const mInertia = (2 * H) / omega0;
    const lhsSwing = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(mInertia), derOmega);

    const peExpr = dae.addNameExpr(`Pe_${genId}`);
    const pAccel = dae.addBinaryExpr(BinOp.Sub, pmExpr, peExpr);
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(D), omegaDiff);
    const rhsSwing = dae.addBinaryExpr(BinOp.Sub, pAccel, dampTerm);
    dae.addEquation(EqKind.Simple, lhsSwing, rhsSwing);

    // Eq 3: Air-gap electrical power coupled to rotor angle, internal flux Eqp (if GENROU), & terminal bus voltage magnitude Vt
    // Pe = Pg0 + (Sbase / xd) * Eqp * sin(delta - delta0) * Vt
    const deltaExpr = dae.addNameExpr(`delta_${genId}`);
    const deltaDev = dae.addBinaryExpr(BinOp.Sub, deltaExpr, dae.addRealLiteral(delta0));
    const sinDeltaDev = dae.addCallExpr("sin", [deltaDev]);
    const kSync = dae.addRealLiteral(sbase / xd);
    const baseSyncTerm = dae.addBinaryExpr(BinOp.Mul, dae.addBinaryExpr(BinOp.Mul, kSync, sinDeltaDev), vtBusExpr);
    const syncPower = eqpExpr !== null ? dae.addBinaryExpr(BinOp.Mul, eqpExpr, baseSyncTerm) : baseSyncTerm;
    const peRhs = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(gen.pg), syncPower);
    dae.addEquation(EqKind.Simple, peExpr, peRhs);
  }

  // 2b. Optional Dynamic Composite Load (CMPLDW / CLOD / CIM5) & FACTS/SVC (SVSMO1 / SVSMO3) states
  if (psseCase.dyr?.loadsByBusId) {
    for (const [loadKey, dyrLoad] of psseCase.dyr.loadsByBusId) {
      if (loadKey.includes("_")) continue; // Emit once per bus
      const busNum = dyrLoad.ibus;
      if (!psseCase.buses.has(busNum)) continue;
      // Induction motor aggregate slip state: 2 * H_m * der(s_motor) = T_mech - V_bus^2 * (s_motor / s0)
      const s0 = 0.02;
      const hMotor = Math.max(0.1, dyrLoad.namedParams["H"] ?? 0.6);
      const slipVar = dae.addVariable(`s_motor_${busNum}`, VarType.Real, Variability.Continuous, Causality.Local, s0);
      const derSlip = dae.addDer(slipVar);
      const lhsSlip = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0 * hMotor), derSlip);
      const vrExpr = dae.addNameExpr(`V_${busNum}_r`);
      const viExpr = dae.addNameExpr(`V_${busNum}_i`);
      const vSqExpr = dae.addBinaryExpr(
        BinOp.Add,
        dae.addBinaryExpr(BinOp.Mul, vrExpr, vrExpr),
        dae.addBinaryExpr(BinOp.Mul, viExpr, viExpr),
      );
      const tElecExpr = dae.addBinaryExpr(
        BinOp.Mul,
        vSqExpr,
        dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(`s_motor_${busNum}`), dae.addRealLiteral(s0)),
      );
      const rhsSlip = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(1.0), tElecExpr);
      dae.addEquation(EqKind.Simple, lhsSlip, rhsSlip);
    }
  }

  // 3. Emit coupled AC nodal power/current balance equations for each bus (4 eqs per bus)
  for (let i = 0; i < netlist.nBuses; i++) {
    const busNum = netlist.busNumbers[i]!;
    const bus = psseCase.buses.get(busNum)!;
    const vrExpr = dae.addNameExpr(`V_${busNum}_r`);
    const viExpr = dae.addNameExpr(`V_${busNum}_i`);

    // Sum of generation at this bus (coupled to Pe_${genId} variables)
    const busGens = psseCase.generators.filter((g) => g.i === busNum && g.stat !== 0);
    const totalQg = busGens.reduce((sum, g) => sum + g.qg, 0.0);

    // Sum of load at this bus
    const busLoads = psseCase.loads.filter((l) => l.i === busNum && l.status !== 0);
    const totalPl = busLoads.reduce((sum, l) => sum + l.pl, 0.0);
    const totalQl = busLoads.reduce((sum, l) => sum + l.ql, 0.0);

    let pGenSumExpr = dae.addRealLiteral(0.0);
    for (const g of busGens) {
      const genId = `${g.i}_${g.id.trim()}`;
      pGenSumExpr = dae.addBinaryExpr(BinOp.Add, pGenSumExpr, dae.addNameExpr(`Pe_${genId}`));
    }
    const pNetExpr = dae.addBinaryExpr(BinOp.Sub, pGenSumExpr, dae.addRealLiteral(totalPl));
    const qNet = totalQg - totalQl;

    // Bus Eq 1: P_inj = sum(Pe_gen) - P_load
    const pInj = dae.addNameExpr(`P_${busNum}_inj`);
    dae.addEquation(EqKind.Simple, pInj, pNetExpr);

    // Bus Eq 2: Q_inj = Q_gen - Q_load
    const qInj = dae.addNameExpr(`Q_${busNum}_inj`);
    dae.addEquation(EqKind.Simple, qInj, dae.addRealLiteral(qNet));

    // Construct nodal current injection expressions from Ybus:
    // I_r = sum_k (G_ik * V_k_r - B_ik * V_k_i)
    // I_i = sum_k (B_ik * V_k_r + G_ik * V_k_i)
    const rowG = netlist.ybus.g.get(i);
    const rowB = netlist.ybus.b.get(i);
    const neighbors = Array.from(new Set([...(rowG?.keys() ?? []), ...(rowB?.keys() ?? [])])).sort((a, b) => a - b);

    let irSumExpr: number | null = null;
    let iiSumExpr: number | null = null;

    for (const k of neighbors) {
      const g = rowG?.get(k) ?? 0.0;
      const b = rowB?.get(k) ?? 0.0;
      if (Math.abs(g) < 1e-12 && Math.abs(b) < 1e-12) continue;
      const kBusNum = netlist.busNumbers[k]!;
      const vkr = dae.addNameExpr(`V_${kBusNum}_r`);
      const vki = dae.addNameExpr(`V_${kBusNum}_i`);

      // g * V_k_r - b * V_k_i
      const termIr = dae.addBinaryExpr(
        BinOp.Sub,
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(g), vkr),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(b), vki),
      );
      irSumExpr = irSumExpr === null ? termIr : dae.addBinaryExpr(BinOp.Add, irSumExpr, termIr);

      // b * V_k_r + g * V_k_i
      const termIi = dae.addBinaryExpr(
        BinOp.Add,
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(b), vkr),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(g), vki),
      );
      iiSumExpr = iiSumExpr === null ? termIi : dae.addBinaryExpr(BinOp.Add, iiSumExpr, termIi);
    }

    if (irSumExpr === null) irSumExpr = vrExpr;
    if (iiSumExpr === null) iiSumExpr = viExpr;

    // Bus Eq 3: Nonlinear rectangular AC active power balance: V_r * I_r + V_i * I_i = P_inj / Sbase
    const pCalcPu = dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(BinOp.Mul, vrExpr, irSumExpr),
      dae.addBinaryExpr(BinOp.Mul, viExpr, iiSumExpr),
    );
    const pInjPu = dae.addBinaryExpr(BinOp.Div, pInj, dae.addRealLiteral(sbase));
    dae.addEquation(EqKind.Simple, pCalcPu, pInjPu);

    // Bus Eq 4: PV/Slack voltage magnitude regulation or nonlinear rectangular AC reactive power balance: V_i * I_r - V_r * I_i = Q_inj / Sbase
    if (bus.ide === 2 || bus.ide === 3) {
      const vSet = bus.vm > 0 ? bus.vm : 1.0;
      const vr2 = dae.addBinaryExpr(BinOp.Mul, vrExpr, vrExpr);
      const vi2 = dae.addBinaryExpr(BinOp.Mul, viExpr, viExpr);
      const vMag2 = dae.addBinaryExpr(BinOp.Add, vr2, vi2);
      dae.addEquation(EqKind.Simple, vMag2, dae.addRealLiteral(vSet * vSet));
    } else {
      const qCalcPu = dae.addBinaryExpr(
        BinOp.Sub,
        dae.addBinaryExpr(BinOp.Mul, viExpr, irSumExpr),
        dae.addBinaryExpr(BinOp.Mul, vrExpr, iiSumExpr),
      );
      const qInjPu = dae.addBinaryExpr(BinOp.Div, qInj, dae.addRealLiteral(sbase));
      dae.addEquation(EqKind.Simple, qCalcPu, qInjPu);
    }
  }

  return dae;
}

export interface PsseComponentParamOverride {
  value?: number | undefined;
  exprId?: number | undefined;
}

export interface PsseDeferredInputDefault {
  varName: string;
  rhsExprId: number;
}

export interface PsseComponentLowerOptions {
  paramOverrides?: Record<string, PsseComponentParamOverride> | undefined;
  connectedInputPorts?: ReadonlySet<string> | undefined;
  deferInputDefaults?: boolean | undefined;
}

/**
 * Lowers a single PSS/E standard dynamic model instance (e.g. `PSSEDynamics.GENROU`, `EXST1`,
 * `TGOV1`, `IEEEST`, `REGC_A`) directly into linear-memory `DAEBuilder` variables and equations.
 *
 * Maintains exact equation-unknown structural balance both when standalone (unconnected input ports
 * bind to steady-state operating setpoints) and when wired via `connect(...)` in Modelica / SysML v2.
 */
export function lowerPsseComponentToDae(
  dae: DAEBuilder,
  modelName: string,
  instancePrefix: string,
  options?: PsseComponentLowerOptions,
): PsseDeferredInputDefault[] {
  const upperModel = modelName.toUpperCase();
  const canonicalKey = upperModel === "REGCA1" ? "REGC_A" : upperModel;
  const schema = DYR_MODEL_SCHEMAS[canonicalKey] ?? DYR_MODEL_SCHEMAS["GENROU"]!;
  const defaults = {
    ...(PSSE_MODEL_DEFAULTS[canonicalKey] ?? PSSE_MODEL_DEFAULTS["GENROU"]!),
  };
  const overrides = options?.paramOverrides ?? {};
  const connected = options?.connectedInputPorts ?? new Set<string>();
  const deferredDefaults: PsseDeferredInputDefault[] = [];

  const p = (localName: string): string => (instancePrefix ? `${instancePrefix}.${localName}` : localName);

  // 1. Emit declared DYR + operating-point parameters as Variability.Parameter
  const numericParams: Record<string, number> = { ...defaults };
  const allParamNames = new Set<string>(schema.params.map((sp) => sp.name));
  for (const k of Object.keys(defaults)) {
    allParamNames.add(k);
  }

  for (const paramName of allParamNames) {
    const ov = overrides[paramName];
    const startVal = ov?.value !== undefined && Number.isFinite(ov.value) ? ov.value : (defaults[paramName] ?? 0.0);
    numericParams[paramName] = startVal;
    const varIdx = dae.addVariable(p(paramName), VarType.Real, Variability.Parameter, Causality.Local, startVal);
    const bindExpr = ov?.exprId !== undefined ? ov.exprId : dae.addRealLiteral(startVal);
    dae.setVarExpression(varIdx, bindExpr);
  }

  const ensureParamExpr = (paramName: string, fallbackVal: number): number => {
    if (allParamNames.has(paramName)) {
      return dae.addNameExpr(p(paramName));
    }
    return dae.addRealLiteral(fallbackVal);
  };

  // 2. Emit connectable signal ports (Causality.Local as sub-component continuous variables)
  const portSpecs = getPsseModelPortSpecs(upperModel, schema.category);
  const portStartVal = (portName: string): number => {
    switch (portName) {
      case "Pm_in":
      case "Pm_out":
      case "Pe_out":
      case "Pcmd_in":
      case "Ip_out":
        return numericParams["P0"] ?? 0.8;
      case "Qcmd_in":
      case "Iq_out":
        return numericParams["Q0"] ?? 0.0;
      case "Efd_in":
      case "Efd_out":
        return numericParams["Efd0"] ?? 1.05;
      case "Vt_in":
        return numericParams["V0"] ?? 1.0;
      case "omega_in":
      case "omega_out":
        return numericParams["omega0"] ?? 376.99111843077515;
      default:
        return 0.0;
    }
  };

  for (const port of portSpecs) {
    dae.addVariable(p(port.name), VarType.Real, Variability.Continuous, Causality.Local, portStartVal(port.name));
  }

  const bindUnconnectedInput = (portName: string, defaultRhsExpr: number): void => {
    if (connected.has(portName)) return;
    if (options?.deferInputDefaults) {
      deferredDefaults.push({ varName: p(portName), rhsExprId: defaultRhsExpr });
      return;
    }
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p(portName)), defaultRhsExpr);
  };

  // 3. Emit category-specific linear-memory differential & algebraic equations
  if (upperModel.startsWith("REGC")) {
    // WECC Renewable Converter Interface (REGC_A / REGCA1 / REGC_B)
    const p0Val = numericParams["P0"] ?? 0.8;
    const q0Val = numericParams["Q0"] ?? 0.0;
    const v0Val = Math.max(0.1, numericParams["V0"] ?? 1.0);

    bindUnconnectedInput("Pcmd_in", ensureParamExpr("P0", p0Val));
    bindUnconnectedInput("Qcmd_in", ensureParamExpr("Q0", q0Val));
    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));

    dae.addVariable(p("Ip"), VarType.Real, Variability.Continuous, Causality.Local, p0Val / v0Val);
    dae.addVariable(p("Iq"), VarType.Real, Variability.Continuous, Causality.Local, q0Val / v0Val);

    const tgExpr = ensureParamExpr("Tg", 0.02);
    const tfltrExpr = ensureParamExpr("Tfltr", 0.02);
    const v0Expr = ensureParamExpr("V0", v0Val);
    const khvExpr = ensureParamExpr("Khv", 0.7);

    // Tg * der(Ip) = (Pcmd_in / V0) - Ip
    const lhsIp = dae.addBinaryExpr(BinOp.Mul, tgExpr, dae.addDerExpr(dae.addNameExpr(p("Ip"))));
    const ipCmd = dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(p("Pcmd_in")), v0Expr);
    dae.addEquation(EqKind.Simple, lhsIp, dae.addBinaryExpr(BinOp.Sub, ipCmd, dae.addNameExpr(p("Ip"))));

    // Tfltr * der(Iq) = (Qcmd_in / V0) + Khv * (V0 - Vt_in) - Iq
    const lhsIq = dae.addBinaryExpr(BinOp.Mul, tfltrExpr, dae.addDerExpr(dae.addNameExpr(p("Iq"))));
    const iqCmd = dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(p("Qcmd_in")), v0Expr);
    const lvrtBoost = dae.addBinaryExpr(
      BinOp.Mul,
      khvExpr,
      dae.addBinaryExpr(BinOp.Sub, v0Expr, dae.addNameExpr(p("Vt_in"))),
    );
    dae.addEquation(
      EqKind.Simple,
      lhsIq,
      dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Add, iqCmd, lvrtBoost), dae.addNameExpr(p("Iq"))),
    );

    // Ip_out = Ip ; Iq_out = Iq
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Ip_out")), dae.addNameExpr(p("Ip")));
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Iq_out")), dae.addNameExpr(p("Iq")));
    return deferredDefaults;
  }

  if (schema.category === "generator") {
    const omega0Val = Math.max(1.0, numericParams["omega0"] ?? 376.99111843077515);
    const p0Val = numericParams["P0"] ?? 0.8;
    const v0Val = Math.max(0.1, numericParams["V0"] ?? 1.0);
    const efd0Val = Math.max(0.1, numericParams["Efd0"] ?? 1.05);
    const xdpVal = Math.max(0.05, numericParams["Xdp"] ?? 0.25);
    const delta0Val = (p0Val * xdpVal) / (efd0Val * v0Val);

    bindUnconnectedInput("Pm_in", ensureParamExpr("P0", p0Val));
    bindUnconnectedInput("Efd_in", ensureParamExpr("Efd0", efd0Val));
    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));

    dae.addVariable(p("delta"), VarType.Real, Variability.Continuous, Causality.Local, delta0Val);
    dae.addVariable(p("omega"), VarType.Real, Variability.Continuous, Causality.Local, omega0Val);

    const omega0Expr = ensureParamExpr("omega0", omega0Val);
    const hExpr = ensureParamExpr("H", Math.max(0.1, numericParams["H"] || 3.5));
    const dExpr = ensureParamExpr("D", numericParams["D"] ?? 1.0);
    const xdpExpr = ensureParamExpr("Xdp", xdpVal);
    const p0Expr = ensureParamExpr("P0", p0Val);
    const v0Expr = ensureParamExpr("V0", v0Val);

    // Eq 1: der(delta) = omega - omega0
    const omegaDiff = dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(p("omega")), omega0Expr);
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(p("delta"))), omegaDiff);

    // Eq 2: (2 * H / omega0) * der(omega) = Pm_in - Pe_out - D * ((omega - omega0) / omega0)
    const twoH = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), hExpr);
    const mInertia = dae.addBinaryExpr(BinOp.Div, twoH, omega0Expr);
    const lhsSwing = dae.addBinaryExpr(BinOp.Mul, mInertia, dae.addDerExpr(dae.addNameExpr(p("omega"))));
    const pAccel = dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(p("Pm_in")), dae.addNameExpr(p("Pe_out")));
    const puSpeedDev = dae.addBinaryExpr(BinOp.Div, omegaDiff, omega0Expr);
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dExpr, puSpeedDev);
    dae.addEquation(EqKind.Simple, lhsSwing, dae.addBinaryExpr(BinOp.Sub, pAccel, dampTerm));

    const deltaDev = dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(p("delta")), dae.addRealLiteral(delta0Val));
    const sinDeltaDev = dae.addCallExpr("sin", [deltaDev]);

    if (upperModel === "GENCLS") {
      // Pe_out = P0 + (Efd_in * Vt_in / Xdp) * sin(delta - delta0)
      const evProd = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(p("Efd_in")), dae.addNameExpr(p("Vt_in")));
      const kSync = dae.addBinaryExpr(BinOp.Div, evProd, xdpExpr);
      const peRhs = dae.addBinaryExpr(BinOp.Add, p0Expr, dae.addBinaryExpr(BinOp.Mul, kSync, sinDeltaDev));
      dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Pe_out")), peRhs);
    } else {
      // Subtransient / transient synchronous machine (GENROU / GENSAL / GENTPJ / GENSAE)
      dae.addVariable(p("Eqp"), VarType.Real, Variability.Continuous, Causality.Local, efd0Val);
      dae.addVariable(p("Edp"), VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      const td0pExpr = ensureParamExpr("Td0p", Math.max(0.05, numericParams["Td0p"] || 6.5));
      const tq0pExpr = allParamNames.has("Tq0p")
        ? dae.addNameExpr(p("Tq0p"))
        : ensureParamExpr("Tq0pp", Math.max(0.05, numericParams["Tq0pp"] || 0.5));
      const xdExpr = ensureParamExpr("Xd", Math.max(xdpVal, numericParams["Xd"] || 1.8));
      const xqExpr = ensureParamExpr("Xq", Math.max(xdpVal, numericParams["Xq"] || 1.7));
      const xqpExpr = allParamNames.has("Xqp")
        ? dae.addNameExpr(p("Xqp"))
        : ensureParamExpr("Xdpp", Math.max(0.05, numericParams["Xdpp"] || 0.25));
      const efd0Expr = ensureParamExpr("Efd0", efd0Val);

      // Eq 3: Td0p * der(Eqp) = Efd_in - Eqp - ((Xd - Xdp) / Xd) * (V0 - Vt_in)
      const lhsEqp = dae.addBinaryExpr(BinOp.Mul, td0pExpr, dae.addDerExpr(dae.addNameExpr(p("Eqp"))));
      const armatureDrop = dae.addBinaryExpr(
        BinOp.Mul,
        dae.addBinaryExpr(BinOp.Div, dae.addBinaryExpr(BinOp.Sub, xdExpr, xdpExpr), xdExpr),
        dae.addBinaryExpr(BinOp.Sub, v0Expr, dae.addNameExpr(p("Vt_in"))),
      );
      const rhsEqp = dae.addBinaryExpr(
        BinOp.Sub,
        dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(p("Efd_in")), dae.addNameExpr(p("Eqp"))),
        armatureDrop,
      );
      dae.addEquation(EqKind.Simple, lhsEqp, rhsEqp);

      // Eq 4: Tq0p * der(Edp) = ((Xq - Xqp) / Xq) * sin(delta - delta0) - Edp
      const lhsEdp = dae.addBinaryExpr(BinOp.Mul, tq0pExpr, dae.addDerExpr(dae.addNameExpr(p("Edp"))));
      const qAxisGain = dae.addBinaryExpr(BinOp.Div, dae.addBinaryExpr(BinOp.Sub, xqExpr, xqpExpr), xqExpr);
      const rhsEdp = dae.addBinaryExpr(
        BinOp.Sub,
        dae.addBinaryExpr(BinOp.Mul, qAxisGain, sinDeltaDev),
        dae.addNameExpr(p("Edp")),
      );
      dae.addEquation(EqKind.Simple, lhsEdp, rhsEdp);

      // Eq 5: Pe_out = P0 * (Eqp / Efd0) * (Vt_in / V0) + (Eqp * Vt_in / Xdp) * sin(delta - delta0)
      const fluxScale = dae.addBinaryExpr(
        BinOp.Mul,
        dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(p("Eqp")), efd0Expr),
        dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(p("Vt_in")), v0Expr),
      );
      const baseP = dae.addBinaryExpr(BinOp.Mul, p0Expr, fluxScale);
      const syncAmp = dae.addBinaryExpr(
        BinOp.Div,
        dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(p("Eqp")), dae.addNameExpr(p("Vt_in"))),
        xdpExpr,
      );
      const peRhs = dae.addBinaryExpr(BinOp.Add, baseP, dae.addBinaryExpr(BinOp.Mul, syncAmp, sinDeltaDev));
      dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Pe_out")), peRhs);
    }

    // Output speed tie: omega_out = omega
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("omega_out")), dae.addNameExpr(p("omega")));
    return deferredDefaults;
  }

  if (schema.category === "exciter") {
    const v0Val = numericParams["V0"] ?? 1.0;
    const efd0Val = numericParams["Efd0"] ?? 1.05;

    bindUnconnectedInput("Vt_in", ensureParamExpr("V0", v0Val));
    bindUnconnectedInput("Vs_in", dae.addRealLiteral(0.0));

    dae.addVariable(p("Efd"), VarType.Real, Variability.Continuous, Causality.Local, efd0Val);
    const kaExpr = allParamNames.has("KA")
      ? dae.addNameExpr(p("KA"))
      : allParamNames.has("K")
        ? dae.addNameExpr(p("K"))
        : allParamNames.has("Kvp")
          ? dae.addNameExpr(p("Kvp"))
          : dae.addRealLiteral(100.0);
    const taExpr = allParamNames.has("TA")
      ? dae.addNameExpr(p("TA"))
      : allParamNames.has("TE")
        ? dae.addNameExpr(p("TE"))
        : allParamNames.has("Tiq")
          ? dae.addNameExpr(p("Tiq"))
          : dae.addRealLiteral(0.05);
    const v0Expr = ensureParamExpr("V0", v0Val);
    const efd0Expr = ensureParamExpr("Efd0", efd0Val);

    // TA * der(Efd) = Efd0 + KA * ((V0 - Vt_in) + Vs_in) - Efd
    const lhsExc = dae.addBinaryExpr(BinOp.Mul, taExpr, dae.addDerExpr(dae.addNameExpr(p("Efd"))));
    const vErr = dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(BinOp.Sub, v0Expr, dae.addNameExpr(p("Vt_in"))),
      dae.addNameExpr(p("Vs_in")),
    );
    const regOut = dae.addBinaryExpr(BinOp.Add, efd0Expr, dae.addBinaryExpr(BinOp.Mul, kaExpr, vErr));
    dae.addEquation(EqKind.Simple, lhsExc, dae.addBinaryExpr(BinOp.Sub, regOut, dae.addNameExpr(p("Efd"))));
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Efd_out")), dae.addNameExpr(p("Efd")));
    return deferredDefaults;
  }

  if (schema.category === "governor") {
    const p0Val = numericParams["P0"] ?? 0.8;
    const omega0Val = Math.max(1.0, numericParams["omega0"] ?? 376.99111843077515);

    bindUnconnectedInput("omega_in", ensureParamExpr("omega0", omega0Val));

    dae.addVariable(p("Pm"), VarType.Real, Variability.Continuous, Causality.Local, p0Val);
    const tGovExpr = allParamNames.has("T1")
      ? dae.addNameExpr(p("T1"))
      : allParamNames.has("Tg")
        ? dae.addNameExpr(p("Tg"))
        : allParamNames.has("Tact")
          ? dae.addNameExpr(p("Tact"))
          : dae.addRealLiteral(0.5);
    const droopGainExpr = allParamNames.has("R")
      ? dae.addBinaryExpr(BinOp.Div, dae.addRealLiteral(1.0), dae.addNameExpr(p("R")))
      : allParamNames.has("K")
        ? dae.addNameExpr(p("K"))
        : allParamNames.has("Ddn")
          ? dae.addNameExpr(p("Ddn"))
          : dae.addRealLiteral(20.0);
    const p0Expr = ensureParamExpr("P0", p0Val);
    const omega0Expr = ensureParamExpr("omega0", omega0Val);

    // T1 * der(Pm) = P0 - (1 / R) * ((omega_in - omega0) / omega0) - Pm
    const lhsGov = dae.addBinaryExpr(BinOp.Mul, tGovExpr, dae.addDerExpr(dae.addNameExpr(p("Pm"))));
    const speedPuErr = dae.addBinaryExpr(
      BinOp.Div,
      dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(p("omega_in")), omega0Expr),
      omega0Expr,
    );
    const droopTerm = dae.addBinaryExpr(BinOp.Mul, droopGainExpr, speedPuErr);
    const pCmd = dae.addBinaryExpr(BinOp.Sub, p0Expr, droopTerm);
    dae.addEquation(EqKind.Simple, lhsGov, dae.addBinaryExpr(BinOp.Sub, pCmd, dae.addNameExpr(p("Pm"))));
    dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Pm_out")), dae.addNameExpr(p("Pm")));
    return deferredDefaults;
  }

  // Stabilizer (IEEEST / PSS2A)
  const omega0Val = Math.max(1.0, numericParams["omega0"] ?? 376.99111843077515);
  bindUnconnectedInput("omega_in", ensureParamExpr("omega0", omega0Val));

  dae.addVariable(p("x_wash"), VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const twExpr = allParamNames.has("T6")
    ? dae.addNameExpr(p("T6"))
    : allParamNames.has("Tw1")
      ? dae.addNameExpr(p("Tw1"))
      : dae.addRealLiteral(5.0);
  const ksExpr = allParamNames.has("KS")
    ? dae.addNameExpr(p("KS"))
    : allParamNames.has("Ks1")
      ? dae.addNameExpr(p("Ks1"))
      : dae.addRealLiteral(10.0);
  const omega0Expr = ensureParamExpr("omega0", omega0Val);

  const speedSignal = dae.addBinaryExpr(
    BinOp.Mul,
    ksExpr,
    dae.addBinaryExpr(BinOp.Div, dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(p("omega_in")), omega0Expr), omega0Expr),
  );
  // Tw * der(x_wash) = KS * dw - x_wash ; Vs_out = KS * dw - x_wash
  const washDiff = dae.addBinaryExpr(BinOp.Sub, speedSignal, dae.addNameExpr(p("x_wash")));
  dae.addEquation(
    EqKind.Simple,
    dae.addBinaryExpr(BinOp.Mul, twExpr, dae.addDerExpr(dae.addNameExpr(p("x_wash")))),
    washDiff,
  );
  dae.addEquation(EqKind.Simple, dae.addNameExpr(p("Vs_out")), washDiff);
  return deferredDefaults;
}
