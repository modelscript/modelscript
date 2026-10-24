// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "../../dae/wasm_dae.js";
import { ArenaEGraphRewriter, type RewriteRuleDefinition } from "../../rewriting/arena-egraph.js";
import type { DAEPass, PassContext, PassResult } from "../pass.js";

/**
 * Compiler pass that applies equality saturation and user-defined rewrite rules to the arena.
 */
export class EGraphSimplificationPass implements DAEPass {
  readonly name = "egraph-simplification";
  readonly description = "Applies rule-based term rewriting and equality saturation to arena equations";

  constructor(private readonly userRules?: RewriteRuleDefinition[]) {}

  run(arena: DAEBuilder, ctx: PassContext): PassResult {
    ctx.log("Running E-Graph equality saturation pass...");
    const rewriter = new ArenaEGraphRewriter(arena);
    rewriter.addStandardAlgebraicRules();
    if (this.userRules && this.userRules.length > 0) {
      rewriter.addRules(this.userRules);
    }

    const { modified } = rewriter.rewriteAllEquations();
    return {
      changed: modified > 0,
      message: `E-Graph simplification modified ${modified} equations`,
      metrics: {
        equationsModified: modified,
      },
    };
  }
}
