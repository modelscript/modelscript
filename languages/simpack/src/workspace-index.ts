// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseSimDeck } from "./parser/sim-deck-parser.js";
import { parseSpckXml } from "./parser/spck-xml-parser.js";
import type { SimpackModel } from "./types.js";

/**
 * Multi-File Workspace Indexer for SIMPACK models (.spck, .sim, .mbs).
 * Resolves bodies, markers, joints, and forces across workspaces.
 */
export class SimpackWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, SimpackModel>();
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

  public getModel(uri: string): SimpackModel | undefined {
    return this.fileModels.get(uri);
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

    const isXml = text.trimStart().startsWith("<");
    const parsedModel = isXml ? parseSpckXml(text, uri) : parseSimDeck(text, uri);
    this.fileModels.set(uri, parsedModel);

    // Root Multibody Model Symbol
    const rootId = idCounter++ as SymbolId;
    const modelName = parsedModel.name || "SimpackMechanism";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: modelName,
      kind: "Class",
      ruleName: "simpack_model",
      namePath: modelName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "simpack",
      resourceId: uri,
      metadata: {
        numBodies: parsedModel.bodies.size,
        numMarkers: parsedModel.markers.size,
        numJoints: parsedModel.joints.size,
        numForces: parsedModel.forces.size,
      },
    };
    symbols.set(rootId, rootEntry);
    byName.set(modelName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    function addChild(name: string, kind: string, meta?: any) {
      const id = idCounter++ as SymbolId;
      const entry: SymbolEntry = {
        id,
        name,
        kind: kind as any,
        ruleName: "simpack_element",
        namePath: `${modelName}.${name}`,
        fieldName: null,
        parentId: rootId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "simpack",
        resourceId: uri,
        metadata: meta,
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    }

    for (const [bId, body] of parsedModel.bodies.entries()) {
      addChild(bId, "Component", { type: "body", mass: body.mass, inertia: body.inertia });
    }

    for (const [mId, marker] of parsedModel.markers.entries()) {
      addChild(mId, "Component", { type: "marker", body: marker.bodyId, pos: marker.position });
    }

    for (const [jId, joint] of parsedModel.joints.entries()) {
      addChild(jId, "Component", { type: "joint", jointType: joint.type, from: joint.fromMarker, to: joint.toMarker });
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  /**
   * Merges multiple SIMPACK sub-models or sub-assemblies into a unified multibody model across workspace files.
   */
  public mergeAssembly(mainModel: SimpackModel, subModelUris: string[]): SimpackModel {
    const merged: SimpackModel = {
      name: mainModel.name,
      bodies: new Map(mainModel.bodies),
      markers: new Map(mainModel.markers),
      joints: new Map(mainModel.joints),
      forces: new Map(mainModel.forces),
    };

    for (const subUri of subModelUris) {
      const sub = this.fileModels.get(subUri);
      if (!sub) continue;
      const prefix = sub.name || "sub";

      for (const [id, body] of sub.bodies.entries()) {
        merged.bodies.set(`${prefix}.${id}`, {
          ...body,
          id: `${prefix}.${id}`,
          name: `${prefix}.${body.name}`,
          markerId: `${prefix}.${body.markerId}`,
        });
      }
      for (const [id, marker] of sub.markers.entries()) {
        const bodyId = marker.bodyId === "$inertial" ? "$inertial" : `${prefix}.${marker.bodyId}`;
        merged.markers.set(`${prefix}.${id}`, {
          ...marker,
          id: `${prefix}.${id}`,
          name: `${prefix}.${marker.name}`,
          bodyId,
        });
      }
      for (const [id, joint] of sub.joints.entries()) {
        merged.joints.set(`${prefix}.${id}`, {
          ...joint,
          id: `${prefix}.${id}`,
          name: `${prefix}.${joint.name}`,
          fromMarker: `${prefix}.${joint.fromMarker}`,
          toMarker: `${prefix}.${joint.toMarker}`,
        });
      }
      for (const [id, force] of sub.forces.entries()) {
        merged.forces.set(`${prefix}.${id}`, {
          ...force,
          id: `${prefix}.${id}`,
          name: `${prefix}.${force.name}`,
          markerA: `${prefix}.${force.markerA}`,
          markerB: `${prefix}.${force.markerB}`,
        });
      }
    }

    return merged;
  }
}
