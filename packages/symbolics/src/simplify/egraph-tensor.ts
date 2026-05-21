// SPDX-License-Identifier: AGPL-3.0-or-later

import { EGraph, TENSOR_RULES } from "@modelscript/compiler";

export { emitFusedKernelC, identifyFusableChains, TensorFlopCost as tensorNodeCost } from "@modelscript/compiler";
export type { FusedKernel } from "@modelscript/compiler";

/**
 * High-level API: simplify a tensor expression using equality saturation
 * with tensor-specific rewrite rules.
 */
export function tensorEgraphSimplify(egraph: EGraph, rootId: number, maxIterations = 20): number {
  egraph.saturate(TENSOR_RULES, maxIterations);
  return egraph.find(rootId);
}
