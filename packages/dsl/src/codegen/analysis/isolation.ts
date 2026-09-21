// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Zero-GC WASM Isolation Engine Generator ---

import { LanguageOptions } from "../../dsl/language.js";
import { isolation_domainCode } from "../../src-gen/runtime-templates.js";

export * from "./inversion.js";

/**
 * Generates the AssemblyScript isolation domain module containing all 8 symbolic isolation
 * algorithms, domain guards, and re-exports for non-linear iterative solvers.
 */
export function generateIsolationDomain(_grammarDef?: LanguageOptions<any>): string {
  return isolation_domainCode;
}
