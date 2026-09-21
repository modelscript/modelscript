// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Sparse Matrix (CSR) Data Structure ---

import { sparse_matrixCode } from "../../src-gen/runtime-templates.js";

/**
 * Returns the AssemblyScript source code for Compressed Sparse Row (CSR) matrix data structures.
 */
export function generateSparseMatrix(): string {
  return sparse_matrixCode;
}
