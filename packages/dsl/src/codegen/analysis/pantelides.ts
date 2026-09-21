// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Zero-GC WASM Pantelides Index Reduction Generator ---

import { LanguageOptions } from "../../dsl/language.js";
import { pantelides_domainCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript wrapper routines for DAE structural singularity index reduction.
 */
export function generatePantelidesDomain(_grammarDef?: LanguageOptions<any>): string {
  return pantelides_domainCode;
}
