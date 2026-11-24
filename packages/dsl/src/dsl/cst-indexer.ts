// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Reusable generic WASM CST-first symbol indexer.
 *
 * Extracts top-level and nested declarations with exact CST byte offsets and name spans
 * from compiled `@modelscript/dsl` WASM GLR `SyntaxNode` trees using `SemanticCstTag`
 * metadata and named grammar fields (`name`, `identifier`, `id`, etc.).
 */

import type { SyntaxNode } from "../utils/cst-facade.js";
import {
  getNodeSemanticTags,
  inferDefaultTagsFromRuleName,
  SemanticCstTag,
  type SemanticTagTable,
} from "./semantic-tags.js";

/**
 * A declaration extracted from a compiled WASM CST node with exact byte offsets and name spans.
 */
export interface WasmCstIndexedSymbol {
  name: string;
  kind: string;
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

/**
 * Configuration options for `indexSymbolsFromWasmCst`.
 */
export interface WasmCstIndexerOptions {
  /** Optional explicit map from CST rule name (e.g. `"EntityDeclaration"`) to emitted symbol kind. */
  kindMap?: Record<string, string> | undefined;
  /** Optional ordered list of CST field names to inspect for the symbol's identifier (defaults to `["name", "identifier", "id"]`). */
  nameFields?: string[] | undefined;
  /** Optional precomputed `SemanticTagTable` for O(1) `kindId` lookups. */
  tagTable?: SemanticTagTable | undefined;
}

type WasmCstNodeLike = Omit<SyntaxNode, "hasError"> & {
  hasError?: boolean | (() => boolean);
};

const DEFAULT_NAME_FIELDS = ["name", "identifier", "id"] as const;

const DECLARATION_TAG_MASK =
  SemanticCstTag.Declaration |
  SemanticCstTag.Function |
  SemanticCstTag.Component |
  SemanticCstTag.Port |
  SemanticCstTag.Parameter |
  SemanticCstTag.State;

const DECL_RULE_SUFFIX_RE =
  /(?:decl|declaration|definition|def|entity|module|package|arch|architecturebody|node|model|section|record)$/i;

/**
 * Unwraps a `{ rootNode }` tree wrapper or direct `SyntaxNode`, returning `null`
 * if the node is absent, malformed, or contains parse errors (`hasError` / `isError`).
 */
export function extractValidWasmCstRoot(treeOrNode: unknown): SyntaxNode | null {
  if (!treeOrNode || typeof treeOrNode !== "object") return null;
  const candidate = ("rootNode" in treeOrNode ? (treeOrNode as { rootNode?: unknown }).rootNode : treeOrNode) as
    WasmCstNodeLike | undefined;
  if (!candidate || typeof candidate !== "object" || typeof candidate.type !== "string") {
    return null;
  }
  const hasErr = typeof candidate.hasError === "function" ? candidate.hasError() : Boolean(candidate.hasError);
  if (hasErr || candidate.isError) return null;
  return candidate as SyntaxNode;
}

function toSnakeCase(ruleName: string): string {
  return ruleName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function getCombinedSemanticTags(node: SyntaxNode, tagTable?: SemanticTagTable): number {
  const direct = getNodeSemanticTags(node, tagTable);
  const snake = toSnakeCase(node.type);
  if (snake !== node.type.toLowerCase()) {
    return direct | inferDefaultTagsFromRuleName(snake);
  }
  return direct;
}

function shouldSkipSubtree(node: SyntaxNode, tags: number): boolean {
  if (node.isError || node.isMissing || node.type === "ERROR") return true;
  if ((tags & (SemanticCstTag.Comment | SemanticCstTag.Literal)) !== 0) return true;
  const lower = node.type.toLowerCase();
  return lower.includes("comment") || lower.includes("string");
}

function extractNodeText(node: SyntaxNode, source: string): string {
  if (typeof node.text === "string" && node.text.length > 0) {
    return node.text.trim();
  }
  if (typeof node.startIndex === "number" && typeof node.endIndex === "number" && node.endIndex >= node.startIndex) {
    return source.slice(node.startIndex, node.endIndex).trim();
  }
  return "";
}

function findNameNode(
  node: SyntaxNode,
  nameFields: readonly string[],
  allowIdentifierFallback: boolean,
  tagTable?: SemanticTagTable,
): SyntaxNode | null {
  if (typeof node.childForFieldName === "function") {
    for (const fieldName of nameFields) {
      const child = node.childForFieldName(fieldName);
      if (child && !child.isError && !child.isMissing) {
        return child;
      }
    }
  }
  if (allowIdentifierFallback) {
    const kids = node.namedChildren && node.namedChildren.length > 0 ? node.namedChildren : (node.children ?? []);
    for (const child of kids) {
      if (child.isError || child.isMissing) continue;
      const childTags = getCombinedSemanticTags(child, tagTable);
      if ((childTags & SemanticCstTag.Identifier) !== 0) {
        return child;
      }
    }
  }
  return null;
}

function inferSymbolKind(ruleName: string, tags: number): string {
  if ((tags & SemanticCstTag.Function) !== 0) return "function";
  if ((tags & SemanticCstTag.Parameter) !== 0) return "parameter";
  if ((tags & SemanticCstTag.Port) !== 0) return "port";
  if ((tags & SemanticCstTag.State) !== 0) return "state";
  if ((tags & SemanticCstTag.Component) !== 0) return "variable";

  const lower = ruleName.toLowerCase();
  if (lower.includes("package")) return "package";
  if (lower.includes("const")) return "constant";
  if (lower.includes("type")) return "type";
  if (lower.includes("param")) return "parameter";
  if (lower.includes("func") || lower.includes("method") || lower.includes("macro") || lower.includes("proc")) {
    return "function";
  }
  if (
    lower.includes("var") ||
    lower.includes("signal") ||
    lower.includes("net") ||
    lower.includes("port") ||
    lower.includes("field")
  ) {
    return "variable";
  }
  return "class";
}

/**
 * Walks a valid WASM GLR `SyntaxNode` tree using `SemanticCstTag` metadata and
 * `childForFieldName("name" | "identifier" | "id")` to extract top-level and nested
 * declarations with exact CST byte offsets and name spans (skipping comments, strings, and errors).
 */
export function indexSymbolsFromWasmCst(
  rootNode: SyntaxNode,
  text: string,
  options?: WasmCstIndexerOptions,
): WasmCstIndexedSymbol[] {
  const symbols: WasmCstIndexedSymbol[] = [];
  const kindMap = options?.kindMap;
  const nameFields = options?.nameFields && options.nameFields.length > 0 ? options.nameFields : DEFAULT_NAME_FIELDS;
  const tagTable = options?.tagTable;

  const stack: SyntaxNode[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const tags = getCombinedSemanticTags(node, tagTable);
    if (shouldSkipSubtree(node, tags)) continue;

    const explicitKind = kindMap?.[node.type];
    const isTaggedDecl = (tags & DECLARATION_TAG_MASK) !== 0 && (tags & SemanticCstTag.Root) === 0;
    const isNamedDeclRule =
      (tags & (SemanticCstTag.Root | SemanticCstTag.Identifier | SemanticCstTag.Expression | SemanticCstTag.Call)) ===
        0 &&
      DECL_RULE_SUFFIX_RE.test(node.type) &&
      !node.type.toLowerCase().includes("default");

    if (explicitKind !== undefined || isTaggedDecl || isNamedDeclRule) {
      const nameNode = findNameNode(node, nameFields, explicitKind !== undefined || isTaggedDecl, tagTable);
      if (nameNode) {
        const name = extractNodeText(nameNode, text);
        if (name.length > 0) {
          const startOffset = typeof node.startIndex === "number" ? node.startIndex : 0;
          const endOffset = typeof node.endIndex === "number" ? node.endIndex : startOffset;
          const nameStartOffset = typeof nameNode.startIndex === "number" ? nameNode.startIndex : startOffset;
          const nameEndOffset =
            typeof nameNode.endIndex === "number" ? nameNode.endIndex : nameStartOffset + name.length;
          symbols.push({
            name,
            kind: explicitKind ?? inferSymbolKind(node.type, tags),
            startOffset,
            endOffset,
            nameStartOffset,
            nameEndOffset,
          });
        }
      }
    }

    const kids = node.namedChildren && node.namedChildren.length > 0 ? node.namedChildren : (node.children ?? []);
    for (let i = kids.length - 1; i >= 0; i--) {
      const child = kids[i];
      if (child) stack.push(child);
    }
  }

  return symbols;
}
