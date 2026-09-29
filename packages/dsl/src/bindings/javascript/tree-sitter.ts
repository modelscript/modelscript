// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical Tree-sitter API compatibility facade for ModelScript.
 * Re-exports the unified Tree-sitter AST and cursor implementations.
 */

export { SyntaxNode, Tree, TreeCursor, TreeSitterParser } from "./bindings.js";
export type { Point } from "./bindings.js";
