// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEPassManager } from "./pass-manager.js";
import { AliasEliminationPass, BltPass, ConstantFoldingPass, PantelidesPass, ScalarizePass } from "./standard/index.js";

export * from "./pass-manager.js";
export * from "./pass.js";
export * from "./standard/index.js";

/**
 * Creates a standard pre-simulation compilation and structural analysis pipeline.
 */
export function createDefaultSimulationPipeline(): DAEPassManager {
  return new DAEPassManager()
    .addPass(new ScalarizePass())
    .addPass(new ConstantFoldingPass())
    .addPass(new AliasEliminationPass())
    .addPass(new PantelidesPass())
    .addPass(new BltPass());
}
