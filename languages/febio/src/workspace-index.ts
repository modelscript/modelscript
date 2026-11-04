// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for FEBio (.feb) and SOFA Framework (.scn) files.
 * Indexes materials, node sets, surfaces, solid domains, boundary conditions,
 * loads, contact interfaces, and SOFA scene nodes.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseFebio } from "./parser/index.js";
import type { FebioDocument } from "./types.js";

export class FebioWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, FebioDocument>();
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

  public getDocument(uri: string): FebioDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: () => unknown): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: () => string | { sourceText?: string; text?: string } | null): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // incremental reindex guard
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

    const doc = parseFebio(text, uri);
    this.fileDocuments.set(uri, doc);

    const rootChildren: SymbolId[] = [];

    const addByName = (key: string, symId: SymbolId) => {
      if (!key) return;
      const list = byName.get(key) ?? [];
      if (!list.includes(symId)) {
        list.push(symId);
        byName.set(key, list);
      }
    };

    // 1. Index Materials
    for (const mat of doc.materials) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      const entry: SymbolEntry = {
        id: symId,
        name: mat.name,
        kind: "Class",
        ruleName: "febio_material",
        namePath: mat.name,
        fieldName: null,
        parentId: null,
        startOffset: mat.range.startOffset,
        endOffset: mat.range.endOffset,
        exports: [],
        inherits: [],
        language: "febio",
        resourceId: uri,
        metadata: {
          materialId: mat.id,
          materialType: mat.type,
          E: mat.E,
          v: mat.v,
          c1: mat.c1,
          c2: mat.c2,
        },
      };
      symbols.set(symId, entry);
      addByName(mat.name, symId);
      addByName(mat.id, symId);
    }

    // 2. Index NodeSets
    for (const ns of doc.nodeSets) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      const entry: SymbolEntry = {
        id: symId,
        name: ns.name,
        kind: "Component",
        ruleName: "febio_nodeset",
        namePath: ns.name,
        fieldName: null,
        parentId: null,
        startOffset: ns.range.startOffset,
        endOffset: ns.range.endOffset,
        exports: [],
        inherits: [],
        language: "febio",
        resourceId: uri,
        metadata: {
          nodeCount: ns.nodeIds.length,
        },
      };
      symbols.set(symId, entry);
      addByName(ns.name, symId);
    }

    // 3. Index Surfaces
    for (const surf of doc.surfaces) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      const entry: SymbolEntry = {
        id: symId,
        name: surf.name,
        kind: "Interface",
        ruleName: "febio_surface",
        namePath: surf.name,
        fieldName: null,
        parentId: null,
        startOffset: surf.range.startOffset,
        endOffset: surf.range.endOffset,
        exports: [],
        inherits: [],
        language: "febio",
        resourceId: uri,
        metadata: {
          facetCount: surf.facets.length,
        },
      };
      symbols.set(symId, entry);
      addByName(surf.name, symId);
    }

    // 4. Index Boundary Conditions
    for (const bc of doc.boundaryConditions) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      const entry: SymbolEntry = {
        id: symId,
        name: bc.name,
        kind: "Property",
        ruleName: "febio_bc",
        namePath: bc.name,
        fieldName: null,
        parentId: null,
        startOffset: bc.range.startOffset,
        endOffset: bc.range.endOffset,
        exports: [],
        inherits: [],
        language: "febio",
        resourceId: uri,
        metadata: {
          bcType: bc.type,
          nodeSet: bc.nodeSet,
          dofs: bc.dofs,
        },
      };
      symbols.set(symId, entry);
      addByName(bc.name, symId);
      addByName(bc.id, symId);
    }

    // 5. Index Contacts
    for (const c of doc.contacts) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      const entry: SymbolEntry = {
        id: symId,
        name: c.name,
        kind: "Event",
        ruleName: "febio_contact",
        namePath: c.name,
        fieldName: null,
        parentId: null,
        startOffset: c.range.startOffset,
        endOffset: c.range.endOffset,
        exports: [],
        inherits: [],
        language: "febio",
        resourceId: uri,
        metadata: {
          contactType: c.type,
          primarySurface: c.primarySurface,
          secondarySurface: c.secondarySurface,
          penalty: c.penalty,
        },
      };
      symbols.set(symId, entry);
      addByName(c.name, symId);
      addByName(c.id, symId);
    }

    // 6. Index SOFA Scene Nodes & Child ForceFields
    for (const sn of doc.sofaNodes) {
      const snSymId = idCounter++ as SymbolId;
      rootChildren.push(snSymId);
      const snEntry: SymbolEntry = {
        id: snSymId,
        name: sn.name,
        kind: "Module",
        ruleName: "sofa_node",
        namePath: sn.name,
        fieldName: null,
        parentId: null,
        startOffset: sn.range.startOffset,
        endOffset: sn.range.endOffset,
        exports: [],
        inherits: [],
        language: "febio",
        resourceId: uri,
        metadata: {
          hasMechanicalObject: sn.hasMechanicalObject,
          hasFixedConstraint: sn.hasFixedConstraint,
        },
      };
      symbols.set(snSymId, snEntry);
      addByName(sn.name, snSymId);

      const children: SymbolId[] = [];
      for (const ff of sn.forceFields) {
        const ffSymId = idCounter++ as SymbolId;
        children.push(ffSymId);
        const ffEntry: SymbolEntry = {
          id: ffSymId,
          name: ff.name,
          kind: "Variable",
          ruleName: "sofa_forcefield",
          namePath: `${sn.name}.${ff.name}`,
          fieldName: null,
          parentId: snSymId,
          startOffset: ff.range.startOffset,
          endOffset: ff.range.endOffset,
          exports: [],
          inherits: [],
          language: "febio",
          resourceId: uri,
          metadata: {
            forceFieldType: ff.type,
            youngModulus: ff.youngModulus,
            poissonRatio: ff.poissonRatio,
          },
        };
        symbols.set(ffSymId, ffEntry);
        addByName(ff.name, ffSymId);
      }
      childrenOf.set(snSymId, children);
    }

    childrenOf.set(null, rootChildren);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, index);
    return index;
  }

  public resolveInScope(name: string, scopeId: SymbolId | null, uri: string): SymbolEntry | null {
    const idx = this.fileIndices.get(uri);
    if (!idx) return null;

    if (scopeId !== null) {
      const children = idx.childrenOf.get(scopeId);
      if (children) {
        for (const cid of children) {
          const sym = idx.symbols.get(cid);
          if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
            return sym;
          }
        }
      }
    }

    for (const fileIndex of this.fileIndices.values()) {
      const candidates = fileIndex.byName.get(name);
      const firstCandidate = candidates?.[0];
      if (firstCandidate !== undefined) {
        const found = fileIndex.symbols.get(firstCandidate);
        if (found) return found;
      }
    }

    return null;
  }

  public lookupExact(id: SymbolId): SymbolEntry | undefined {
    for (const index of this.fileIndices.values()) {
      const sym = index.symbols.get(id);
      if (sym) return sym;
    }
    return undefined;
  }

  public findByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const s = index.symbols.get(id);
          if (s) results.push(s);
        }
      }
    }
    return results;
  }

  public getAllSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    if (!idx) return [];
    return Array.from(idx.symbols.values());
  }

  public getAllFiles(): string[] {
    return Array.from(this.fileIndices.keys());
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
  }
}
