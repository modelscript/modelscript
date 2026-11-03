// SPDX-License-Identifier: AGPL-3.0-or-later

import rawCatalog from "./stdlibs.catalog.json" with { type: "json" };
import type { StdlibCatalog, StdlibEntry, StdlibPackId, StdlibTier } from "./types.js";

export * from "./types.js";

const catalogJson: StdlibCatalog = rawCatalog as StdlibCatalog;

/**
 * Returns the full polyglot standard library catalog.
 */
export function getStdlibCatalog(): StdlibCatalog {
  return catalogJson;
}

/**
 * Finds a standard library entry by unique ID.
 */
export function getStdlibById(id: string): StdlibEntry | undefined {
  return catalogJson.libraries.find((lib) => lib.id === id);
}

/**
 * Finds all standard libraries registered for a given language ID.
 */
export function getStdlibsForLanguage(language: string): StdlibEntry[] {
  const norm = language.toLowerCase().trim();
  return catalogJson.libraries.filter((lib) => lib.language.toLowerCase() === norm);
}

/**
 * Finds all standard libraries belonging to a specific domain pack.
 */
export function getStdlibsByPack(pack: StdlibPackId | "all"): StdlibEntry[] {
  if (pack === "all") {
    return catalogJson.libraries;
  }
  return catalogJson.libraries.filter((lib) => lib.pack === pack);
}

/**
 * Finds all standard libraries belonging to a specific tier.
 */
export function getStdlibsByTier(tier: StdlibTier): StdlibEntry[] {
  return catalogJson.libraries.filter((lib) => lib.tier === tier);
}
