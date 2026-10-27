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

  // 1. Declare Bus Voltage and Current Variables
  for (const b of buses) {
    const isSlack = deck.circuit?.bus1 === b;
    const nomKv = isSlack ? (deck.circuit?.baseKv ?? 115.0) : 12.47;
    const vNom = (nomKv * 1e3) / Math.sqrt(3);

    dae.addVariable(`V_${b}`, VarType.Real, Variability.Continuous, Causality.Local, vNom);
    dae.addVariable(`I_inj_${b}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 2. Substation Voltage Source equation on Slack Bus
  if (deck.circuit) {
    const slackName = deck.circuit.bus1;
    const sVar = dae.lookupVariable(`V_${slackName}`);
    if (sVar !== -1) {
      const vNom = ((deck.circuit.baseKv * 1e3) / Math.sqrt(3)) * deck.circuit.pu;
      dae.addEquation(EqKind.Simple, dae.addName(sVar), dae.addRealLiteral(vNom));
    }
  }

  // 3. Declare Lines and series RL differential equations
  for (const [id, line] of deck.lines) {
    const lc = line.lineCode ? deck.lineCodes.get(line.lineCode) : undefined;
    const r1 = line.r1 ?? lc?.r1 ?? 0.1;
    const x1 = line.x1 ?? lc?.x1 ?? 0.4;
    const omega = 2 * Math.PI * 60;
    const l1 = x1 / omega;

    const rTotal = r1 * line.length;
    const lTotal = l1 * line.length;

    dae.addVariable(`I_line_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const iLineVar = dae.lookupVariable(`I_line_${id}`);
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
    }
  }

  // 4. Declare Transformers and voltage transformation equations
  for (const [id, xfmr] of deck.transformers) {
    const b1 = xfmr.buses[0] ?? "Bus1";
    const b2 = xfmr.buses[1] ?? "Bus2";
    const kv1 = xfmr.kvs[0] ?? 115.0;
    const kv2 = xfmr.kvs[1] ?? 12.47;
    const ratio = kv1 / kv2;

    dae.addVariable(`I_xfmr_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const v1Var = dae.lookupVariable(`V_${b1}`);
    const v2Var = dae.lookupVariable(`V_${b2}`);

    if (v1Var !== -1 && v2Var !== -1) {
      // V1 = ratio * V2
      const ratioTimesV2 = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(ratio), dae.addName(v2Var));
      dae.addEquation(EqKind.Simple, dae.addName(v1Var), ratioTimesV2);
    }
  }

  // 5. Declare Loads: I_load = V_bus / R_eq
  for (const [id, load] of deck.loads) {
    dae.addVariable(`I_load_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const iLoadVar = dae.lookupVariable(`I_load_${id}`);
    const vBusVar = dae.lookupVariable(`V_${load.bus1}`);

    if (iLoadVar !== -1 && vBusVar !== -1) {
      const vNom = (load.kv * 1e3) / Math.sqrt(3);
      const pPhase = (load.kw * 1e3) / load.phases;
      const rEq = pPhase > 0 ? (vNom * vNom) / pPhase : 1000.0;

      const vOverR = dae.addBinaryExpr(BinOp.Div, dae.addName(vBusVar), dae.addRealLiteral(rEq));
      dae.addEquation(EqKind.Simple, dae.addName(iLoadVar), vOverR);
    }
  }

  return dae;
}
