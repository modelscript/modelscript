// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "../../dae/wasm_dae.js";
import { hasArrayEquations, scalarizeArena } from "../../dae/wasm_fold.js";
import type { DAEPass, PassContext, PassResult } from "../pass.js";

/**
 * Compiler pass that expands array equations and vector variables into scalar form.
 */
export class ScalarizePass implements DAEPass {
  readonly name = "scalarize";
  readonly description = "Expands array equations and multidimensional variables into scalar form";

  run(arena: DAEBuilder, ctx: PassContext): PassResult {
    let hasPreservedArrays = hasArrayEquations(arena);
    if (!hasPreservedArrays) {
      for (let i = 0; i < arena.varCount; i++) {
        if (!arena.isVarRemoved(i) && (arena as any).getVarShape?.(i)?.length > 0) {
          hasPreservedArrays = true;
          break;
        }
      }
    }

    if (!hasPreservedArrays) {
      return { changed: false, message: "No array equations or variables detected" };
    }

    ctx.log("Scalarizing array equations and multidimensional variables...");
    scalarizeArena(arena, true);

    return {
      changed: true,
      message: "Successfully scalarized multidimensional equations and variables",
    };
  }
}
