// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parsePhreeqc } from "./parser/phreeqc-parser.js";
import type { PhreeqcDocument } from "./types.js";

export type PhreeqcDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for USGS PHREEQC input decks and thermodynamic databases (.pqi, .dat).
 */
export class PhreeqcWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, PhreeqcDocument>();
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

  public getDocument(uri: string): PhreeqcDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: PhreeqcDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: PhreeqcDocumentLoader): void {
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
        ruleName: "phreeqc_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "phreeqc",
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
      const doc = parsePhreeqc(text, uri);
      this.fileDocuments.set(uri, doc);

      const rootName = doc.title ?? "PhreeqcDeck";
      const rootId = addSymbol(rootName, "package", null, 0, text.length, {
        title: doc.title,
        solutionCount: doc.solutions.size,
        equilibriumPhaseCount: doc.equilibriumPhases.length,
        kineticsCount: doc.kinetics.length,
      });

      // Index Solutions and Solutes
      for (const [, sol] of doc.solutions) {
        const solStart = sol.range?.startOffset ?? 0;
        const solEnd = sol.range?.endOffset ?? 50;
        const solSymName = `SOLUTION_${sol.number}`;
        const solId = addSymbol(solSymName, "struct", rootId, solStart, solEnd, {
          number: sol.number,
          name: sol.name,
          temp: sol.temp,
          pH: sol.pH,
          pe: sol.pe,
          units: sol.units,
        });

        for (const [elem, conc] of sol.solutes) {
          const spec = sol.soluteSpecs?.get(elem);
          const sStart = spec?.range?.startOffset ?? solStart;
          const sEnd = spec?.range?.endOffset ?? solEnd;
          addSymbol(elem, "variable", solId, sStart, sEnd, {
            concentration: conc,
            units: spec?.units ?? sol.units,
            solutionNumber: sol.number,
          });
        }
      }

      // Index Equilibrium Phases
      for (const ep of doc.equilibriumPhases) {
        const start = ep.range?.startOffset ?? 0;
        const end = ep.range?.endOffset ?? 50;
        addSymbol(ep.name, "constant", rootId, start, end, {
          targetSI: ep.targetSI,
          initialMoles: ep.initialMoles,
          blockNumber: ep.blockNumber,
        });
      }

      // Index Reactions
      for (const [, rxn] of doc.reactions) {
        const start = rxn.range?.startOffset ?? 0;
        const end = rxn.range?.endOffset ?? 50;
        addSymbol(`REACTION_${rxn.number}`, "function", rootId, start, end, {
          number: rxn.number,
          totalMoles: rxn.totalMoles,
          stepCount: rxn.stepCount,
        });
      }

      // Index Kinetics
      for (const kin of doc.kinetics) {
        const start = kin.range?.startOffset ?? 0;
        const end = kin.range?.endOffset ?? 50;
        addSymbol(kin.name, "function", rootId, start, end, {
          m0: kin.m0,
          rateConstant: kin.rateConstant,
          surfaceArea: kin.surfaceArea,
        });
      }

      // Index Mixes
      for (const [, mix] of doc.mixes) {
        const start = mix.range?.startOffset ?? 0;
        const end = mix.range?.endOffset ?? 50;
        addSymbol(`MIX_${mix.number}`, "struct", rootId, start, end, {
          number: mix.number,
          fractions: Object.fromEntries(mix.fractions),
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
