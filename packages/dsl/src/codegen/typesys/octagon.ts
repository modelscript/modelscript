// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Native Octagon Abstract Domain Generator ---

import { octagonCode } from "../../src-gen/runtime-templates.js";

/**
 * Generates zero-GC WASM AssemblyScript Difference Bound Matrix (DBM) routines.
 */
export function generateOctagonDomain(): string {
  return octagonCode;
}
