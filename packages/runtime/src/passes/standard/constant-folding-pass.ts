// SPDX-License-Identifier: AGPL-3.0-or-later

import { saturateArenaEquations } from "../../analysis/wasm_egraph_simplifier.js";
import type { DAEBuilder } from "../../dae/wasm_dae.js";
import { foldArenaConstants } from "../../dae/wasm_fold.js";
import type { DAEPass, PassContext, PassResult } from "../pass.js";

/**
 * Compiler pass that performs algebraic constant folding and expression canonicalization.
 */
export class ConstantFoldingPass implements DAEPass {
  readonly name = "constant-folding";
  readonly description = "Folds constant expressions and simplifies algebraic identities in equations";

  run(arena: DAEBuilder, ctx: PassContext): PassResult {
    ctx.log("Running constant folding & equality simplification...");
    const foldCount = foldArenaConstants(arena);
    const satStats = saturateArenaEquations(arena);

    const changed = foldCount > 0 || (satStats?.equationsSimplified ?? 0) > 0;
    return {
      changed,
      message: `Simplified ${satStats?.equationsSimplified ?? 0} equations, folded ${foldCount} constants`,
      metrics: {
        constantsFolded: foldCount,
        equationsSimplified: satStats?.equationsSimplified ?? 0,
      },
    };
  }
}
