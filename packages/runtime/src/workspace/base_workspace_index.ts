// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Base implementation of a multi-file workspace symbol indexer for polyglot languages.
 * Provides unified document lifecycle management, incremental slot-based symbol ID allocation,
 * and standard Map-based SymbolIndex storage.
 */

import type { SymbolEntry, SymbolId, SymbolIndex } from "../runtime.js";
import type { IWorkspaceIndex } from "./wasm_workspace.js";

export type WorkspaceDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

export interface SymbolIndexBuilderContext {
  symbols: Map<SymbolId, SymbolEntry>;
  byName: Map<string, SymbolId[]>;
  childrenOf: Map<SymbolId | null, SymbolId[]>;
  baseId: number;
  addSymbol: (
    name: string,
    kind: string,
    parentId?: SymbolId | null,
    startOffset?: number,
    endOffset?: number,
    metadata?: Record<string, unknown>,
  ) => SymbolId;
}

export abstract class BaseWorkspaceIndex<TDeck = unknown> implements IWorkspaceIndex {
  protected _version = 1;
  protected fileIndices = new Map<string, SymbolIndex>();
  protected fileDecks = new Map<string, TDeck>();
  protected fileBaseIds = new Map<string, number>();
  protected nextFileSlot = 1;

  public abstract readonly languageName: string;

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
    return this._version;
  }

  get fileCount(): number {
    return this.fileIndices.size;
  }

  public has(uri: string): boolean {
    return this.fileIndices.has(uri);
  }

  public getFileIndex(uri: string): SymbolIndex | undefined {
    return this.fileIndices.get(uri);
  }

  public getDeck(uri: string): TDeck | undefined {
    return this.fileDecks.get(uri);
  }

  public getModel(uri: string): TDeck | undefined {
    return this.fileDecks.get(uri);
  }

  public getDocument(uri: string): TDeck | undefined {
    return this.fileDecks.get(uri);
  }

  public setDeck(uri: string, deck: TDeck): void {
    this.fileDecks.set(uri, deck);
  }

  public register(uri: string, _loader?: WorkspaceDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public removeFile(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileDecks.delete(uri);
    this.fileBaseIds.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDecks.clear();
    this.fileBaseIds.clear();
  }

  public reindexDocument(uri: string, loader?: WorkspaceDocumentLoader): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // Ignore loader errors during incremental re-indexing
      }
    }
  }

  /**
   * Creates a fresh SymbolIndexBuilderContext for indexing a document with unique ID offsets.
   */
  protected createIndexContext(uri: string): SymbolIndexBuilderContext {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }

    const language = this.languageName;
    let localId = 1;

    const addSymbol = (
      name: string,
      kind: string,
      parentId: SymbolId | null = null,
      startOffset = 0,
      endOffset = 0,
      metadata: Record<string, unknown> = {},
    ): SymbolId => {
      const symId = ((baseId ?? 0) + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: `${language}_${kind}`,
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language,
        resourceId: uri,
        metadata,
      };

      symbols.set(symId, entry);

      const existingByName = byName.get(name) ?? [];
      existingByName.push(symId);
      byName.set(name, existingByName);

      const existingChildren = childrenOf.get(parentId) ?? [];
      existingChildren.push(symId);
      childrenOf.set(parentId, existingChildren);

      return symId;
    };

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);

    return { symbols, byName, childrenOf, baseId, addSymbol };
  }

  public getSymbolsByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name) ?? [];
      for (const id of ids) {
        const sym = idx.symbols.get(id);
        if (sym) results.push(sym);
      }
    }
    return results;
  }

  public toSymbolIndex(): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    for (const idx of this.fileIndices.values()) {
      for (const [id, entry] of idx.symbols) {
        symbols.set(id, entry);
      }
      for (const [name, ids] of idx.byName) {
        const existing = byName.get(name) ?? [];
        byName.set(name, existing.concat(ids));
      }
      for (const [parentId, ids] of idx.childrenOf) {
        const existing = childrenOf.get(parentId) ?? [];
        childrenOf.set(parentId, existing.concat(ids));
      }
    }

    return { symbols, byName, childrenOf };
  }

  public toUnified(): SymbolIndex {
    return this.toSymbolIndex();
  }

  public abstract indexFile(uri: string, text: string): SymbolIndex;
}
