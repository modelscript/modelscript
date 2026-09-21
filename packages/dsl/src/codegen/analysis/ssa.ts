// SPDX-License-Identifier: AGPL-3.0-or-later
// --- SSA Form & Dominator Tree Construction ---
// Re-exports the AssemblyScript zero-GC linear memory SSA implementation.

import { ssaCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for SSA form, dominator tree (Cooper-Harvey-Kennedy),
 * dominance frontiers, and minimal phi-node placement in zero-GC linear memory.
 */
export function generateSSA(): string {
  return ssaCode;
}
