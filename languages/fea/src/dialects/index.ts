// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FeaDialect } from "../types.js";
import { BdfDialect } from "./bdf.js";
import { InpDialect } from "./inp.js";

const dialects = new Map<string, FeaDialect>();
const extensionMap = new Map<string, FeaDialect>();

export function registerFeaDialect(dialect: FeaDialect): void {
  dialects.set(dialect.id.toLowerCase(), dialect);
  for (const ext of dialect.extensions) {
    extensionMap.set(ext.toLowerCase(), dialect);
  }
}

// Register built-in dialects
const defaultInp = new InpDialect();
const defaultBdf = new BdfDialect();
registerFeaDialect(defaultInp);
registerFeaDialect(defaultBdf);

export function getFeaDialect(idOrExt: string): FeaDialect {
  const norm = idOrExt.toLowerCase();
  if (dialects.has(norm)) {
    return dialects.get(norm)!;
  }
  const ext = norm.startsWith(".") ? norm : `.${norm}`;
  if (extensionMap.has(ext)) {
    return extensionMap.get(ext)!;
  }
  // Default to INP dialect
  return defaultInp;
}

export * from "./bdf.js";
export * from "./inp.js";
