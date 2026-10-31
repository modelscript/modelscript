// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendss — Direct Linear-Memory DAE Arena Lowering for Distribution Grids.
 *
 * Compiles multiphase distribution network lines, substation transformers, solar PV systems,
 * and loads into ModelScript's zero-GC DAEBuilder:
 *   1. Bus voltages v_bus and injection currents i_bus
 *   2. Line RL branch dynamic equations: L * der(i_line) = v_bus1 - v_bus2 - R * i_line
 *   3. Transformer winding coupling and leakage inductance
 *   4. Load and PV generation constitutive equations
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { DssDeck } from "../types.js";

export interface DssDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerOpenDssToDae(deck: DssDeck, options?: DssDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (deck.circuit?.name || "DistributionGrid")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // Collect all unique buses
  const buses = new Set<string>();
  if (deck.circuit) buses.add(deck.circuit.bus1);
  for (const [, line] of deck.lines) {
    buses.add(line.bus1);
    buses.add(line.bus2);
  }
  for (const [, xfmr] of deck.transformers) {
    for (const b of xfmr.buses) buses.add(b);
  }
  for (const [, l] of deck.loads) buses.add(l.bus1);
  for (const [, pv] of deck.pvSystems) buses.add(pv.bus1);
  for (const [, st] of deck.storages) buses.add(st.bus1);
  for (const [, cap] of deck.capacitors) buses.add(cap.bus1);

  const omega = 2 * Math.PI * (deck.circuit?.frequency ?? 60);

  // Track shunt injection terms and branch leaving terms per bus
  const busShuntTerms = new Map<string, { exprId: number; isGeneration: boolean }[]>();
  const busBranchTerms = new Map<string, { exprId: number; isLeaving: boolean }[]>();
  for (const b of buses) {
    busShuntTerms.set(b, []);
    busBranchTerms.set(b, []);
  }

  // 1. Declare Bus Voltage and Current Variables
  for (const b of buses) {
    const isSlack = deck.circuit?.bus1 === b;
    const nomKv = isSlack ? (deck.circuit?.baseKv ?? 115.0) : 12.47;
    const vNom = (nomKv * 1e3) / Math.sqrt(3);

    dae.addVariable(`V_${b}`, VarType.Real, Variability.Continuous, Causality.Local, vNom);
    dae.addVariable(`I_inj_${b}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 2. Declare Lines and series RL differential equations
  for (const [id, line] of deck.lines) {
    const lc = line.lineCode ? deck.lineCodes.get(line.lineCode) : undefined;
    const r1 = line.r1 ?? lc?.r1 ?? 0.1;
    const x1 = line.x1 ?? lc?.x1 ?? 0.4;
    const l1 = x1 / omega;

    const rTotal = r1 * Math.max(1e-6, line.length);
    const lTotal = l1 * Math.max(1e-6, line.length);

    const iLineVar = dae.addVariable(`I_line_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const v1Var = dae.lookupVariable(`V_${line.bus1}`);
    const v2Var = dae.lookupVariable(`V_${line.bus2}`);

    if (iLineVar !== -1 && v1Var !== -1 && v2Var !== -1) {
      // L * der(i) = v1 - v2 - R * i
      const derILine = dae.addDer(iLineVar);
      const lTimesDer = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(lTotal), derILine);
      const vDiff = dae.addBinaryExpr(BinOp.Sub, dae.addName(v1Var), dae.addName(v2Var));
      const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rTotal), dae.addName(iLineVar));
      const rhs = dae.addBinaryExpr(BinOp.Sub, vDiff, rDrop);

      dae.addEquation(EqKind.Simple, lTimesDer, rhs);

      busBranchTerms.get(line.bus1)?.push({ exprId: dae.addName(iLineVar), isLeaving: true });
      busBranchTerms.get(line.bus2)?.push({ exprId: dae.addName(iLineVar), isLeaving: false });
    }
  }

  // 3. Declare Transformers and leakage RL / turns-ratio equations
  for (const [id, xfmr] of deck.transformers) {
    const b1 = xfmr.buses[0] ?? "Bus1";
    const b2 = xfmr.buses[1] ?? "Bus2";
    const kv1 = xfmr.kvs[0] ?? 115.0;
    const kv2 = xfmr.kvs[1] ?? 12.47;
    const kva = xfmr.kvas[1] ?? xfmr.kvas[0] ?? 10000.0;
    const ratio = kv1 / kv2;

    const zBase2 = (kv2 * kv2 * 1000.0) / Math.max(1.0, kva);
    const rLeak = ((xfmr.pctLoadLoss ?? 0.5) / 100.0) * zBase2;
    const xLeak = (Math.max(0.1, xfmr.xhl ?? 5.0) / 100.0) * zBase2;
    const lLeak = xLeak / omega;

    const iXfmrVar = dae.addVariable(`I_xfmr_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const v1Var = dae.lookupVariable(`V_${b1}`);
    const v2Var = dae.lookupVariable(`V_${b2}`);

    if (iXfmrVar !== -1 && v1Var !== -1 && v2Var !== -1) {
      // L_leak * der(I_xfmr) = (V_b1 / ratio) - V_b2 - R_leak * I_xfmr
      const derIXfmr = dae.addDer(iXfmrVar);
      const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(lLeak), derIXfmr);
      const v1Scaled = dae.addBinaryExpr(BinOp.Div, dae.addName(v1Var), dae.addRealLiteral(ratio));
      const vDiff = dae.addBinaryExpr(BinOp.Sub, v1Scaled, dae.addName(v2Var));
      const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rLeak), dae.addName(iXfmrVar));
      const rhs = dae.addBinaryExpr(BinOp.Sub, vDiff, rDrop);
      dae.addEquation(EqKind.Simple, lhs, rhs);

      const iPrimaryExpr = dae.addBinaryExpr(BinOp.Div, dae.addName(iXfmrVar), dae.addRealLiteral(ratio));
      busBranchTerms.get(b1)?.push({ exprId: iPrimaryExpr, isLeaving: true });
      busBranchTerms.get(b2)?.push({ exprId: dae.addName(iXfmrVar), isLeaving: false });
    }
  }

  // 4. Declare Loads: I_load = V_bus / R_eq
  for (const [id, load] of deck.loads) {
    const iLoadVar = dae.addVariable(`I_load_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const vBusVar = dae.lookupVariable(`V_${load.bus1}`);

    if (iLoadVar !== -1 && vBusVar !== -1) {
      const vNom = (load.kv * 1e3) / Math.sqrt(3);
      const pPhase = (load.kw * 1e3) / Math.max(1, load.phases);
      const rEq = pPhase > 0 ? (vNom * vNom) / pPhase : 1000.0;

      const vOverR = dae.addBinaryExpr(BinOp.Div, dae.addName(vBusVar), dae.addRealLiteral(rEq));
      dae.addEquation(EqKind.Simple, dae.addName(iLoadVar), vOverR);
      busShuntTerms.get(load.bus1)?.push({ exprId: dae.addName(iLoadVar), isGeneration: false });
    }
  }

  // 5. Declare PVSystems: I_pv = P_phase / V_nom
  for (const [id, pv] of deck.pvSystems) {
    const iPvVar = dae.addVariable(`I_pv_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (iPvVar !== -1) {
      const vNom = Math.max(1.0, (pv.kv * 1e3) / Math.sqrt(3));
      const pPhase = (pv.pmpp * 1e3) / Math.max(1, pv.phases);
      const iGen = pPhase / vNom;
      dae.addEquation(EqKind.Simple, dae.addName(iPvVar), dae.addRealLiteral(iGen));
      busShuntTerms.get(pv.bus1)?.push({ exprId: dae.addName(iPvVar), isGeneration: true });
    }
  }

  // 6. Declare Storages: I_storage = P_rated_phase / V_nom
  for (const [id, st] of deck.storages) {
    const iStVar = dae.addVariable(`I_storage_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (iStVar !== -1) {
      const vNom = Math.max(1.0, (st.kv * 1e3) / Math.sqrt(3));
      const pPhase = (st.kwRated * 1e3) / Math.max(1, st.phases);
      const iSt = pPhase / vNom;
      dae.addEquation(EqKind.Simple, dae.addName(iStVar), dae.addRealLiteral(iSt));
      busShuntTerms.get(st.bus1)?.push({ exprId: dae.addName(iStVar), isGeneration: true });
    }
  }

  // 7. Declare Shunt Capacitors: I_cap = C_eq * der(V_bus)
  for (const [id, cap] of deck.capacitors) {
    const iCapVar = dae.addVariable(`I_cap_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const vBusVar = dae.lookupVariable(`V_${cap.bus1}`);
    if (iCapVar !== -1 && vBusVar !== -1) {
      const vNom = Math.max(1.0, (cap.kv * 1e3) / Math.sqrt(3));
      const qPhase = (cap.kvar * 1e3) / Math.max(1, cap.phases);
      const cEq = qPhase / (omega * vNom * vNom);
      const rhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cEq), dae.addDer(vBusVar));
      dae.addEquation(EqKind.Simple, dae.addName(iCapVar), rhs);
      busShuntTerms.get(cap.bus1)?.push({ exprId: dae.addName(iCapVar), isGeneration: false });
    }
  }

  // 8. Emit 2 equations per bus: (a) I_inj_b net shunt equation, and (b) Slack voltage or Nodal KCL equation
  for (const b of buses) {
    const vVar = dae.lookupVariable(`V_${b}`);
    const iInjVar = dae.lookupVariable(`I_inj_${b}`);
    if (vVar === -1 || iInjVar === -1) continue;

    // (a) I_inj_b = sum(I_gen) - sum(I_load / I_cap)
    const shunts = busShuntTerms.get(b) ?? [];
    let shuntSum: number | null = null;
    for (const s of shunts) {
      if (shuntSum === null) {
        shuntSum = s.isGeneration ? s.exprId : dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), s.exprId);
      } else {
        shuntSum = dae.addBinaryExpr(s.isGeneration ? BinOp.Add : BinOp.Sub, shuntSum, s.exprId);
      }
    }
    dae.addEquation(EqKind.Simple, dae.addName(iInjVar), shuntSum ?? dae.addRealLiteral(0.0));

    // (b) Slack bus voltage source OR Nodal KCL: sum(I_leaving) - sum(I_entering) = I_inj_b
    const isSlack = deck.circuit?.bus1 === b;
    if (isSlack && deck.circuit) {
      const vNom = ((deck.circuit.baseKv * 1e3) / Math.sqrt(3)) * deck.circuit.pu;
      dae.addEquation(EqKind.Simple, dae.addName(vVar), dae.addRealLiteral(vNom));
    } else {
      const branches = busBranchTerms.get(b) ?? [];
      if (branches.length === 0) {
        dae.addEquation(EqKind.Simple, dae.addName(vVar), dae.addRealLiteral(0.0));
      } else {
        let kclLhs: number | null = null;
        for (const br of branches) {
          if (kclLhs === null) {
            kclLhs = br.isLeaving ? br.exprId : dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), br.exprId);
          } else {
            kclLhs = dae.addBinaryExpr(br.isLeaving ? BinOp.Add : BinOp.Sub, kclLhs, br.exprId);
          }
        }
        dae.addEquation(EqKind.Simple, kclLhs ?? dae.addRealLiteral(0.0), dae.addName(iInjVar));
      }
    }
  }

  return dae;
}
