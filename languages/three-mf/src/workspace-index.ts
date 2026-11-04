// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for ISO/ASTM 52915 3MF files (.3mf).
 * Indexes 3D mesh objects, base materials, surgical guide specifications,
 * osteotomy cutting planes, drill sleeves, and build items.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseThreeMf } from "./parser/index.js";
import type { ThreeMfDocument } from "./types.js";

export class ThreeMfWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, ThreeMfDocument>();
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

  public getDocument(uri: string): ThreeMfDocument | undefined {
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

    const doc = parseThreeMf(text, uri);
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

    // 1. Index Base Material Groups
    for (const grp of doc.baseMaterialGroups) {
      for (const mat of grp.materials) {
        const symId = idCounter++ as SymbolId;
        rootChildren.push(symId);
        const entry: SymbolEntry = {
          id: symId,
          name: mat.name,
          kind: "Constant",
          ruleName: "three_mf_material",
          namePath: `${grp.id}/${mat.name}`,
          fieldName: null,
          parentId: null,
          startOffset: mat.range.startOffset,
          endOffset: mat.range.endOffset,
          exports: [],
          inherits: [],
          language: "three-mf",
          resourceId: uri,
          metadata: {
            groupId: grp.id,
            index: mat.index,
            displayColor: mat.displayColor,
          },
        };
        symbols.set(symId, entry);
        addByName(mat.name, symId);
      }
    }

    // 2. Index Objects and Child Surgical Guide Features
    for (const obj of doc.objects) {
      const objSymId = idCounter++ as SymbolId;
      rootChildren.push(objSymId);
      const displayName = obj.name ?? `Object_${obj.id}`;

      const entry: SymbolEntry = {
        id: objSymId,
        name: displayName,
        kind: "Component",
        ruleName: "three_mf_object",
        namePath: displayName,
        fieldName: null,
        parentId: null,
        startOffset: obj.range.startOffset,
        endOffset: obj.range.endOffset,
        exports: [],
        inherits: [],
        language: "three-mf",
        resourceId: uri,
        metadata: {
          objectId: obj.id,
          type: obj.type,
          materialName: obj.materialName,
          wallThicknessMm: obj.wallThicknessMm,
          vertexCount: obj.mesh?.vertices.length ?? 0,
          triangleCount: obj.mesh?.triangles.length ?? 0,
        },
      };
      symbols.set(objSymId, entry);
      addByName(displayName, objSymId);
      addByName(obj.id, objSymId);

      const objChildren: SymbolId[] = [];
      if (obj.surgicalGuide) {
        for (const plane of obj.surgicalGuide.osteotomyPlanes) {
          const pSymId = idCounter++ as SymbolId;
          objChildren.push(pSymId);
          const pEntry: SymbolEntry = {
            id: pSymId,
            name: plane.id,
            kind: "Property",
            ruleName: "three_mf_osteotomy_plane",
            namePath: `${displayName}.${plane.id}`,
            fieldName: null,
            parentId: objSymId,
            startOffset: plane.range.startOffset,
            endOffset: plane.range.endOffset,
            exports: [],
            inherits: [],
            language: "three-mf",
            resourceId: uri,
            metadata: {
              origin: plane.origin,
              normal: plane.normal,
              slotWidthMm: plane.slotWidthMm,
            },
          };
          symbols.set(pSymId, pEntry);
          addByName(plane.id, pSymId);
        }

        for (const sleeve of obj.surgicalGuide.drillSleeves) {
          const sSymId = idCounter++ as SymbolId;
          objChildren.push(sSymId);
          const sEntry: SymbolEntry = {
            id: sSymId,
            name: sleeve.id,
            kind: "Property",
            ruleName: "three_mf_drill_sleeve",
            namePath: `${displayName}.${sleeve.id}`,
            fieldName: null,
            parentId: objSymId,
            startOffset: sleeve.range.startOffset,
            endOffset: sleeve.range.endOffset,
            exports: [],
            inherits: [],
            language: "three-mf",
            resourceId: uri,
            metadata: {
              innerDiameterMm: sleeve.innerDiameterMm,
              outerDiameterMm: sleeve.outerDiameterMm,
              wallThicknessMm: sleeve.wallThicknessMm,
            },
          };
          symbols.set(sSymId, sEntry);
          addByName(sleeve.id, sSymId);
        }
      }
      childrenOf.set(objSymId, objChildren);
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
