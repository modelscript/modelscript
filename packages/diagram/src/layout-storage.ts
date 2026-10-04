// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pluggable Diagram Layout & Spatial Coordinate Persistence Engine.
// Supports both SidecarStorage (.layout JSON files) and InlineAnnotationStorage (in-code AST annotations).

import type { FileSystemBridge } from "./fs-bridge.js";
import { createDefaultFsBridge } from "./fs-bridge.js";
import type { PlacementItem } from "./protocol.js";

export * from "./fs-bridge.js";

export interface ElementPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  /** Optional structural classification or rule name */
  ruleName?: string;
  /** Optional previous name tracked before a rename */
  previousName?: string;
}

export interface ConnectionLayout {
  vertices: { x: number; y: number }[];
}

export interface DiagramLayout {
  version: number;
  elements: Record<string, ElementPosition>;
  connections: Record<string, ConnectionLayout>;
}

export function createEmptyLayout(): DiagramLayout {
  return { version: 1, elements: {}, connections: {} };
}

export function parseLayout(content: string): DiagramLayout | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") {
      return {
        version: parsed.version ?? 1,
        elements: parsed.elements ?? {},
        connections: parsed.connections ?? {},
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeLayout(layout: DiagramLayout): string {
  return JSON.stringify(layout, null, 2) + "\n";
}

/**
 * Common Layout Storage interface for persisting visual coordinates.
 */
export interface DiagramLayoutStorage {
  loadLayout(uri: string): Promise<DiagramLayout | null>;
  saveLayout(uri: string, layout: DiagramLayout): Promise<void>;
  updatePositions(uri: string, items: PlacementItem[]): Promise<{ layout?: DiagramLayout; edits?: any[] }>;
  renameElement?(uri: string, oldName: string, newName: string): Promise<boolean>;
  pruneOrphans?(
    uri: string,
    activeNames: string[] | Set<string>,
  ): Promise<{ prunedCount: number; layout: DiagramLayout | null }>;
}

/**
 * Configuration options for SidecarLayoutStorage.
 */
export interface SidecarStorageOptions {
  /**
   * File extension for the sidecar file. Default: ".layout".
   */
  extension?: string;

  /**
   * Location policy:
   * - "alongside": `dir/Model.sysml` -> `dir/Model.sysml.layout` (Default)
   * - "hidden": `dir/Model.sysml` -> `dir/.Model.sysml.layout`
   * - "subfolder": `dir/Model.sysml` -> `dir/.layouts/Model.sysml.layout`
   * - Custom resolver function: `(uri: string, extension: string) => string`
   */
  location?: "alongside" | "hidden" | "subfolder" | ((uri: string, extension: string) => string);

  /**
   * Custom serializer function (object -> string). Default: JSON.stringify(..., null, 2).
   */
  serialize?: (layout: DiagramLayout) => string;

  /**
   * Custom parser function (string -> object). Default: JSON.parse.
   */
  parse?: (content: string) => DiagramLayout | null;

  /**
   * Pluggable file system bridge for environment-agnostic I/O.
   * Defaults to NodeFsBridge on Node.js and MemoryFsBridge in browser.
   */
  fsBridge?: FileSystemBridge;
}

/**
 * Resolves the sidecar URI for a given document URI based on SidecarStorageOptions.
 */
export function resolveSidecarUri(uri: string, options?: SidecarStorageOptions): string {
  const rawExt = options?.extension ?? ".layout";
  const ext = rawExt.startsWith(".") ? rawExt : `.${rawExt}`;
  const location = options?.location ?? "alongside";

  if (typeof location === "function") {
    return location(uri, ext);
  }

  // Split URI into directory and filename
  const lastSlash = uri.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : uri.substring(0, lastSlash + 1);
  let file = lastSlash === -1 ? uri : uri.substring(lastSlash + 1);

  // If the extension is compound and shares the file extension (e.g., uri ends with .sysml and ext is .sysml.layout),
  // strip the trailing extension from file so we get Vehicle.sysml.layout instead of Vehicle.sysml.sysml.layout.
  const dotIdx = file.lastIndexOf(".");
  if (dotIdx !== -1) {
    const docExt = file.substring(dotIdx);
    if (ext.startsWith(docExt + ".")) {
      file = file.substring(0, dotIdx);
    }
  }

  if (location === "alongside") {
    return `${dir}${file}${ext}`;
  }

  if (location === "hidden") {
    return `${dir}.${file}${ext}`;
  }

  if (location === "subfolder") {
    return `${dir}.layouts/${file}${ext}`;
  }

  return `${dir}${file}${ext}`;
}

/**
 * Sidecar Layout Storage: persists layout metadata into an external sidecar file.
 * Preferred for languages that do not encode graphical coordinates in their syntax (e.g. SysML v2, OWL2).
 */
export class SidecarLayoutStorage implements DiagramLayoutStorage {
  private cache = new Map<string, DiagramLayout>();
  private readonly options: SidecarStorageOptions;
  private readonly fsBridge: FileSystemBridge;

  constructor(options?: SidecarStorageOptions) {
    this.options = options ?? {};
    this.fsBridge = this.options.fsBridge ?? createDefaultFsBridge();
  }

  /**
   * Returns the resolved sidecar URI for the document URI.
   */
  getSidecarUri(docUri: string): string {
    return resolveSidecarUri(docUri, this.options);
  }

  async loadLayout(uri: string): Promise<DiagramLayout | null> {
    const cached = this.cache.get(uri);
    if (cached) return cached;

    const sidecarUri = this.getSidecarUri(uri);
    try {
      const content = await this.fsBridge.readFile(sidecarUri);
      if (content) {
        const parser = this.options.parse ?? parseLayout;
        const parsed = parser(content);
        if (parsed) {
          this.cache.set(uri, parsed);
          return parsed;
        }
      }
    } catch {
      // ignore read error
    }

    return null;
  }

  async saveLayout(uri: string, layout: DiagramLayout): Promise<void> {
    this.cache.set(uri, layout);
    const sidecarUri = this.getSidecarUri(uri);
    try {
      const serializer = this.options.serialize ?? serializeLayout;
      const content = serializer(layout);
      await this.fsBridge.writeFile(sidecarUri, content);
    } catch {
      // ignore write error
    }
  }

  async updatePositions(uri: string, items: PlacementItem[]): Promise<{ layout?: DiagramLayout; edits?: any[] }> {
    let layout = (await this.loadLayout(uri)) ?? createEmptyLayout();
    const updatedElements = { ...layout.elements };
    const updatedConnections = { ...layout.connections };

    for (const item of items) {
      const name = item.name ?? (item as any).componentName ?? (item as any).id;
      if (!name) continue;
      const x = item.x ?? (item as any).origin?.x ?? 0;
      const y = item.y ?? (item as any).origin?.y ?? 0;
      const width =
        item.width ??
        ((item as any).extent ? Math.abs((item as any).extent.p2.x - (item as any).extent.p1.x) : undefined);
      const height =
        item.height ??
        ((item as any).extent ? Math.abs((item as any).extent.p2.y - (item as any).extent.p1.y) : undefined);

      updatedElements[name] = {
        ...updatedElements[name],
        x: Math.round(x),
        y: Math.round(y),
        width: width ? Math.round(width) : undefined,
        height: height ? Math.round(height) : undefined,
        ...(item.rotation !== undefined ? { rotation: Math.round(item.rotation) } : {}),
      };

      if (item.edges) {
        for (const e of item.edges) {
          updatedConnections[`${e.source}→${e.target}`] = {
            vertices: e.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
          };
        }
      }
    }

    layout = {
      ...layout,
      elements: updatedElements,
      connections: updatedConnections,
    };

    await this.saveLayout(uri, layout);
    return { layout, edits: [] };
  }

  /**
   * Synchronizes a symbol rename in the sidecar layout file.
   * Migrates the element coordinates and rewrites connection endpoint keys.
   */
  async renameElement(uri: string, oldName: string, newName: string): Promise<boolean> {
    const layout = await this.loadLayout(uri);
    if (!layout || !layout.elements[oldName]) {
      return false;
    }

    const updatedElements = { ...layout.elements };
    const oldPos = updatedElements[oldName]!;
    updatedElements[newName] = {
      ...oldPos,
      previousName: oldName,
    };
    Reflect.deleteProperty(updatedElements, oldName);

    // Rewrite connection keys referencing oldName
    const updatedConnections: Record<string, ConnectionLayout> = {};
    for (const [key, val] of Object.entries(layout.connections)) {
      let newKey = key;
      // Match "OldName.port" or "OldName→" or "→OldName"
      if (key.includes(oldName)) {
        newKey = key.replace(new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g"), newName);
      }
      updatedConnections[newKey] = val;
    }

    const newLayout: DiagramLayout = {
      ...layout,
      elements: updatedElements,
      connections: updatedConnections,
    };

    await this.saveLayout(uri, newLayout);
    return true;
  }

  /**
   * Prunes orphaned element and connection entries that no longer exist in the source document.
   */
  async pruneOrphans(
    uri: string,
    activeNames: string[] | Set<string>,
  ): Promise<{ prunedCount: number; layout: DiagramLayout | null }> {
    const layout = await this.loadLayout(uri);
    if (!layout) return { prunedCount: 0, layout: null };

    const activeSet = activeNames instanceof Set ? activeNames : new Set(activeNames);
    const updatedElements: Record<string, ElementPosition> = {};
    let prunedCount = 0;

    for (const [name, pos] of Object.entries(layout.elements)) {
      if (activeSet.has(name)) {
        updatedElements[name] = pos;
      } else {
        prunedCount++;
      }
    }

    if (prunedCount === 0) {
      return { prunedCount: 0, layout };
    }

    // Prune connections with endpoints that were removed
    const updatedConnections: Record<string, ConnectionLayout> = {};
    for (const [connKey, connVal] of Object.entries(layout.connections)) {
      const parts = connKey.split("→");
      if (parts.length === 2) {
        const srcBase = parts[0]!.split(".")[0]!;
        const tgtBase = parts[1]!.split(".")[0]!;
        if (activeSet.has(srcBase) && activeSet.has(tgtBase)) {
          updatedConnections[connKey] = connVal;
        }
      } else {
        updatedConnections[connKey] = connVal;
      }
    }

    const newLayout: DiagramLayout = {
      ...layout,
      elements: updatedElements,
      connections: updatedConnections,
    };

    await this.saveLayout(uri, newLayout);
    return { prunedCount, layout: newLayout };
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inline Annotation Layout Storage: persists layout metadata directly into source code annotations
 * via LSP TextEdit mutations (e.g. Modelica `annotation(Placement(...))`).
 */
export class InlineAnnotationLayoutStorage implements DiagramLayoutStorage {
  constructor(private readonly editComputer: (uri: string, items: PlacementItem[]) => Promise<any[]> | any[]) {}

  async loadLayout(_uri: string): Promise<DiagramLayout | null> {
    return null;
  }

  async saveLayout(_uri: string, _layout: DiagramLayout): Promise<void> {}

  async updatePositions(uri: string, items: PlacementItem[]): Promise<{ layout?: DiagramLayout; edits?: any[] }> {
    const edits = await this.editComputer(uri, items);
    return { edits };
  }
}
