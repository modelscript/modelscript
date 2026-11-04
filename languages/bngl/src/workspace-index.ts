// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseBngl, serializeComplexPattern } from "./parser/bngl-parser.js";
import type { BnglDocument } from "./types.js";

export type BnglDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for BioNetGen rule-based modeling documents (.bngl).
 */
export class BnglWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, BnglDocument>();
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

  public getDocument(uri: string): BnglDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: BnglDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: BnglDocumentLoader): void {
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
      metadata: Record<string, unknown> = {},
    ): SymbolId {
      const symId = ((baseId ?? 0) + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "bngl_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "bngl",
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
      const doc = parseBngl(text, uri);
      this.fileDocuments.set(uri, doc);
      const m = doc.model;

      const modStart = m.range?.startOffset ?? 0;
      const modEnd = m.range?.endOffset ?? text.length;
      const modSymId = addSymbol(m.id || "BioNetGenModel", "package", null, modStart, modEnd, {
        moleculeTypeCount: m.moleculeTypes.size,
        seedSpeciesCount: m.seedSpecies.length,
        ruleCount: m.reactionRules.size,
      });

      for (const [pId, param] of m.parameters) {
        addSymbol(pId, "constant", modSymId, param.range?.startOffset ?? modStart, param.range?.endOffset ?? modEnd, {
          value: param.value,
          expression: param.expression,
        });
      }

      for (const [cId, comp] of m.compartments) {
        addSymbol(cId, "struct", modSymId, comp.range?.startOffset ?? modStart, comp.range?.endOffset ?? modEnd, {
          dimensions: comp.dimensions,
          size: comp.size,
          parent: comp.parent,
        });
      }

      for (const [mName, mt] of m.moleculeTypes) {
        addSymbol(mName, "class", modSymId, mt.range?.startOffset ?? modStart, mt.range?.endOffset ?? modEnd, {
          sites: mt.sites.map((s) => s.name),
        });
      }

      for (const sp of m.seedSpecies) {
        const patStr = sp.pattern.raw ?? serializeComplexPattern(sp.pattern);
        addSymbol(patStr, "variable", modSymId, sp.range?.startOffset ?? modStart, sp.range?.endOffset ?? modEnd, {
          id: sp.id,
          initialConcentration: sp.initialConcentration,
        });
      }

      for (const [oName, obs] of m.observables) {
        addSymbol(oName, "property", modSymId, obs.range?.startOffset ?? modStart, obs.range?.endOffset ?? modEnd, {
          type: obs.type,
          patterns: obs.patterns.length,
        });
      }

      for (const [rId, rule] of m.reactionRules) {
        addSymbol(rId, "function", modSymId, rule.range?.startOffset ?? modStart, rule.range?.endOffset ?? modEnd, {
          reversible: rule.reversible,
          forwardRate: rule.forwardRate,
          reverseRate: rule.reverseRate,
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
