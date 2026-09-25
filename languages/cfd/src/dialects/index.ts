// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CfdDialect } from "../types.js";
import { OpenFoamDialect } from "./openfoam.js";
import { Su2Dialect } from "./su2.js";

const dialects = new Map<string, CfdDialect>();
const extensionMap = new Map<string, CfdDialect>();

export function registerCfdDialect(dialect: CfdDialect): void {
  dialects.set(dialect.id.toLowerCase(), dialect);
  for (const ext of dialect.extensions) {
    extensionMap.set(ext.toLowerCase(), dialect);
  }
}

// Register built-in dialects
const defaultSu2 = new Su2Dialect();
const defaultOpenFoam = new OpenFoamDialect();
registerCfdDialect(defaultSu2);
registerCfdDialect(defaultOpenFoam);

export function getCfdDialect(idOrExt: string): CfdDialect {
  const norm = idOrExt.toLowerCase();
  if (dialects.has(norm)) {
    return dialects.get(norm)!;
  }
  const ext = norm.startsWith(".") ? norm : `.${norm}`;
  if (extensionMap.has(ext)) {
    return extensionMap.get(ext)!;
  }
  // Default to SU2 dialect
  return defaultSu2;
}

export * from "./openfoam.js";
export * from "./su2.js";
