// SPDX-License-Identifier: AGPL-3.0-or-later

import rawBenchmarkCatalog from "./benchmarks.catalog.json" with { type: "json" };
import rawCatalog from "./stdlibs.catalog.json" with { type: "json" };
import type {
  BenchmarkCatalog,
  BenchmarkEntry,
  BenchmarkTier,
} from "./benchmark-types.js";
import type { StdlibCatalog, StdlibDomain, StdlibEntry, StdlibPackId, StdlibTier } from "./types.js";

export * from "./benchmark-types.js";
export * from "./types.js";

const catalogJson: StdlibCatalog = rawCatalog as StdlibCatalog;
const benchmarkCatalogJson: BenchmarkCatalog = rawBenchmarkCatalog as BenchmarkCatalog;

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
export function getStdlibsByPack(pack: StdlibPackId | "all" | string): StdlibEntry[] {
  if (pack === "all") {
    return catalogJson.libraries;
  }
  const norm = pack.toLowerCase().trim();
  if (norm === "modelica" || norm === "msl") {
    return catalogJson.libraries.filter(
      (lib) => lib.language.toLowerCase() === "modelica" || lib.packageName.toLowerCase() === "modelica",
    );
  }
  return catalogJson.libraries.filter((lib) => lib.pack === pack);
}

/**
 * Finds all standard libraries belonging to a specific tier.
 */
export function getStdlibsByTier(tier: StdlibTier): StdlibEntry[] {
  return catalogJson.libraries.filter((lib) => lib.tier === tier);
}

/**
 * Returns the full polyglot benchmark catalog.
 */
export function getBenchmarkCatalog(): BenchmarkCatalog {
  return benchmarkCatalogJson;
}

/**
 * Finds a benchmark entry by unique ID.
 */
export function getBenchmarkById(id: string): BenchmarkEntry | undefined {
  return benchmarkCatalogJson.benchmarks.find((b) => b.id === id);
}

/**
 * Finds all benchmarks registered for a given language ID.
 */
export function getBenchmarksForLanguage(language: string): BenchmarkEntry[] {
  const norm = language.toLowerCase().trim();
  return benchmarkCatalogJson.benchmarks.filter((b) => b.language.toLowerCase() === norm);
}

/**
 * Finds all benchmarks targeting a specific maturity transition tier.
 */
export function getBenchmarksByTier(tier: BenchmarkTier): BenchmarkEntry[] {
  return benchmarkCatalogJson.benchmarks.filter((b) => b.tier === tier);
}

/**
 * Finds all benchmarks in a specific domain.
 */
export function getBenchmarksByDomain(domain: StdlibDomain): BenchmarkEntry[] {
  return benchmarkCatalogJson.benchmarks.filter((b) => b.domain === domain);
}
