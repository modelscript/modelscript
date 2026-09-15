// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pluggable Diagram Layout & Spatial Coordinate Persistence Engine.
// Supports both SidecarStorage (.layout JSON files) and InlineAnnotationStorage (in-code AST annotations).

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { PlacementItem } from "./protocol.js";

export interface ElementPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
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
  return JSON.stringify(layout, null, 2);
}

/**
 * Common Layout Storage interface for persisting visual coordinates.
 */
export interface DiagramLayoutStorage {
  loadLayout(uri: string): Promise<DiagramLayout | null>;
  saveLayout(uri: string, layout: DiagramLayout): Promise<void>;
  updatePositions(uri: string, items: PlacementItem[]): Promise<{ layout?: DiagramLayout; edits?: any[] }>;
}

/**
 * Sidecar Layout Storage: persists layout metadata into an external `.layout` JSON file.
 * Preferred for languages that do not encode graphical coordinates in their syntax (e.g. SysML v2).
 */
export class SidecarLayoutStorage implements DiagramLayoutStorage {
  private cache = new Map<string, DiagramLayout>();

  private getLayoutPath(uri: string): string | null {
    if (typeof uri === "string" && uri.startsWith("file://")) {
      try {
        return fileURLToPath(`${uri}.layout`);
      } catch {
        return null;
      }
    }
    return null;
  }

  async loadLayout(uri: string): Promise<DiagramLayout | null> {
    const cached = this.cache.get(uri);
    if (cached) return cached;

    const path = this.getLayoutPath(uri);
    if (path && fs.existsSync(path)) {
      try {
        const content = fs.readFileSync(path, "utf-8");
        const parsed = parseLayout(content);
        if (parsed) {
          this.cache.set(uri, parsed);
          return parsed;
        }
      } catch {
        // ignore read error
      }
    }
    return null;
  }

  async saveLayout(uri: string, layout: DiagramLayout): Promise<void> {
    this.cache.set(uri, layout);
    const path = this.getLayoutPath(uri);
    if (path) {
      try {
        fs.writeFileSync(path, serializeLayout(layout), "utf-8");
      } catch {
        // ignore write error
      }
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
        x: Math.round(x),
        y: Math.round(y),
        width: width ? Math.round(width) : undefined,
        height: height ? Math.round(height) : undefined,
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
}

/**
 * Inline Annotation Layout Storage: persists layout metadata directly into source code annotations
 * via LSP TextEdit mutations (e.g. Modelica `annotation(Placement(...))`).
 */
export class InlineAnnotationLayoutStorage implements DiagramLayoutStorage {
  constructor(private readonly editComputer: (uri: string, items: PlacementItem[]) => Promise<any[]> | any[]) {}

  async loadLayout(_uri: string): Promise<DiagramLayout | null> {
    // Coordinates are parsed directly from CST/AST source annotations
    return null;
  }

  async saveLayout(_uri: string, _layout: DiagramLayout): Promise<void> {
    // In-line storage operates via document TextEdits
  }

  async updatePositions(uri: string, items: PlacementItem[]): Promise<{ layout?: DiagramLayout; edits?: any[] }> {
    const edits = await this.editComputer(uri, items);
    return { edits };
  }
}
