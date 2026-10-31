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
import { extractPowerFlowNetlist } from "../netlist/powerflow-netlist.js";
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
      psseCase.dyr?.records?.find(
        (m) => m.ibus === gen.i && (m.model === "GENROU" || m.model === "GENSAL" || m.model === "GENCLS"),
      );
    const dyrExc =
      psseCase.dyr?.excitersByBusId.get(genId) ??
      psseCase.dyr?.excitersByBusId.get(String(gen.i)) ??
      psseCase.dyr?.records?.find(
        (m) => m.ibus === gen.i && (m.model === "EXST1" || m.model === "IEEET1" || m.model === "SEXS"),
      );
    const dyrGov =
      psseCase.dyr?.governorsByBusId.get(genId) ??
      psseCase.dyr?.governorsByBusId.get(String(gen.i)) ??
      psseCase.dyr?.records?.find(
        (m) => m.ibus === gen.i && (m.model === "TGOV1" || m.model === "IEEEG1" || m.model === "HYGOV"),
      );

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

    // Optional TGOV1 governor state: Pm_${genId}
    let pmExpr = dae.addRealLiteral(gen.pg);
    if (dyrGov) {
      const pmVar = dae.addVariable(`Pm_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, gen.pg);
      const rDroop = Math.max(0.005, dyrGov.namedParams["R"] ?? dyrGov.con[0] ?? 0.05);
      const t1Gov = Math.max(0.01, dyrGov.namedParams["T1"] ?? dyrGov.con[1] ?? 0.5);
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

    // Optional EXST1 exciter state: Efd_${genId}
    let efdExpr = dae.addRealLiteral(1.05);
    const vrBusExpr = bus ? dae.addNameExpr(`V_${gen.i}_r`) : dae.addRealLiteral(1.0);
    if (dyrExc) {
      const efd0 = 1.05;
      const efdVar = dae.addVariable(`Efd_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, efd0);
      const kaExc = Math.max(1.0, dyrExc.namedParams["KA"] ?? dyrExc.con[2] ?? 200.0);
      const taExc = Math.max(0.005, dyrExc.namedParams["TA"] ?? dyrExc.con[3] ?? 0.02);
      const vRef = (bus?.vm ?? 1.0) + efd0 / kaExc;
      const derEfd = dae.addDer(efdVar);
      const lhsExc = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(taExc), derEfd);
      const vErr = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(vRef), vrBusExpr);
      const kaVerr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kaExc), vErr);
      const efdNameExpr = dae.addNameExpr(`Efd_${genId}`);
      const rhsExc = dae.addBinaryExpr(BinOp.Sub, kaVerr, efdNameExpr);
      dae.addEquation(EqKind.Simple, lhsExc, rhsExc);
      efdExpr = efdNameExpr;
    }

    // Optional GENROU / GENSAL transient flux linkage states: Eqp_${genId} (E'_q) and Edp_${genId} (E'_d)
    let eqpExpr: number | null = null;
    if (dyrGen && (dyrGen.model === "GENROU" || dyrGen.model === "GENSAL")) {
      const eqp0 = 1.05;
      const edp0 = 0.0;
      const eqpVar = dae.addVariable(`Eqp_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, eqp0);
      const edpVar = dae.addVariable(`Edp_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, edp0);

      const td0p = Math.max(0.05, dyrGen.namedParams["Td0p"] ?? dyrGen.con[0] ?? 6.5);
      const tq0p = Math.max(0.05, dyrGen.namedParams["Tq0p"] ?? dyrGen.con[2] ?? 1.0);
      const xdSync = Math.max(xd, dyrGen.namedParams["Xd"] ?? dyrGen.con[5] ?? 1.8);
      const xqSync = Math.max(xd, dyrGen.namedParams["Xq"] ?? dyrGen.con[6] ?? 1.7);
      const xqp = Math.max(0.05, dyrGen.namedParams["Xqp"] ?? dyrGen.con[8] ?? 0.55);

      // Td0' * der(Eqp) = Efd - Eqp - ((Xd - Xd') / Xd') * (Eqp - V_r)
      const derEqp = dae.addDer(eqpVar);
      const lhsEqp = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(td0p), derEqp);
      const eqpNameExpr = dae.addNameExpr(`Eqp_${genId}`);
      const idDrop = dae.addBinaryExpr(
        BinOp.Mul,
        dae.addRealLiteral((xdSync - xd) / xd),
        dae.addBinaryExpr(BinOp.Sub, eqpNameExpr, vrBusExpr),
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

    // Eq 3: Air-gap electrical power coupled to rotor angle, internal flux Eqp (if GENROU), & terminal bus voltage
    // Pe = Pg0 + (Sbase / xd) * Eqp * (delta - delta0) * V_i_r
    const deltaExpr = dae.addNameExpr(`delta_${genId}`);
    const deltaDev = dae.addBinaryExpr(BinOp.Sub, deltaExpr, dae.addRealLiteral(delta0));
    const kSync = dae.addRealLiteral(sbase / xd);
    const baseSyncTerm = dae.addBinaryExpr(BinOp.Mul, dae.addBinaryExpr(BinOp.Mul, kSync, deltaDev), vrBusExpr);
    const syncPower = eqpExpr !== null ? dae.addBinaryExpr(BinOp.Mul, eqpExpr, baseSyncTerm) : baseSyncTerm;
    const peRhs = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(gen.pg), syncPower);
    dae.addEquation(EqKind.Simple, peExpr, peRhs);
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

    // Bus Eq 3: Active nodal network balance sum_k(G_ik V_kr - B_ik V_ki) = P_inj / Sbase
    const pInjPu = dae.addBinaryExpr(BinOp.Div, pInj, dae.addRealLiteral(sbase));
    dae.addEquation(EqKind.Simple, irSumExpr, pInjPu);

    // Bus Eq 4: PV/Slack voltage magnitude regulation or PQ reactive nodal network balance
    if (bus.ide === 2 || bus.ide === 3) {
      const vSet = bus.vm > 0 ? bus.vm : 1.0;
      const vr2 = dae.addBinaryExpr(BinOp.Mul, vrExpr, vrExpr);
      const vi2 = dae.addBinaryExpr(BinOp.Mul, viExpr, viExpr);
      const vMag2 = dae.addBinaryExpr(BinOp.Add, vr2, vi2);
      dae.addEquation(EqKind.Simple, vMag2, dae.addRealLiteral(vSet * vSet));
    } else {
      const negQInjPu = dae.addBinaryExpr(BinOp.Div, qInj, dae.addRealLiteral(-sbase));
      dae.addEquation(EqKind.Simple, iiSumExpr, negQInjPu);
    }
  }

  return dae;
}
