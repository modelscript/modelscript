// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for NASA SINDA Thermal Networks.
 *
 * Lowers diffusion (+n), arithmetic (0), and boundary (-n) thermal nodes along with
 * linear (+g) and Stefan-Boltzmann radiation (-g: σ * G_ij * (T_i^4 - T_j^4)) conductors
 * directly into @modelscript/runtime's `IDaeBuilder` without allocating intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import type { SindaConductor, SindaModel } from "../types.js";

export interface SindaDaeLoweringResult {
  /** Variable indices for diffusion state nodes (C > 0). */
  stateVarIndices: number[];
  /** Variable indices for arithmetic algebraic nodes (C == 0). */
  algebraicVarIndices: number[];
  /** Variable indices for fixed boundary temperature nodes. */
  boundaryVarIndices: number[];
  /** Total number of DAE equations emitted. */
  equationCount: number;
  /** Map from canonical node ID to DAE variable index. */
  nodeVarMap: Map<number, number>;
}

/**
 * Builds an arena expression for `T_abs^4` using `((T - abszro)^2)^2`.
 */
function buildTempPow4Expr(builder: IDaeBuilder, tempVarIdx: number, abszro: number): number {
  const tRef = builder.addName(tempVarIdx);
  const tAbs = abszro !== 0 ? builder.addBinaryExpr(BinOp.Sub, tRef, builder.addRealLiteral(abszro)) : tRef;
  const t2 = builder.addBinaryExpr(BinOp.Mul, tAbs, tAbs);
  return builder.addBinaryExpr(BinOp.Mul, t2, t2);
}

/**
 * Lowers a parsed `SindaModel` directly into an `IDaeBuilder` linear-memory arena.
 */
export function lowerSindaToDae(builder: IDaeBuilder, model: SindaModel): SindaDaeLoweringResult {
  const nodeVarMap = new Map<number, number>();
  const stateVarIndices: number[] = [];
  const algebraicVarIndices: number[] = [];
  const boundaryVarIndices: number[] = [];
  let equationCount = 0;

  const sigma = model.options.sigma;
  const abszro = model.options.abszro;

  // 1. Register all thermal nodes as DAE variables / parameters
  for (const node of model.nodes.values()) {
    const varName = `T_${node.id}`;
    if (node.kind === "boundary") {
      const idx = builder.addVariable(varName, VarType.Real, Variability.Parameter, Causality.Local, node.initialTemp);
      nodeVarMap.set(node.id, idx);
      boundaryVarIndices.push(idx);
    } else if (node.kind === "diffusion") {
      const idx = builder.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, node.initialTemp);
      nodeVarMap.set(node.id, idx);
      stateVarIndices.push(idx);
    } else {
      const idx = builder.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, node.initialTemp);
      nodeVarMap.set(node.id, idx);
      algebraicVarIndices.push(idx);
    }
  }

  // 2. Aggregate heat sources per node
  const heatLoadByNode = new Map<number, number>();
  for (const src of model.sources) {
    heatLoadByNode.set(src.nodeId, (heatLoadByNode.get(src.nodeId) ?? 0.0) + src.heatLoad);
  }

  // 3. Build incident conductor list per node
  const incident = new Map<number, Array<{ cond: SindaConductor; neighborId: number }>>();
  for (const id of model.nodes.keys()) {
    incident.set(id, []);
  }
  for (const cond of model.conductors.values()) {
    if (cond.nodeI === cond.nodeJ) continue;
    if (!model.nodes.has(cond.nodeI) || !model.nodes.has(cond.nodeJ)) continue;
    incident.get(cond.nodeI)!.push({ cond, neighborId: cond.nodeJ });
    incident.get(cond.nodeJ)!.push({ cond, neighborId: cond.nodeI });
  }

  // 4. Emit thermal energy balance equations for each diffusion and arithmetic node
  for (const node of model.nodes.values()) {
    if (node.kind === "boundary") continue;

    const varIdx = nodeVarMap.get(node.id)!;
    const qVal = heatLoadByNode.get(node.id) ?? 0.0;

    let rhsExpr: number | null = qVal !== 0.0 ? builder.addRealLiteral(qVal) : null;

    const edges = incident.get(node.id) ?? [];
    for (const { cond, neighborId } of edges) {
      const neighborVarIdx = nodeVarMap.get(neighborId)!;
      let fluxExpr: number;

      if (cond.kind === "linear") {
        // G * (T_j - T_i)
        const dT = builder.addBinaryExpr(BinOp.Sub, builder.addName(neighborVarIdx), builder.addName(varIdx));
        fluxExpr = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(cond.conductance), dT);
      } else {
        // sigma * G_ij * (T_j^4 - T_i^4)
        const tj4 = buildTempPow4Expr(builder, neighborVarIdx, abszro);
        const ti4 = buildTempPow4Expr(builder, varIdx, abszro);
        const dT4 = builder.addBinaryExpr(BinOp.Sub, tj4, ti4);
        const radCoeff = sigma * cond.conductance;
        fluxExpr = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(radCoeff), dT4);
      }

      rhsExpr = rhsExpr === null ? fluxExpr : builder.addBinaryExpr(BinOp.Add, rhsExpr, fluxExpr);
    }

    if (rhsExpr === null) {
      rhsExpr = builder.addRealLiteral(0.0);
    }

    if (node.kind === "diffusion") {
      // C_i * der(T_i) = Q_i + sum(flux_ij)
      const derT = builder.addDer(varIdx);
      const lhsExpr = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(node.capacitance), derT);
      builder.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      equationCount++;
    } else {
      // Arithmetic node (C = 0): 0 = Q_i + sum(flux_ij)
      builder.addEquation(EqKind.Simple, builder.addRealLiteral(0.0), rhsExpr);
      equationCount++;
    }
  }

  return {
    stateVarIndices,
    algebraicVarIndices,
    boundaryVarIndices,
    equationCount,
    nodeVarMap,
  };
}
