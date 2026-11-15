// SPDX-License-Identifier: AGPL-3.0-or-later
// --- AD Jacobian & Hessian Sparsity Extraction (Phase 4) ---

import { LanguageOptions } from "../../dsl/language.js";
import { ad_jacobianCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for Jacobian and Hessian sparsity extraction.
 */
export function generateAdJacobian(grammarDef: LanguageOptions, _normalized?: unknown): string {
  if (!(grammarDef as LanguageOptions & { acausal?: boolean }).acausal && grammarDef.name !== "Calc") return "";
  return ad_jacobianCode;
}
