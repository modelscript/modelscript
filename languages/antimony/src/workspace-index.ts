// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseAntimony } from "./parser/antimony-parser.js";
import type { AntimonyDocument, AntimonyModule } from "./types.js";

export type AntimonyDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for Antimony reaction network documents (.ant).
 */
export class AntimonyWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, AntimonyDocument>();
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

  public getDocument(uri: string): AntimonyDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: AntimonyDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: AntimonyDocumentLoader): void {
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
        ruleName: "antimony_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "antimony",
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
      const doc = parseAntimony(text, uri);
      this.fileDocuments.set(uri, doc);

      // Index Functions
      for (const [fnId, fn] of doc.functions) {
        const start = fn.range?.startOffset ?? 0;
        const end = fn.range?.endOffset ?? text.length;
        addSymbol(fnId, "function", null, start, end, {
          arguments: fn.arguments,
          body: fn.body,
        });
      }

      const modulesToIndex: AntimonyModule[] =
        doc.modules.size > 0 ? Array.from(doc.modules.values()) : [doc.mainModule];

      for (const mod of modulesToIndex) {
        const modStart = mod.range?.startOffset ?? 0;
        const modEnd = mod.range?.endOffset ?? text.length;
        const modSymId = addSymbol(mod.id || "AntimonyModule", "package", null, modStart, modEnd, {
          name: mod.name,
          speciesCount: mod.species.size,
          reactionCount: mod.reactions.size,
        });

        for (const [cId, comp] of mod.compartments) {
          addSymbol(cId, "struct", modSymId, comp.range?.startOffset ?? modStart, comp.range?.endOffset ?? modEnd, {
            name: comp.name,
            size: comp.size,
            constant: comp.constant,
          });
        }

        for (const [sId, sp] of mod.species) {
          addSymbol(sId, "variable", modSymId, sp.range?.startOffset ?? modStart, sp.range?.endOffset ?? modEnd, {
            name: sp.name,
            compartment: sp.compartment,
            initialConcentration: sp.initialConcentration,
            boundaryCondition: sp.boundaryCondition,
            constant: sp.constant,
          });
        }

        for (const [pId, param] of mod.parameters) {
          addSymbol(pId, "constant", modSymId, param.range?.startOffset ?? modStart, param.range?.endOffset ?? modEnd, {
            name: param.name,
            value: param.value,
            constant: param.constant,
          });
        }

        for (const [rId, rxn] of mod.reactions) {
          addSymbol(rId, "function", modSymId, rxn.range?.startOffset ?? modStart, rxn.range?.endOffset ?? modEnd, {
            name: rxn.name,
            reversible: rxn.reversible,
            reactants: rxn.reactants.map((r) => r.species),
            products: rxn.products.map((p) => p.species),
            rateLaw: rxn.rateLaw,
          });
        }

        for (const ev of mod.events) {
          addSymbol(ev.id, "event", modSymId, ev.range?.startOffset ?? modStart, ev.range?.endOffset ?? modEnd, {
            trigger: ev.trigger,
            assignments: ev.assignments.length,
          });
        }
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
