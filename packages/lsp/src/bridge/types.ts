// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "@modelscript/dsl";

/** LSP SymbolKind enum (subset). */
export const enum LSPSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

/** Zero-based start and end line/character range in an LSP text document. */
export interface LSPRange {
  /** Zero-based start line and UTF-16 character offset. */
  start: { line: number; character: number };
  /** Zero-based end line and UTF-16 character offset. */
  end: { line: number; character: number };
}

/** URI and range identifying a specific span in a workspace document. */
export interface LSPLocation {
  /** Target document URI. */
  uri: string;
  /** Span within the target document. */
  range: LSPRange;
}

/** Hierarchical document symbol node for the Outline tree and breadcrumbs. */
export interface LSPDocumentSymbol {
  /** Display name of the symbol. */
  name: string;
  /** LSP symbol kind classification. */
  kind: LSPSymbolKind;
  /** Full enclosing range of the declaration. */
  range: LSPRange;
  /** Narrow identifier range highlighted when selecting the symbol. */
  selectionRange: LSPRange;
  /** Optional nested child symbols declared inside this symbol's scope. */
  children?: LSPDocumentSymbol[] | undefined;
}

/** Completion candidate item returned for `textDocument/completion`. */
export interface LSPCompletionItem {
  /** Identifier text inserted or displayed on completion. */
  label: string;
  /** LSP symbol classification icon. */
  kind: LSPSymbolKind;
  /** Optional short type or category detail string. */
  detail?: string | undefined;
}

/** Markdown hover card payload and optional highlighted token range. */
export interface LSPHover {
  /** Markdown-formatted hover documentation. */
  contents: string;
  /** Optional document range of the hovered symbol. */
  range?: LSPRange | undefined;
}

/** Minimal structural shape of another document's LSPBridge for cross-document lookups. */
export interface BridgePeerLike {
  positions?:
    | {
        getSourceText(): string;
        rangeFromOffsets(startOffset: number, endOffset: number): LSPRange;
      }
    | undefined;
}

/** Structural environment interface used internally by bridge submodules (avoids cycle with `LSPBridge`). */
export interface BridgeEnvLike {
  documentLSPBridges?: { get(uri: string): BridgePeerLike | undefined } | undefined;
  documents?: { get(uri: string): { getText?(): string; tree?: { rootNode?: SyntaxNode } } | undefined } | undefined;
  sharedFs?:
    | {
        readFile?(uri: string): string | undefined;
        read?(path: string): string | undefined;
      }
    | undefined;
}

/** Map a user-defined symbol kind string to an LSP SymbolKind number. */
export function mapSymbolKind(kind: string): LSPSymbolKind {
  const mapping: Record<string, LSPSymbolKind> = {
    Class: LSPSymbolKind.Class,
    Function: LSPSymbolKind.Function,
    Variable: LSPSymbolKind.Variable,
    Package: LSPSymbolKind.Package,
    Module: LSPSymbolKind.Module,
    Interface: LSPSymbolKind.Interface,
    Enum: LSPSymbolKind.Enum,
    Struct: LSPSymbolKind.Struct,
    Property: LSPSymbolKind.Property,
    Field: LSPSymbolKind.Field,
    Constant: LSPSymbolKind.Constant,
    Method: LSPSymbolKind.Method,
    Constructor: LSPSymbolKind.Constructor,
    Namespace: LSPSymbolKind.Namespace,
    Type: LSPSymbolKind.Interface,
  };
  return mapping[kind] ?? LSPSymbolKind.Variable;
}
