// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import type { QueryEngine } from "@modelscript/runtime/wasm_query_engine.js";
import type { BridgeContext } from "./bridge/bridge-context.js";
import { computeCompletion } from "./bridge/completion.js";
import { computeDocumentSymbols } from "./bridge/document-symbols.js";
import { computeHover } from "./bridge/hover.js";
import {
  computeCounterpartDefinitionsRaw,
  computeDefinition,
  computeDefinitionRaw,
  computeFindReferencesRaw,
  computeReferences,
  computeTypeDefinitionRaw,
} from "./bridge/navigation.js";
import { PositionIndex, resolvePositionIndexArg } from "./bridge/position-index.js";
import {
  type LSPCompletionItem,
  type LSPDocumentSymbol,
  type LSPHover,
  type LSPLocation,
  type LSPRange,
  LSPSymbolKind,
} from "./bridge/types.js";

export {
  LSPSymbolKind,
  PositionIndex,
  type LSPCompletionItem,
  type LSPDocumentSymbol,
  type LSPHover,
  type LSPLocation,
  type LSPRange,
};

// ---------------------------------------------------------------------------
// LSP Bridge — Maps metascript internals to LSP protocol responses
// ---------------------------------------------------------------------------

/**
 * Environment dependencies for cross-document and VFS resolution inside `LSPBridge`.
 */
export interface LSPBridgeEnv {
  documentLSPBridges?: Map<string, LSPBridge>;
  documents?: { get(uri: string): { getText(): string } | undefined };
  sharedFs?: {
    readFile?(uri: string): string | undefined;
    read?(path: string): string | undefined;
  };
}

/**
 * Maps the metascript runtime (`SymbolIndex`, `QueryEngine`, `ScopeResolver`)
 * to LSP protocol responses.
 *
 * This class translates between the internal representation
 * and the JSON-RPC protocol used by LSP clients.
 */
export class LSPBridge {
  /** Canonical URI of the bound document. */
  private documentUri: string;
  /** Injected environment dependencies for cross-document and VFS resolution. */
  private env?: LSPBridgeEnv | undefined;
  /** Shared live context passed to decomposed bridge feature modules. */
  private readonly ctx: BridgeContext;

  /**
   * Creates a new `LSPBridge` for a document.
   * Supports both 4-argument `(index, engine, positions, documentUri)` and legacy
   * 5-argument `(index, engine, resolver, positions, documentUri)` signatures,
   * as well as 5-argument `(index, engine, positions, documentUri, env)`.
   */
  constructor(
    private index: SymbolIndex,
    private engine: QueryEngine,
    arg3?: unknown,
    arg4?: unknown,
    arg5?: unknown,
    arg6?: unknown,
  ) {
    let positions: PositionIndex;
    if (typeof arg4 === "string") {
      // (index, engine, positions, documentUri, env?)
      positions = resolvePositionIndexArg(arg3);
      this.documentUri = arg4;
      this.env =
        typeof arg5 === "object" && arg5 !== null && !("lineStarts" in arg5) ? (arg5 as LSPBridgeEnv) : undefined;
    } else if (typeof arg5 === "string") {
      // Legacy: (index, engine, resolver, positions, documentUri, env?)
      positions = resolvePositionIndexArg(arg4);
      this.documentUri = arg5;
      this.env = typeof arg6 === "object" && arg6 !== null ? (arg6 as LSPBridgeEnv) : undefined;
    } else {
      positions = resolvePositionIndexArg(arg3);
      this.documentUri = typeof arg4 === "string" ? arg4 : "";
      this.env = typeof arg5 === "object" && arg5 !== null ? (arg5 as LSPBridgeEnv) : undefined;
    }

    this.ctx = {
      index: this.index,
      engine: this.engine,
      positions,
      documentUri: this.documentUri,
      env: this.env,
      activeResolveKeys: new Set<string>(),
      resolveDepth: 0,
      activeImportIds: new Set<SymbolId>(),
      activeInheritedIds: new Set<SymbolId>(),
      activeTypeOfIds: new Set<SymbolId>(),
      activeFormatIds: new Set<SymbolId>(),
      activeHoverIds: new Set<SymbolId>(),
    };
  }

  /** Line/character position converter for the bound document. */
  public get positions(): PositionIndex {
    return this.ctx.positions;
  }

  public set positions(value: PositionIndex) {
    this.ctx.positions = value;
  }

  /** Injects or overrides the environment dependencies for this bridge. */
  public setEnv(env: LSPBridgeEnv): void {
    this.env = env;
    this.ctx.env = env;
  }

  /** Returns the injected environment dependencies, if configured. */
  public getEnv(): LSPBridgeEnv | undefined {
    return this.env;
  }

  /** Returns the underlying Salsa `QueryEngine` instance. */
  public getQueryEngine(): QueryEngine {
    return this.engine;
  }

  /** Returns the underlying `SymbolIndex` instance. */
  public getIndex(): SymbolIndex {
    return this.index;
  }

  /** Returns the URI of the document bound to this bridge. */
  public getDocumentUri(): string {
    return this.documentUri;
  }

  // =========================================================================
  // textDocument/documentSymbol
  // =========================================================================

  /**
   * Builds the hierarchical `LSPDocumentSymbol` outline tree for the bound document.
   */
  documentSymbols(): LSPDocumentSymbol[] {
    return computeDocumentSymbols(this.ctx);
  }

  // =========================================================================
  // textDocument/definition
  // =========================================================================

  /**
   * Resolves the declaration location (`LSPLocation`) for the symbol at `byteOffset`.
   */
  definition(byteOffset: number, sourceText?: string): LSPLocation | null {
    return computeDefinition(this.ctx, byteOffset, sourceText);
  }

  /** Returns the raw resolved symbol entry, preserving cross-document resourceIds. */
  definitionRaw(byteOffset: number, sourceText?: string): SymbolEntry | null {
    return computeDefinitionRaw(this.ctx, byteOffset, sourceText);
  }

  // =========================================================================
  // textDocument/completion
  // =========================================================================

  /**
   * Computes context-sensitive completion candidates (`LSPCompletionItem[]`) at `byteOffset`,
   * supporting dot-access member completion, modification-argument completion, and lexical scope completion.
   */
  completion(byteOffset: number, sourceText?: string): LSPCompletionItem[] {
    return computeCompletion(this.ctx, byteOffset, sourceText);
  }

  // =========================================================================
  // textDocument/hover
  // =========================================================================

  /**
   * Computes Markdown hover documentation (`LSPHover`) for the symbol at `byteOffset`,
   * supporting modification-context attribute hover, qualified paths, class/component declarations,
   * doc comments, and predefined types.
   */
  hover(byteOffset: number, sourceText?: string): LSPHover | null {
    return computeHover(this.ctx, byteOffset, sourceText);
  }

  // =========================================================================
  // textDocument/typeDefinition
  // =========================================================================

  /** Returns the raw symbol entry for the type of the element at the offset, preserving cross-document resourceIds. */
  typeDefinitionRaw(byteOffset: number, sourceText?: string): SymbolEntry | null {
    return computeTypeDefinitionRaw(this.ctx, byteOffset, sourceText);
  }

  // =========================================================================
  // textDocument/references & textDocument/rename (Workspace-wide access)
  // =========================================================================

  /** Returns cross-language counterpart declarations aligned via TGG correspondence for the symbol at `byteOffset`. */
  counterpartDefinitionsRaw(byteOffset: number): SymbolEntry[] {
    return computeCounterpartDefinitionsRaw(this.ctx, byteOffset);
  }

  /** Returns raw symbol entries for references, preserving cross-document and cross-language resourceIds. */
  findReferencesRaw(byteOffset: number): { declaration: SymbolEntry | null; references: SymbolEntry[] } {
    return computeFindReferencesRaw(this.ctx, byteOffset);
  }

  /**
   * Returns `LSPLocation[]` for all references within the bound document to the symbol at `byteOffset`.
   */
  references(byteOffset: number): LSPLocation[] {
    return computeReferences(this.ctx, byteOffset);
  }

  // =========================================================================
  // State synchronization
  // =========================================================================

  /**
   * Update all internal references after an incremental update.
   */
  updateState(index: SymbolIndex, positions: PositionIndex): void {
    this.index = index;
    this.ctx.index = index;
    this.ctx.positions = positions;
  }
}
