// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Native DPLL(T) SMT Engine ---

import { LanguageOptions } from "../../dsl/language.js";
import { satCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for the DPLL(T) CDCL SAT solver.
 */
export function generateSAT(grammarDef: LanguageOptions, _normalized?: unknown): string {
  const smtTheories = (grammarDef.semantics?.reasoner as { smt?: { theories?: string[] } } | undefined)?.smt?.theories;
  const hasEgraph =
    !!(grammarDef as LanguageOptions & { optimization?: { egraph?: unknown } }).optimization?.egraph ||
    !!smtTheories?.includes("EUF");
  const hasLRA = !!smtTheories?.includes("LRA");

  let code = satCode;
  if (hasLRA) {
    code = code.replace("export let hasLRA: boolean = false;", "export let hasLRA: boolean = true;");
  }
  if (hasEgraph) {
    code = code.replace("export let hasEgraph: boolean = false;", "export let hasEgraph: boolean = true;");
  }
  return code;
}
