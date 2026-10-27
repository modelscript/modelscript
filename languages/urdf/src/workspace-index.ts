// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseUrdf } from "./parser/urdf-parser.js";
import type { UrdfRobot } from "./types.js";

/**
 * Multi-File Workspace Indexer for ROS URDF, SDFormat, and Xacro files (.urdf, .sdf, .xacro).
 * Resolves links, joints, materials, and transmissions across workspaces.
 */
export class UrdfWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileRobots = new Map<string, UrdfRobot>();
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

  public getRobot(uri: string): UrdfRobot | undefined {
    return this.fileRobots.get(uri);
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

  public reindexDocument(
    uri: string,
    loader?: () => string | { sourceText?: string; text?: string } | null | undefined,
  ): void {
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

    const robot = parseUrdf(text, uri);
    this.fileRobots.set(uri, robot);

    // Root Robot Symbol
    const rootId = idCounter++ as SymbolId;
    const robotName = robot.name || "UrdfRobot";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: robotName,
      kind: "Class",
      ruleName: "urdf_robot",
      namePath: robotName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "urdf",
      resourceId: uri,
      metadata: {
        numLinks: robot.links.size,
        numJoints: robot.joints.size,
        numMaterials: robot.materials.size,
      },
    };
    symbols.set(rootId, rootEntry);
    byName.set(robotName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    const addChild = (name: string, kind: string, meta?: Record<string, unknown>, startOffset = 0, endOffset = 0) => {
      const id = idCounter++ as SymbolId;
      const entry: SymbolEntry = {
        id,
        name,
        kind,
        ruleName: "urdf_element",
        namePath: `${robotName}.${name}`,
        fieldName: null,
        parentId: rootId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "urdf",
        resourceId: uri,
        metadata: meta ?? {},
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    };

    // Index Links
    for (const link of robot.links.values()) {
      addChild(
        link.name,
        "Variable",
        {
          mass: link.inertial?.mass,
          hasVisuals: link.visuals.length > 0,
          hasCollisions: link.collisions.length > 0,
        },
        link.range?.startOffset ?? 0,
        link.range?.endOffset ?? 0,
      );
    }

    // Index Joints
    for (const joint of robot.joints.values()) {
      addChild(
        joint.name,
        "Method",
        {
          type: joint.type,
          parentLink: joint.parentLink,
          childLink: joint.childLink,
        },
        joint.range?.startOffset ?? 0,
        joint.range?.endOffset ?? 0,
      );
    }

    // Index Materials
    for (const mat of robot.materials.values()) {
      addChild(mat.name, "Property", { color: mat.color });
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public removeFile(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileRobots.delete(uri);
    this.fileBaseIds.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileRobots.clear();
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

  public findSymbolsByName(name: string): SymbolEntry[] {
    const all = this.getSymbols();
    const ids = all.byName.get(name) ?? [];
    return ids.map((id) => all.symbols.get(id)!).filter(Boolean);
  }
}
