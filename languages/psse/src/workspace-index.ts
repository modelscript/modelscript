// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseRaw } from "./parser/raw-parser.js";
import type { PsseCase } from "./types.js";

/**
 * Workspace indexer for PSS/E RAW (`.raw`) power flow cases.
 */
export class PsseWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileCases = new Map<string, PsseCase>();
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

  public getCase(uri: string): PsseCase | undefined {
    return this.fileCases.get(uri);
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
    let idCounter = baseId;

    const parsedCase = parseRaw(text);
    this.fileCases.set(uri, parsedCase);

    // Root Case Class Symbol
    const rootId = idCounter++ as SymbolId;
    const caseName = parsedCase.title1 || "PsseCase";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: caseName,
      kind: "Class",
      ruleName: "psse_case",
      namePath: caseName,
      fieldName: null,
      parentId: null,
      startOffset: parsedCase.header.span?.startOffset ?? 0,
      endOffset: parsedCase.header.span?.endOffset ?? text.length,
      exports: [],
      inherits: [],
      language: "psse",
      resourceId: uri,
      metadata: {
        sbase: parsedCase.header.sbase,
        rev: parsedCase.header.rev,
        basfrq: parsedCase.header.basfrq,
        nBuses: parsedCase.buses.size,
        nBranches: parsedCase.branches.length,
        nGenerators: parsedCase.generators.length,
        nLoads: parsedCase.loads.length,
      },
    };
    symbols.set(rootId, rootEntry);
    byName.set(caseName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    // Helper to register child symbol
    function addChild(name: string, kind: string, span?: { startOffset: number; endOffset: number }, meta?: any) {
      const id = idCounter++ as SymbolId;
      const entry: SymbolEntry = {
        id,
        name,
        kind: kind as any,
        ruleName: "psse_component",
        namePath: name,
        fieldName: null,
        parentId: rootId,
        startOffset: span?.startOffset ?? 0,
        endOffset: span?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "psse",
        resourceId: uri,
        metadata: meta,
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    }

    // Index Buses
    for (const b of parsedCase.buses.values()) {
      addChild(`Bus_${b.i}`, "Component", b.span, {
        busNumber: b.i,
        busName: b.name,
        baseKv: b.baseKv,
        ide: b.ide,
        vm: b.vm,
        va: b.va,
      });
      // Also register plain bus number for fast navigation
      const strId = String(b.i);
      const existing = byName.get(strId) ?? [];
      const busSymId = (idCounter - 1) as SymbolId;
      if (!existing.includes(busSymId)) {
        existing.push(busSymId);
        byName.set(strId, existing);
      }
    }

    // Index Generators
    for (const g of parsedCase.generators) {
      addChild(`Gen_${g.i}_${g.id}`, "Component", g.span, {
        busNumber: g.i,
        genId: g.id,
        pg: g.pg,
        qg: g.qg,
        status: g.stat,
      });
    }

    // Index Branches
    for (const br of parsedCase.branches) {
      addChild(`Branch_${br.i}_${br.j}_${br.ckt}`, "Component", br.span, {
        fromBus: br.i,
        toBus: br.j,
        ckt: br.ckt,
        r: br.r,
        x: br.x,
        rateA: br.rateA,
        status: br.st,
      });
    }

    // Index Transformers
    for (const t of parsedCase.transformers) {
      addChild(`Xfmr_${t.i}_${t.j}_${t.ckt}`, "Component", t.span, {
        fromBus: t.i,
        toBus: t.j,
        ckt: t.ckt,
        windv1: t.windv1,
        status: t.stat,
      });
    }

    // Index Loads
    for (const l of parsedCase.loads) {
      addChild(`Load_${l.i}_${l.id}`, "Component", l.span, {
        busNumber: l.i,
        loadId: l.id,
        pl: l.pl,
        ql: l.ql,
        status: l.status,
      });
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }
}
