// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Steensgaard Points-To Alias Analysis ---

import { alias_domainCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for Steensgaard points-to alias analysis.
 */
export function generateAliasAnalysis(): string {
  return alias_domainCode;
}
