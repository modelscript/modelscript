// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for OpenSim (.osim) biomechanical model files.
 * Indexes rigid bodies, joints, generalized coordinates, Hill-type muscles,
 * markers, wrap objects, and kinematic constraints.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseOpenSim } from "./parser/index.js";
import type { OpenSimDocument } from "./types.js";

export class OpenSimWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, OpenSimDocument>();
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

  public getDocument(uri: string): OpenSimDocument | undefined {
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

    const doc = parseOpenSim(text, uri);
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

    // 1. Index Bodies
    for (const b of doc.bodies) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: b.name,
        kind: "Component",
        ruleName: "opensim_body",
        namePath: b.name,
        fieldName: null,
        parentId: null,
        startOffset: b.range.startOffset,
        endOffset: b.range.endOffset,
        exports: [],
        inherits: [],
        language: "opensim",
        resourceId: uri,
        metadata: {
          bodyId: b.id,
          mass: b.mass,
          massCenter: b.massCenter,
          inertia: b.inertia,
        },
      };
      symbols.set(symId, entry);
      addByName(b.name, symId);
      addByName(b.id, symId);
    }

    // 2. Index Joints & Child Coordinates
    for (const j of doc.joints) {
      const jSymId = idCounter++ as SymbolId;
      rootChildren.push(jSymId);

      const jEntry: SymbolEntry = {
        id: jSymId,
        name: j.name,
        kind: "Class",
        ruleName: "opensim_joint",
        namePath: j.name,
        fieldName: null,
        parentId: null,
        startOffset: j.range.startOffset,
        endOffset: j.range.endOffset,
        exports: [],
        inherits: [j.parentFrame],
        language: "opensim",
        resourceId: uri,
        metadata: {
          jointId: j.id,
          jointType: j.jointType,
          parentFrame: j.parentFrame,
          childFrame: j.childFrame,
          locationInParent: j.locationInParent,
          orientationInParent: j.orientationInParent,
        },
      };
      symbols.set(jSymId, jEntry);
      addByName(j.name, jSymId);
      addByName(j.id, jSymId);

      const coordChildren: SymbolId[] = [];
      for (const c of j.coordinates) {
        const cSymId = idCounter++ as SymbolId;
        coordChildren.push(cSymId);

        const cEntry: SymbolEntry = {
          id: cSymId,
          name: c.name,
          kind: "Variable",
          ruleName: "opensim_coordinate",
          namePath: `${j.name}.${c.name}`,
          fieldName: null,
          parentId: jSymId,
          startOffset: c.range.startOffset,
          endOffset: c.range.endOffset,
          exports: [],
          inherits: [],
          language: "opensim",
          resourceId: uri,
          metadata: {
            coordinateId: c.id,
            motionType: c.motionType,
            defaultValue: c.defaultValue,
            rangeMin: c.rangeMin,
            rangeMax: c.rangeMax,
            clamped: c.clamped,
            locked: c.locked,
          },
        };
        symbols.set(cSymId, cEntry);
        addByName(c.name, cSymId);
        addByName(c.id, cSymId);
      }
      childrenOf.set(jSymId, coordChildren);
    }

    // 3. Index Muscles
    for (const m of doc.muscles) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: m.name,
        kind: "Function",
        ruleName: "opensim_muscle",
        namePath: m.name,
        fieldName: null,
        parentId: null,
        startOffset: m.range.startOffset,
        endOffset: m.range.endOffset,
        exports: [],
        inherits: [],
        language: "opensim",
        resourceId: uri,
        metadata: {
          muscleId: m.id,
          muscleType: m.muscleType,
          maxIsometricForce: m.maxIsometricForce,
          optimalFiberLength: m.optimalFiberLength,
          tendonSlackLength: m.tendonSlackLength,
          pennationAngleAtOptimal: m.pennationAngleAtOptimal,
          pathPoints: m.pathPoints.length,
          wrapObjects: m.wrapObjects,
        },
      };
      symbols.set(symId, entry);
      addByName(m.name, symId);
      addByName(m.id, symId);
    }

    // 4. Index Markers
    for (const mk of doc.markers) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: mk.name,
        kind: "Constant",
        ruleName: "opensim_marker",
        namePath: mk.name,
        fieldName: null,
        parentId: null,
        startOffset: mk.range.startOffset,
        endOffset: mk.range.endOffset,
        exports: [],
        inherits: [],
        language: "opensim",
        resourceId: uri,
        metadata: {
          markerId: mk.id,
          bodyFrame: mk.bodyFrame,
          location: mk.location,
        },
      };
      symbols.set(symId, entry);
      addByName(mk.name, symId);
      addByName(mk.id, symId);
    }

    // 5. Index WrapObjects
    for (const w of doc.wrapObjects) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: w.name,
        kind: "Property",
        ruleName: "opensim_wrap_object",
        namePath: w.name,
        fieldName: null,
        parentId: null,
        startOffset: w.range.startOffset,
        endOffset: w.range.endOffset,
        exports: [],
        inherits: [],
        language: "opensim",
        resourceId: uri,
        metadata: {
          wrapId: w.id,
          wrapType: w.wrapType,
          bodyFrame: w.bodyFrame,
          radius: w.radius,
          length: w.length,
        },
      };
      symbols.set(symId, entry);
      addByName(w.name, symId);
      addByName(w.id, symId);
    }

    // 6. Index Constraints
    for (const c of doc.constraints) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: c.name,
        kind: "Event",
        ruleName: "opensim_constraint",
        namePath: c.name,
        fieldName: null,
        parentId: null,
        startOffset: c.range.startOffset,
        endOffset: c.range.endOffset,
        exports: [],
        inherits: [],
        language: "opensim",
        resourceId: uri,
        metadata: {
          constraintId: c.id,
          constraintType: c.constraintType,
          body1: c.body1,
          body2: c.body2,
        },
      };
      symbols.set(symId, entry);
      addByName(c.name, symId);
      addByName(c.id, symId);
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
