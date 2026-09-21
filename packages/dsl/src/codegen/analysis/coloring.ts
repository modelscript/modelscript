// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Distance-2 Graph Coloring (Curtis-Powell-Reid 1974) ---

import { analysisColoringCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for Curtis-Powell-Reid distance-2 graph coloring.
 */
export function generateJacobianColoring(): string {
  return analysisColoringCode;
}
