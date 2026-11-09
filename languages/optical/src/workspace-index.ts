// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseOpenRoadmTopology } from "./parser/openroadm-parser.js";
import { parseSor } from "./sor/sor-parser.js";
import type { SorDocument } from "./sor/sor-types.js";
import type { OpticalTopology } from "./types.js";

/**
 * Multi-file workspace indexer for optical networks (.sor OTDR files and OpenROADM/GNPy topologies).
 */
export class OpticalWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileSorDocs = new Map<string, SorDocument>();
  private fileTopologies = new Map<string, OpticalTopology>();
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

  public getSorDocument(uri: string): SorDocument | undefined {
    return this.fileSorDocs.get(uri);
  }

  public getTopology(uri: string): OpticalTopology | undefined {
    return this.fileTopologies.get(uri);
  }

  public register(uri: string): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(
    uri: string,
    loader?: () => string | Uint8Array | { sourceText?: string; text?: string } | null | undefined,
  ): void {
    this._version++;
    if (!loader) return;

    try {
      const res = loader();
      if (!res) return;

      if (res instanceof Uint8Array || uri.endsWith(".sor")) {
        const bytes =
          res instanceof Uint8Array ? res : new TextEncoder().encode(typeof res === "string" ? res : (res.text ?? ""));
        const sorDoc = parseSor(bytes);
        this.fileSorDocs.set(uri, sorDoc);
        this.buildSorIndex(uri, sorDoc);
      } else {
        const text = typeof res === "string" ? res : (res.sourceText ?? res.text ?? "");
        if (text) {
          const topo = parseOpenRoadmTopology(text);
          this.fileTopologies.set(uri, topo);
          this.buildTopologyIndex(uri, topo);
        }
      }
    } catch {
      // Keep existing index if parsing fails
    }
  }

  private getBaseId(uri: string): number {
    let base = this.fileBaseIds.get(uri);
    if (base === undefined) {
      base = this.nextFileSlot * 100000;
      this.fileBaseIds.set(uri, base);
      this.nextFileSlot++;
    }
    return base;
  }

  private buildSorIndex(uri: string, doc: SorDocument): void {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();
    const baseId = this.getBaseId(uri);

    const rootSymId = (baseId + 1) as SymbolId;
    const fiberName = doc.genParams.fiberId || doc.genParams.cableId || "OTDR_Trace";

    symbols.set(rootSymId, {
      id: rootSymId,
      name: fiberName,
      kind: "package",
      ruleName: "otdr_trace",
      namePath: fiberName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: 0,
      exports: [],
      inherits: [],
      language: "optical",
      resourceId: uri,
      metadata: {
        wavelength: doc.genParams.nominalWavelengthNm,
        fiberType: doc.genParams.fiberType,
      },
    });
    byName.set(fiberName, [rootSymId]);

    const childIds: SymbolId[] = [];
    doc.keyEvents.forEach((ev, idx) => {
      const evId = (baseId + 2 + idx) as SymbolId;
      const evName = `Event_${ev.eventNumber}_${ev.eventType}_${Math.round(ev.distanceMeters)}m`;
      symbols.set(evId, {
        id: evId,
        name: evName,
        kind: "property",
        ruleName: "otdr_event",
        namePath: evName,
        fieldName: null,
        parentId: rootSymId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "optical",
        resourceId: uri,
        metadata: {
          eventType: ev.eventType,
          distanceMeters: ev.distanceMeters,
          lossDb: ev.eventLossDb,
        },
      });
      childIds.push(evId);
      const list = byName.get(evName) || [];
      list.push(evId);
      byName.set(evName, list);
    });

    childrenOf.set(rootSymId, childIds);
    this.fileIndices.set(uri, { symbols, byName, childrenOf });
  }

  private buildTopologyIndex(uri: string, topo: OpticalTopology): void {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();
    const baseId = this.getBaseId(uri);

    const rootSymId = (baseId + 1) as SymbolId;
    symbols.set(rootSymId, {
      id: rootSymId,
      name: topo.name,
      kind: "package",
      ruleName: "optical_topology",
      namePath: topo.name,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: 0,
      exports: [],
      inherits: [],
      language: "optical",
      resourceId: uri,
      metadata: {
        nodeCount: topo.nodes.size,
        spanCount: topo.spans.size,
      },
    });
    byName.set(topo.name, [rootSymId]);

    const childIds: SymbolId[] = [];
    let counter = 2;

    for (const node of topo.nodes.values()) {
      const symId = (baseId + counter++) as SymbolId;
      symbols.set(symId, {
        id: symId,
        name: node.name,
        kind: "class",
        ruleName: "optical_node",
        namePath: node.name,
        fieldName: null,
        parentId: rootSymId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "optical",
        resourceId: uri,
        metadata: {
          nodeType: node.nodeType,
          degrees: node.degrees.length,
        },
      });
      childIds.push(symId);
      const list = byName.get(node.name) || [];
      list.push(symId);
      byName.set(node.name, list);
    }

    for (const span of topo.spans.values()) {
      const symId = (baseId + counter++) as SymbolId;
      symbols.set(symId, {
        id: symId,
        name: span.id,
        kind: "component",
        ruleName: "optical_span",
        namePath: span.id,
        fieldName: null,
        parentId: rootSymId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "optical",
        resourceId: uri,
        metadata: {
          lengthKm: span.lengthKm,
          fiberType: span.fiberType,
        },
      });
      childIds.push(symId);
      const list = byName.get(span.id) || [];
      list.push(symId);
      byName.set(span.id, list);
    }

    childrenOf.set(rootSymId, childIds);
    this.fileIndices.set(uri, { symbols, byName, childrenOf });
  }

  public invalidate(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileSorDocs.delete(uri);
    this.fileTopologies.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileSorDocs.clear();
    this.fileTopologies.clear();
  }

  public get(id: SymbolId): SymbolEntry | undefined {
    for (const index of this.fileIndices.values()) {
      const entry = index.symbols.get(id);
      if (entry) return entry;
    }
    return undefined;
  }

  public findByName(name: string): SymbolId[] {
    const results: SymbolId[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) results.push(...ids);
    }
    return results;
  }

  public getChildren(parentId: SymbolId | null): SymbolId[] {
    const results: SymbolId[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.childrenOf.get(parentId);
      if (ids) results.push(...ids);
    }
    return results;
  }
}
