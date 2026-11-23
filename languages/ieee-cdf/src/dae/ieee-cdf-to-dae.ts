// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct linear-memory DAE arena lowering for IEEE CDF / BPA IPF AC power-flow networks.
 *
 * Lowers nodal algebraic AC power-flow mismatch equations directly into `@modelscript/runtime`'s
 * `DAEBuilder` without intermediate AST wrapper allocations:
 *   P_i(V, theta) = P_g,i - P_l,i
 *   Q_i(V, theta) = Q_g,i - Q_l,i
 */

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { buildYBus } from "../solver/ybus.js";
import type { IeeeCdfNetwork } from "../types.js";

export interface IeeeCdfDaeLoweringResult {
  busVarIndices: Map<number, { vm: number; va: number; pSpec: number; qSpec: number }>;
  equationCount: number;
  variableCount: number;
}

export interface IeeeCdfToDaeOptions {
  modelName?: string;
}

/**
 * Lowers an IEEE CDF / BPA IPF power-flow network directly into a `DAEBuilder` arena.
 */
export function lowerIeeeCdfToDae(builder: DAEBuilder, network: IeeeCdfNetwork): IeeeCdfDaeLoweringResult {
  const mvaBase = network.title.mvaBase > 0 ? network.title.mvaBase : 100.0;
  const ybus = buildYBus(network);
  const n = ybus.size;

  const busVarIndices = new Map<number, { vm: number; va: number; pSpec: number; qSpec: number }>();
  const vmVars: number[] = new Array(n);
  const vaVars: number[] = new Array(n);
  const pSpecVars: number[] = new Array(n);
  const qSpecVars: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const bus = network.buses[i]!;
    const vInit =
      bus.desiredVoltsPu > 0 && (bus.type === 2 || bus.type === 3)
        ? bus.desiredVoltsPu
        : bus.finalVoltagePu > 0
          ? bus.finalVoltagePu
          : 1.0;
    const vaInitRad = (bus.finalAngleDeg * Math.PI) / 180.0;
    const pSpecPu = (bus.genMw - bus.loadMw) / mvaBase;
    const qSpecPu = (bus.genMvar - bus.loadMvar) / mvaBase;

    const vmIdx = builder.addVariable(
      `V_${bus.busNumber}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      vInit,
    );
    const vaIdx = builder.addVariable(
      `theta_${bus.busNumber}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      vaInitRad,
    );
    const pSpecIdx = builder.addVariable(
      `P_spec_${bus.busNumber}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      pSpecPu,
    );
    const qSpecIdx = builder.addVariable(
      `Q_spec_${bus.busNumber}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      qSpecPu,
    );

    vmVars[i] = vmIdx;
    vaVars[i] = vaIdx;
    pSpecVars[i] = pSpecIdx;
    qSpecVars[i] = qSpecIdx;
    busVarIndices.set(bus.busNumber, { vm: vmIdx, va: vaIdx, pSpec: pSpecIdx, qSpec: qSpecIdx });
  }

  let equationCount = 0;

  const buildPowerExpr = (i: number, isReactive: boolean): number => {
    const row = ybus.rows[i]!;
    const viRef = builder.addName(vmVars[i]!);
    const tiRef = builder.addName(vaVars[i]!);
    let sumExpr: number | null = null;

    for (let m = 0; m < row.length; m++) {
      const entry = row[m]!;
      const k = entry.col;
      const vkRef = builder.addName(vmVars[k]!);
      let termInner: number;

      if (k === i) {
        // cos(0) = 1, sin(0) = 0 -> G_ii for P, -B_ii for Q
        const coeff = isReactive ? -entry.b : entry.g;
        if (Math.abs(coeff) < 1e-15) continue;
        termInner = builder.addBinaryExpr(BinOp.Mul, vkRef, builder.addRealLiteral(coeff));
      } else {
        const tkRef = builder.addName(vaVars[k]!);
        const dTheta = builder.addBinaryExpr(BinOp.Sub, tiRef, tkRef);
        const cosExpr = builder.addCallExpr("cos", [dTheta]);
        const sinExpr = builder.addCallExpr("sin", [dTheta]);

        if (!isReactive) {
          // G_ik * cos(dTheta) + B_ik * sin(dTheta)
          const gTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(entry.g), cosExpr);
          const bTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(entry.b), sinExpr);
          const bracket = builder.addBinaryExpr(BinOp.Add, gTerm, bTerm);
          termInner = builder.addBinaryExpr(BinOp.Mul, vkRef, bracket);
        } else {
          // G_ik * sin(dTheta) - B_ik * cos(dTheta)
          const gTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(entry.g), sinExpr);
          const bTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(entry.b), cosExpr);
          const bracket = builder.addBinaryExpr(BinOp.Sub, gTerm, bTerm);
          termInner = builder.addBinaryExpr(BinOp.Mul, vkRef, bracket);
        }
      }

      sumExpr = sumExpr === null ? termInner : builder.addBinaryExpr(BinOp.Add, sumExpr, termInner);
    }

    if (sumExpr === null) {
      return builder.addRealLiteral(0.0);
    }
    return builder.addBinaryExpr(BinOp.Mul, viRef, sumExpr);
  };

  for (let i = 0; i < n; i++) {
    const bus = network.buses[i]!;
    const vSet =
      bus.desiredVoltsPu > 0 && (bus.type === 2 || bus.type === 3)
        ? bus.desiredVoltsPu
        : bus.finalVoltagePu > 0
          ? bus.finalVoltagePu
          : 1.0;

    if (bus.type === 3) {
      // Slack bus: V_i = V_set, theta_i = theta_set
      builder.addEquation(EqKind.Simple, builder.addName(vmVars[i]!), builder.addRealLiteral(vSet));
      builder.addEquation(
        EqKind.Simple,
        builder.addName(vaVars[i]!),
        builder.addRealLiteral((bus.finalAngleDeg * Math.PI) / 180.0),
      );
      equationCount += 2;
    } else if (bus.type === 2) {
      // PV bus: P_i(V, theta) = P_spec_i, V_i = V_set
      const pExpr = buildPowerExpr(i, false);
      builder.addEquation(EqKind.Simple, pExpr, builder.addName(pSpecVars[i]!));
      builder.addEquation(EqKind.Simple, builder.addName(vmVars[i]!), builder.addRealLiteral(vSet));
      equationCount += 2;
    } else {
      // PQ bus: P_i(V, theta) = P_spec_i, Q_i(V, theta) = Q_spec_i
      const pExpr = buildPowerExpr(i, false);
      const qExpr = buildPowerExpr(i, true);
      builder.addEquation(EqKind.Simple, pExpr, builder.addName(pSpecVars[i]!));
      builder.addEquation(EqKind.Simple, qExpr, builder.addName(qSpecVars[i]!));
      equationCount += 2;
    }
  }

  return {
    busVarIndices,
    equationCount,
    variableCount: n * 4,
  };
}

/**
 * Convenience helper that creates a `DAEBuilder` and lowers an IEEE CDF / BPA IPF network into it.
 */
export function ieeeCdfToDae(network: IeeeCdfNetwork, options?: IeeeCdfToDaeOptions): DAEBuilder {
  const rawName = options?.modelName || network.title.caseId || "IeeeCdfPowerFlow";
  const modelName = rawName.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  const builder = new DAEBuilder(undefined, modelName);
  lowerIeeeCdfToDae(builder, network);
  return builder;
}
