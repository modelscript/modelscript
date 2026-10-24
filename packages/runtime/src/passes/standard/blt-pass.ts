// SPDX-License-Identifier: AGPL-3.0-or-later

import { performBltTransformationArena, type ArenaBltResult } from "../../analysis/wasm_blt.js";
import type { DAEBuilder } from "../../dae/wasm_dae.js";
import type { DAEPass, PassContext, PassResult } from "../pass.js";

/**
 * Structural bipartite graph metadata extracted during BLT decomposition.
 */
export interface InspectableBipartiteGraph {
  equationCount: number;
  variableCount: number;
  blockCount: number;
  algebraicLoopCount: number;
  blocks: {
    eqIdxs: number[];
    vars: number[];
    isAlgebraicLoop: boolean;
  }[];
  sortedEquations: number[];
}

/**
 * Compiler pass that performs Block Lower Triangular (BLT) decomposition
 * and Tarjan strongly connected components (SCC) analysis.
 */
export class BltPass implements DAEPass {
  readonly name = "blt";
  readonly description =
    "Performs Block Lower Triangular decomposition, sorting equations and identifying algebraic loops";

  run(arena: DAEBuilder, ctx: PassContext): PassResult {
    ctx.log("Running Block Lower Triangular (BLT) transformation...");
    const bltRes: ArenaBltResult = performBltTransformationArena(
      arena,
      ctx.stateVars,
      ctx.dummyDerivatives,
      ctx.parameterVars,
    );

    ctx.bltResult = bltRes;

    let loopCount = 0;
    const blocksWithMeta = bltRes.blocks.map((b) => {
      const isLoop = b.eqIdxs.length > 1;
      if (isLoop) loopCount++;
      return {
        eqIdxs: b.eqIdxs,
        vars: b.vars,
        isAlgebraicLoop: isLoop,
      };
    });

    const graph: InspectableBipartiteGraph = {
      equationCount: arena.eqCount,
      variableCount: arena.varCount,
      blockCount: bltRes.blocks.length,
      algebraicLoopCount: loopCount,
      blocks: blocksWithMeta,
      sortedEquations: bltRes.sortedEquations,
    };

    ctx.sharedData.set("bipartiteGraph", graph);

    return {
      changed: false,
      message: `BLT decomposition complete: ${bltRes.blocks.length} blocks identified (${loopCount} algebraic loops)`,
      metrics: {
        blockCount: bltRes.blocks.length,
        algebraicLoops: loopCount,
        sortedEquations: bltRes.sortedEquations.length,
      },
    };
  }
}
