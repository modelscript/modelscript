// SPDX-License-Identifier: AGPL-3.0-or-later
// --- WASM-Native Non-Linear Newton-Raphson Algebraic Solver ---

import { LanguageOptions } from "../../dsl/language.js";
import { newtonCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for Newton-Raphson algebraic loop solving.
 */
export function generateNewtonSolver(_grammarDef?: LanguageOptions): string {
  return newtonCode;
}
