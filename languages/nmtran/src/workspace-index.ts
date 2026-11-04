// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseNmtran } from "./parser/nmtran-parser.js";
import type { NmtranDocument } from "./types.js";

export type NmtranDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for NONMEM / NMTRAN pharmacometric control streams (.ctl, .mod).
 */
export class NmtranWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, NmtranDocument>();
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

  public getDocument(uri: string): NmtranDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: NmtranDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: NmtranDocumentLoader): void {
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
        ruleName: "nmtran_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "nmtran",
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
      const doc = parseNmtran(text, uri);
      this.fileDocuments.set(uri, doc);
      const cs = doc.controlStream;

      const rootId = addSymbol(cs.problem || "NmtranControlStream", "package", null, 0, text.length, {
        advan: cs.subroutines.advan,
        trans: cs.subroutines.trans,
        thetaCount: cs.thetas.length,
        omegaCount: cs.omegas.length,
        compartmentCount: cs.compartments.length,
      });

      // Index Compartments
      for (const c of cs.compartments) {
        const start = c.range?.startOffset ?? 0;
        const end = c.range?.endOffset ?? 50;
        addSymbol(c.name, "struct", rootId, start, end, {
          index: c.index,
          defDose: c.defDose,
          defObs: c.defObs,
        });
      }

      // Index $PK Variables
      for (const st of cs.pkStatements) {
        const start = st.range?.startOffset ?? 0;
        const end = st.range?.endOffset ?? 50;
        addSymbol(st.lhs, "variable", rootId, start, end, {
          rhs: st.rhs,
          thetaRefs: st.thetaRefs,
          etaRefs: st.etaRefs,
        });
      }

      // Index $THETA Parameters
      for (const th of cs.thetas) {
        const start = th.range?.startOffset ?? 0;
        const end = th.range?.endOffset ?? 50;
        addSymbol(`THETA(${th.index})`, "constant", rootId, start, end, {
          index: th.index,
          name: th.name,
          lower: th.lower,
          init: th.init,
          upper: th.upper,
          fixed: th.fixed,
        });
        if (th.name) {
          addSymbol(th.name, "constant", rootId, start, end, {
            thetaIndex: th.index,
            init: th.init,
          });
        }
      }

      // Index $OMEGA Entries
      for (const om of cs.omegas) {
        const start = om.range?.startOffset ?? 0;
        const end = om.range?.endOffset ?? 50;
        addSymbol(`ETA(${om.index})`, "constant", rootId, start, end, {
          index: om.index,
          variance: om.variance,
          fixed: om.fixed,
        });
      }

      // Index $DES Equations
      for (const eq of cs.desEquations) {
        const start = eq.range?.startOffset ?? 0;
        const end = eq.range?.endOffset ?? 50;
        addSymbol(eq.lhs, "function", rootId, start, end, {
          rhs: eq.rhs,
          compartmentIndex: eq.compartmentIndex,
          isDerivative: eq.isDerivative,
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
