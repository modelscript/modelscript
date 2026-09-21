// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Native DPLL(T) SMT Engine ---

import { LanguageOptions } from "../../dsl/language.js";
import { satCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for the DPLL(T) CDCL SAT solver.
 */
export function generateSAT(grammarDef: LanguageOptions, _normalized?: any): string {
  const hasEgraph =
    !!(grammarDef as any).optimization?.egraph ||
    !!(grammarDef.semantics?.reasoner as any)?.smt?.theories?.includes("EUF");
  const hasLRA = !!(grammarDef.semantics?.reasoner as any)?.smt?.theories?.includes("LRA");

  let code = satCode;
  if (hasLRA) {
    code = code.replace("export let hasLRA: boolean = false;", "export let hasLRA: boolean = true;");
  }
  if (hasEgraph) {
    code = code.replace("export let hasEgraph: boolean = false;", "export let hasEgraph: boolean = true;");
  }
  return code;
}
