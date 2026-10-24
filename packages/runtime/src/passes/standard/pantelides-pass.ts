// SPDX-License-Identifier: AGPL-3.0-or-later

import { pantelidesIndexReductionArena, type PantelidesOptions } from "../../analysis/wasm_pantelides.js";
import type { DAEBuilder } from "../../dae/wasm_dae.js";
import type { DAEPass, PassContext, PassResult } from "../pass.js";

/**
 * Compiler pass that performs Pantelides index reduction on high-index DAEs.
 */
export class PantelidesPass implements DAEPass {
  readonly name = "pantelides";
  readonly description = "Performs graph-based Pantelides index reduction to differentiate structural constraints";

  constructor(private readonly options?: PantelidesOptions) {}

  run(arena: DAEBuilder, ctx: PassContext): PassResult {
    ctx.log("Running Pantelides index reduction...");
    const res = pantelidesIndexReductionArena(
      arena,
      ctx.stateVars,
      ctx.derivativeVars,
      ctx.parameterVars,
      this.options,
    );

    ctx.dummyDerivatives = res.dummyDerivatives;
    ctx.sharedData.set("pantelidesResult", res);

    const generated = res.generatedEquations?.length ?? 0;
    const dummyCount = res.dummyDerivatives?.size ?? 0;

    return {
      changed: generated > 0 || dummyCount > 0,
      message: `Pantelides index reduction complete: ${generated} constraint equations added, ${dummyCount} dummy derivatives`,
      metrics: {
        structuralIndex: res.structuralIndex ?? 1,
        generatedEquations: generated,
        dummyDerivatives: dummyCount,
      },
    };
  }
}
