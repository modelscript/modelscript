// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseGensysDeck } from "./parser/deck-parser.js";
import type { GensysModel } from "./types.js";

/**
 * Multi-File Workspace Indexer for GENSYS models.
 * Resolves vehicle bodies, wheelsets, spring-damper couplings, and subsystem inclusions (.sub).
 */
export class GensysWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, GensysModel>();
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

  public getModel(uri: string): GensysModel | undefined {
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

    const parsedModel = parseGensysDeck(text, uri);
    this.fileModels.set(uri, parsedModel);

    // Root Vehicle Model Symbol
    const rootId = idCounter++ as SymbolId;
    const modelName = parsedModel.name || "GensysVehicle";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: modelName,
      kind: "Class",
      ruleName: "gensys_model",
      namePath: modelName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "gensys",
      resourceId: uri,
      metadata: {
        numBodies: parsedModel.bodies.size,
        numWheelsets: parsedModel.wheelsets.size,
        numCouplings: parsedModel.couplings.size,
        subsystems: parsedModel.subsystems,
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
        ruleName: "gensys_element",
        namePath: `${modelName}.${name}`,
        fieldName: null,
        parentId: rootId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "gensys",
        resourceId: uri,
        metadata: meta,
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    }

    for (const [bName, body] of parsedModel.bodies.entries()) {
      addChild(bName, "Component", { type: "body", mass: body.mass, inertia: body.inertia });
    }

    for (const [wName, ws] of parsedModel.wheelsets.entries()) {
      addChild(wName, "Component", { type: "wheelset", gauge: ws.gauge, radius: ws.wheelRadius });
    }

    for (const [sName, s] of parsedModel.couplings.entries()) {
      addChild(sName, "Component", { type: "spring_damper", body1: s.body1, body2: s.body2 });
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  /**
   * Resolves and deeply merges all referenced child subsystems (sub <name>)
   * into a unified vehicle model assembly across indexed workspace files.
   */
  public resolveSubsystems(mainModel: GensysModel, currentUri?: string): GensysModel {
    if (!mainModel.subsystems || mainModel.subsystems.length === 0) {
      return mainModel;
    }

    const resolved: GensysModel = {
      name: mainModel.name,
      subsystems: [...mainModel.subsystems],
      bodies: new Map(mainModel.bodies),
      couplings: new Map(mainModel.couplings),
      wheelsets: new Map(mainModel.wheelsets),
    };

    for (const subName of mainModel.subsystems) {
      // Find matching model across indexed files
      let subModel: GensysModel | undefined;
      for (const [uri, m] of this.fileModels.entries()) {
        if (uri === currentUri) continue;
        const baseName = uri.split("/").pop()?.split(".")[0];
        if (baseName === subName || m.name === subName) {
          subModel = m;
          break;
        }
      }

      if (!subModel) continue;

      // Merge bodies with prefix
      for (const [bName, body] of subModel.bodies.entries()) {
        const prefixedName = `${subName}.${bName}`;
        resolved.bodies.set(prefixedName, {
          ...body,
          name: prefixedName,
        });
      }

      // Merge wheelsets with prefix
      for (const [wName, ws] of subModel.wheelsets.entries()) {
        const prefixedName = `${subName}.${wName}`;
        resolved.wheelsets.set(prefixedName, {
          ...ws,
          name: prefixedName,
        });
      }

      // Merge couplings with prefix, re-binding internal bodies
      for (const [sName, s] of subModel.couplings.entries()) {
        const prefixedName = `${subName}.${sName}`;
        const b1 = s.body1 === "ground" || mainModel.bodies.has(s.body1) ? s.body1 : `${subName}.${s.body1}`;
        const b2 = s.body2 === "ground" || mainModel.bodies.has(s.body2) ? s.body2 : `${subName}.${s.body2}`;

        resolved.couplings.set(prefixedName, {
          ...s,
          name: prefixedName,
          body1: b1,
          body2: b2,
        });
      }
    }

    return resolved;
  }
}
