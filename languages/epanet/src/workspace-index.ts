// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/epanet — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for US EPA EPANET network files (.inp).
 * Indexes junctions, reservoirs, tanks, pipes, pumps, valves, and curves.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseInp } from "./parser/index.js";
import type { EpanetNetwork } from "./types.js";

export class EpanetWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, EpanetNetwork>();
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

  public getDocument(uri: string): EpanetNetwork | undefined {
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
        if (typeof res === "string") {
          this.indexSource(uri, res);
        } else if (res && typeof res === "object") {
          this.indexDocument(uri, res as EpanetNetwork);
        }
      } catch {
        // Retain previous or empty index
      }
    }
  }

  public indexSource(uri: string, source: string): void {
    const net = parseInp(source, uri);
    this.indexDocument(uri, net);
  }

  public indexDocument(uri: string, net: EpanetNetwork): void {
    this._version++;
    this.fileDocuments.set(uri, net);

    let baseId = this.fileBaseIds.get(uri);
    if (!baseId) {
      baseId = this.nextFileSlot * 100_000;
      this.nextFileSlot++;
      this.fileBaseIds.set(uri, baseId);
    }

    let localSeq = 1;
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    function addSym(name: string, kind: string, parentId: SymbolId | null = null, extra?: any): SymbolId {
      const symId = (baseId! + localSeq++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind: kind as any,
        ruleName: `epanet_${kind}`,
        namePath: name,
        fieldName: null,
        parentId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "epanet",
        resourceId: uri,
        metadata: extra,
      };

      symbols.set(symId, entry);

      const existingNames = byName.get(name) ?? [];
      existingNames.push(symId);
      byName.set(name, existingNames);

      const existingChildren = childrenOf.get(parentId) ?? [];
      existingChildren.push(symId);
      childrenOf.set(parentId, existingChildren);

      return symId;
    }

    // 1. Title Symbol
    let titleSymId: SymbolId | null = null;
    if (net.title) {
      titleSymId = addSym(net.title, "network", null, {
        units: net.options.units,
        headloss: net.options.headloss,
      });
    }

    // 2. Junctions
    for (const j of net.junctions) {
      addSym(j.id, "junction", titleSymId, {
        elevation: j.elevation,
        demand: j.demand,
      });
    }

    // 3. Reservoirs & Tanks
    for (const r of net.reservoirs) {
      addSym(r.id, "reservoir", titleSymId, {
        totalHead: r.totalHead,
      });
    }
    for (const t of net.tanks) {
      addSym(t.id, "tank", titleSymId, {
        elevation: t.elevation,
        diameter: t.diameter,
      });
    }

    // 4. Pipes
    for (const p of net.pipes) {
      addSym(p.id, "pipe", titleSymId, {
        node1: p.node1,
        node2: p.node2,
        length: p.length,
        diameter: p.diameter,
        roughness: p.roughness,
      });
    }

    // 5. Pumps & Valves
    for (const pump of net.pumps) {
      addSym(pump.id, "pump", titleSymId, {
        node1: pump.node1,
        node2: pump.node2,
        power: pump.power,
        curveId: pump.headCurveId,
      });
    }
    for (const v of net.valves) {
      addSym(v.id, "valve", titleSymId, {
        node1: v.node1,
        node2: v.node2,
        type: v.type,
        setting: v.setting,
      });
    }

    this.fileIndices.set(uri, {
      symbols,
      byName,
      childrenOf,
    });
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
}
