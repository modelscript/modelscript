// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder } from "@modelscript/runtime";
import { lowerFlowpathToDae, type DaeCellMeta, type FlowpathJunctionCoupling } from "../solver/drift-flux-dae.js";
import type { OlgaModel } from "../types.js";

export interface OlgaDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Direct lowering of OLGA multiphase flow networks into ModelScript's linear-memory DAE arena.
 * Couples feeding and receiving flowpaths across shared INTERNAL manifold/tee junction nodes.
 */
export function lowerOlgaToDae(model: OlgaModel, options?: OlgaDaeOptions): DAEBuilder {
  const modelName = options?.modelName ?? model.flowpaths[0]?.name ?? "OlgaPipeline";
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const internalJunctions = model.nodes.filter((n) => n.type === "INTERNAL");
  const loweredMeta = new Map<
    string,
    { firstCellMeta?: DaeCellMeta | undefined; lastCellMeta?: DaeCellMeta | undefined }
  >();

  for (const flowpath of model.flowpaths) {
    let coupling: FlowpathJunctionCoupling | undefined;

    // Check if this flowpath starts at an INTERNAL junction fed by already-lowered upstream flowpaths
    for (const jNode of internalJunctions) {
      if (jNode.flowpath === flowpath.name && jNode.boundaryPosition <= 0.05) {
        const feedingMetas: DaeCellMeta[] = [];
        for (const otherNode of internalJunctions) {
          if (
            otherNode.name === jNode.name &&
            otherNode.flowpath !== flowpath.name &&
            otherNode.boundaryPosition >= 0.95
          ) {
            const upstream = loweredMeta.get(otherNode.flowpath)?.lastCellMeta;
            if (upstream) feedingMetas.push(upstream);
          }
        }
        if (feedingMetas.length > 0) {
          const downstreamArea =
            flowpath.pipes[0] != null ? 0.25 * Math.PI * Math.pow(Math.max(0.05, flowpath.pipes[0].diameter), 2) : 1.0;
          let sumJExpr = -1;
          let sumAlphaExpr = -1;
          let sumTempExpr = -1;
          for (const fm of feedingMetas) {
            const areaRatio = fm.area / Math.max(1e-4, downstreamArea);
            const jTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(areaRatio), dae.addName(fm.jFaceIdx));
            sumJExpr = sumJExpr === -1 ? jTerm : dae.addBinaryExpr(BinOp.Add, sumJExpr, jTerm);
            const aTerm = dae.addName(fm.alphaGIdx);
            sumAlphaExpr = sumAlphaExpr === -1 ? aTerm : dae.addBinaryExpr(BinOp.Add, sumAlphaExpr, aTerm);
            const tTerm = dae.addName(fm.tempIdx);
            sumTempExpr = sumTempExpr === -1 ? tTerm : dae.addBinaryExpr(BinOp.Add, sumTempExpr, tTerm);
          }
          const invCount = 1.0 / feedingMetas.length;
          coupling = {
            jInExpr: sumJExpr,
            alphaInExpr:
              feedingMetas.length > 1
                ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(invCount), sumAlphaExpr)
                : sumAlphaExpr,
            tempInExpr:
              feedingMetas.length > 1
                ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(invCount), sumTempExpr)
                : sumTempExpr,
          };
        }
      }
    }

    const res = lowerFlowpathToDae(dae, model, flowpath, coupling);
    loweredMeta.set(flowpath.name, { firstCellMeta: res.firstCellMeta, lastCellMeta: res.lastCellMeta });
  }

  return dae;
}
