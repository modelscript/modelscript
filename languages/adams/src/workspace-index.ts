// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseAdams } from "./parser/adams-parser.js";
import type { AdamsDataset } from "./types.js";

/**
 * Multi-File Workspace Indexer for MSC Adams models (.adm, .cmd, .acf).
 * Resolves parts, markers, joints, forces, and motions across files.
 */
export class AdamsWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDatasets = new Map<string, AdamsDataset>();
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

  public getDataset(uri: string): AdamsDataset | undefined {
    return this.fileDatasets.get(uri);
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

    const dataset = parseAdams(text, uri);
    this.fileDatasets.set(uri, dataset);

    // Root Multibody Model Symbol
    const rootId = idCounter++ as SymbolId;
    const modelName = dataset.title || "AdamsMechanism";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: modelName,
      kind: "Class",
      ruleName: "adams_dataset",
      namePath: modelName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "adams",
      resourceId: uri,
      metadata: {
        numParts: dataset.parts.size,
        numMarkers: dataset.markers.size,
        numJoints: dataset.joints.size,
        numForces: dataset.forces.size,
        numMotions: dataset.motions.size,
      },
    };
    symbols.set(rootId, rootEntry);
    byName.set(modelName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    const addChild = (name: string, kind: string, meta?: any, startOffset = 0, endOffset = 0) => {
      const id = idCounter++ as SymbolId;
      const entry: SymbolEntry = {
        id,
        name,
        kind: kind as any,
        ruleName: "adams_element",
        namePath: `${modelName}.${name}`,
        fieldName: null,
        parentId: rootId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "adams",
        resourceId: uri,
        metadata: meta,
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    };

    // Index Parts
    for (const [pId, part] of dataset.parts.entries()) {
      addChild(
        part.name,
        "Variable",
        {
          id: pId,
          isGround: part.isGround,
          mass: part.mass,
          inertia: part.inertia,
        },
        part.range?.startOffset ?? 0,
        part.range?.endOffset ?? 0,
      );
    }

    // Index Markers
    for (const [mId, marker] of dataset.markers.entries()) {
      addChild(
        marker.name,
        "Field",
        {
          id: mId,
          partId: marker.partId,
          position: marker.position,
          orientation: marker.orientation,
        },
        marker.range?.startOffset ?? 0,
        marker.range?.endOffset ?? 0,
      );
    }

    // Index Joints
    for (const [jId, joint] of dataset.joints.entries()) {
      addChild(
        joint.name,
        "Method",
        {
          id: jId,
          type: joint.type,
          iMarker: joint.iMarkerId,
          jMarker: joint.jMarkerId,
          dof: joint.dofCount,
        },
        joint.range?.startOffset ?? 0,
        joint.range?.endOffset ?? 0,
      );
    }

    // Index Forces
    for (const [fId, force] of dataset.forces.entries()) {
      addChild(
        force.name,
        "Property",
        {
          id: fId,
          type: force.type,
          stiffness: force.stiffness,
          damping: force.damping,
        },
        force.range?.startOffset ?? 0,
        force.range?.endOffset ?? 0,
      );
    }

    // Index Motions
    for (const [motId, mot] of dataset.motions.entries()) {
      addChild(
        mot.name,
        "Event",
        {
          id: motId,
          type: mot.type,
          function: mot.functionExpr,
        },
        mot.range?.startOffset ?? 0,
        mot.range?.endOffset ?? 0,
      );
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public removeFile(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileDatasets.delete(uri);
    this.fileBaseIds.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDatasets.clear();
    this.fileBaseIds.clear();
  }

  public getSymbols(): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    for (const fileIndex of this.fileIndices.values()) {
      for (const [id, entry] of fileIndex.symbols) {
        symbols.set(id, entry);
      }
      for (const [name, ids] of fileIndex.byName) {
        const existing = byName.get(name) ?? [];
        byName.set(name, existing.concat(ids));
      }
      for (const [parentId, cIds] of fileIndex.childrenOf) {
        const existing = childrenOf.get(parentId) ?? [];
        childrenOf.set(parentId, existing.concat(cIds));
      }
    }

    return { symbols, byName, childrenOf };
  }
}
