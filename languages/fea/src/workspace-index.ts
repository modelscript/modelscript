// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseFeaDeck } from "./dialects/index.js";
import type { FeaModelData } from "./types.js";

export interface FeaSourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type FeaDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Workspace indexer for Finite Element Analysis decks (Abaqus/CalculiX .inp, Nastran .bdf).
 */
export class FeaWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, FeaModelData>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

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

  public getDeck(uri: string): FeaModelData | undefined {
    return this.fileDecks.get(uri);
  }

  public register(uri: string, _loader?: FeaDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: FeaDocumentLoader): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch (err) {
        console.error(`[FeaWorkspaceIndex] Failed to reindex ${uri}:`, err);
      }
    }
  }

  public findDefinition(name: string, currentUri?: string): { uri: string; symbol: SymbolEntry }[] {
    const results: { uri: string; symbol: SymbolEntry }[] = [];
    const searchOrder: string[] = [];

    if (currentUri && this.fileIndices.has(currentUri)) {
      searchOrder.push(currentUri);
    }
    for (const uri of this.fileIndices.keys()) {
      if (uri !== currentUri) {
        searchOrder.push(uri);
      }
    }

    for (const uri of searchOrder) {
      const idx = this.fileIndices.get(uri);
      if (!idx) continue;
      const ids = idx.byName.get(name) ?? [];
      for (const id of ids) {
        const sym = idx.symbols.get(id);
        if (sym) {
          results.push({ uri, symbol: sym });
        }
      }
    }

    return results;
  }

  public findReferences(name: string, _currentUri?: string): { uri: string; range: FeaSourceSpan }[] {
    const results: { uri: string; range: FeaSourceSpan }[] = [];
    for (const [uri, deck] of this.fileDecks.entries()) {
      if (deck.materials.has(name) || deck.nodeSets.has(name) || deck.elementSets.has(name)) {
        results.push({
          uri,
          range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        });
      }
    }
    return results;
  }

  public getCompletions(prefix: string, uri?: string): string[] {
    const norm = prefix.toLowerCase();
    const suggestions = new Set<string>();

    const searchUris = uri && this.fileIndices.has(uri) ? [uri] : Array.from(this.fileIndices.keys());
    for (const u of searchUris) {
      const idx = this.fileIndices.get(u);
      if (!idx) continue;
      for (const name of idx.byName.keys()) {
        if (name.toLowerCase().startsWith(norm)) {
          suggestions.add(name);
        }
      }
    }

    return Array.from(suggestions);
  }

  public indexFile(uri: string, content: string): void {
    let slot = this.fileBaseIds.get(uri);
    if (!slot) {
      slot = this.nextFileSlot++;
      this.fileBaseIds.set(uri, slot);
    }
    const baseId = slot * 100_000;
    let localCounter = 1;
    const allocId = (): SymbolId => (baseId + localCounter++) as SymbolId;

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const addSym = (parentId: SymbolId | null, name: string, kind: string): SymbolId => {
      const id = allocId();
      const entry: SymbolEntry = {
        id,
        name,
        kind,
        ruleName: "fea_entity",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "fea",
        resourceId: uri,
        metadata: {},
      };
      symbols.set(id, entry);

      const list = byName.get(name) ?? [];
      list.push(id);
      byName.set(name, list);

      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(id);
      childrenOf.set(parentId, siblings);

      return id;
    };

    try {
      const ext = uri.split(".").pop() ?? "inp";
      const deck = parseFeaDeck(content, ext);
      this.fileDecks.set(uri, deck);

      const rootName = deck.heading || (deck.elements.size > 0 ? `FEA (${deck.elements.size} elements)` : "FEA Deck");
      const rootId = addSym(null, rootName, "model");

      // Index materials
      for (const [matName, mat] of deck.materials.entries()) {
        addSym(rootId, matName, "material");
        if (mat.E !== undefined) {
          addSym(rootId, `${matName}_E`, "parameter");
        }
      }

      // Index node sets & element sets
      for (const setName of deck.nodeSets.keys()) {
        addSym(rootId, setName, "nset");
      }
      for (const setName of deck.elementSets.keys()) {
        addSym(rootId, setName, "elset");
      }

      // Index counts summary
      if (deck.nodes.size > 0) {
        addSym(rootId, `Nodes_${deck.nodes.size}`, "nodes");
      }
      if (deck.elements.size > 0) {
        addSym(rootId, `Elements_${deck.elements.size}`, "elements");
      }

      this.fileIndices.set(uri, { symbols, byName, childrenOf });
    } catch {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }
}
