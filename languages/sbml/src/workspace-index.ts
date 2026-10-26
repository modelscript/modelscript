// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseSbml } from "./parser/sbml-parser.js";
import type { SbmlDocument } from "./types.js";

/**
 * Multi-file workspace indexer for Systems Biology Markup Language documents (.sbml, .xml).
 */
export class SbmlWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, SbmlDocument>();
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

  public getDocument(uri: string): SbmlDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: () => any): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: () => any): void {
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

  public indexFile(uri: string, text: string): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }

    let localId = 1;
    function addSymbol(
      name: string,
      kind: string,
      parentId: SymbolId | null,
      startOffset: number,
      endOffset: number,
      metadata: Record<string, any> = {},
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind: kind as any,
        ruleName: "sbml_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "sbml",
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
    }

    try {
      const doc = parseSbml(text, uri);
      this.fileDocuments.set(uri, doc);
      const m = doc.model;

      // Root Model symbol
      const rootId = addSymbol(m.id || "SbmlModel", "package", null, 0, text.length, {
        name: m.name,
        level: doc.level,
        version: doc.version,
        speciesCount: m.species.size,
        reactionCount: m.reactions.size,
      });

      // Index Compartments
      for (const [id, c] of m.compartments) {
        const start = c.range?.startOffset ?? 0;
        const end = c.range?.endOffset ?? 50;
        addSymbol(id, "struct", rootId, start, end, {
          name: c.name,
          size: c.size,
          spatialDimensions: c.spatialDimensions,
        });
      }

      // Index Species
      for (const [id, s] of m.species) {
        const start = s.range?.startOffset ?? 0;
        const end = s.range?.endOffset ?? 50;
        addSymbol(id, "variable", rootId, start, end, {
          name: s.name,
          compartment: s.compartment,
          initialAmount: s.initialAmount,
          initialConcentration: s.initialConcentration,
          constant: s.constant,
        });
      }

      // Index Parameters
      for (const [id, p] of m.parameters) {
        const start = p.range?.startOffset ?? 0;
        const end = p.range?.endOffset ?? 50;
        addSymbol(id, "constant", rootId, start, end, {
          value: p.value,
          units: p.units,
        });
      }

      // Index Reactions
      for (const [id, r] of m.reactions) {
        const start = r.range?.startOffset ?? 0;
        const end = r.range?.endOffset ?? 50;
        addSymbol(id, "function", rootId, start, end, {
          reversible: r.reversible,
          reactants: r.reactants.map((ref) => ref.species),
          products: r.products.map((ref) => ref.species),
          formula: r.kineticLaw?.formula,
        });
      }
    } catch {
      // Return partial symbol map if parsing failed
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public getSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    return idx ? Array.from(idx.symbols.values()) : [];
  }

  public findDefinition(name: string): SymbolEntry | undefined {
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids && ids.length > 0 && ids[0] !== undefined) {
        const sym = idx.symbols.get(ids[0]);
        if (sym) return sym;
      }
    }
    return undefined;
  }

  public findReferences(name: string): SymbolEntry[] {
    const refs: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const sym = idx.symbols.get(id);
          if (sym) refs.push(sym);
        }
      }
    }
    return refs;
  }

  public clear(): void {
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
    this._version++;
  }
}
