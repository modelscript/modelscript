// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Compiler and static analysis tooling utilities for `@modelscript/dsl` grammars,
 * including semantic hook extraction, i18n message catalog extraction, structural
 * AST diffing and three-way merging, and dependency topology analysis.
 */

/** Extracts semantic query, lint, and lifecycle hooks from compiled DSL definitions. */
export * from "./hook-extractor.js";
/** Extracts localizable diagnostic and UI string keys for internationalization (i18n). */
export * from "./i18n-extractor.js";
/** Computes identity-aware structural and semantic diffs between two CST/symbol trees. */
export * from "./semantic-diff.js";
/** Performs three-way semantic merging of CST/symbol trees with conflict detection. */
export * from "./semantic-merge.js";
/** Analyzes symbol dependency graphs, strongly connected components, and topological ordering. */
export * from "./topology.js";
