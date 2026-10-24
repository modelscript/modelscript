// SPDX-License-Identifier: AGPL-3.0-or-later

import { eliminateVectorArenaAliases } from "../../analysis/wasm_sbg.js";
import type { DAEBuilder } from "../../dae/wasm_dae.js";
import type { DAEPass, PassContext, PassResult } from "../pass.js";

/**
 * Compiler pass that eliminates trivial aliases (e.g. `a = b`) across variables.
 */
export class AliasEliminationPass implements DAEPass {
  readonly name = "alias-elimination";
  readonly description = "Eliminates algebraic and connector aliases across variables in the DAE arena";

  run(arena: DAEBuilder, ctx: PassContext): PassResult {
    ctx.log("Running alias elimination...");
    const entries = eliminateVectorArenaAliases(arena);
    const count = entries?.length ?? 0;
    return {
      changed: count > 0,
      message: `Eliminated ${count} alias relationships`,
      metrics: { aliasesEliminated: count },
    };
  }
}
