// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Native LRA Simplex Tableau (Phase 3) ---

import { simplexCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for the native LRA Simplex tableau solver.
 */
export function generateSimplex(grammarDef?: any): string {
  const maxVars = grammarDef?.semantics?.reasoner?.smt?.maxSimplexVars || 200;
  if (maxVars === 200) {
    return simplexCode;
  }
  return simplexCode
    .replace("const SIMPLEX_MAX_VARS: u32 = 200;", `const SIMPLEX_MAX_VARS: u32 = ${maxVars};`)
    .replace("const SIMPLEX_MAX_ROWS: u32 = 200;", `const SIMPLEX_MAX_ROWS: u32 = ${maxVars};`)
    .replace("new Float64Array(40000);", `new Float64Array(${maxVars * maxVars});`);
}
