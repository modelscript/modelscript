// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages `.sysml.layout` JSON sidecar files for SysML2 diagram layout persistence.
// SysML2 has no annotation-based placement (like Modelica's `Placement(...)`),
// so visual positions are stored in a separate JSON file alongside the `.sysml` source.

/**
 * Layout data for a single SysML2 element (node) in the diagram.
 */
export interface SysML2ElementLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/**
 * Layout data for a single SysML2 connection (edge) in the diagram.
 */
export interface SysML2ConnectionLayout {
  vertices: { x: number; y: number }[];
}

/**
 * Root layout structure for a `.sysml.layout` file.
 */
export interface SysML2Layout {
  version: 1;
  /** Maps element qualified name → position/size data */
  elements: Record<string, SysML2ElementLayout>;
  /** Maps connection id (source→target) → vertex data */
  connections: Record<string, SysML2ConnectionLayout>;
}

/**
 * Create an empty layout structure.
 */
export function createEmptyLayout(): SysML2Layout {
  return { version: 1, elements: {}, connections: {} };
}

/**
 * Parse a layout JSON string. Returns null if parse fails.
 */
export function parseLayout(json: string): SysML2Layout | null {
  try {
    const data = JSON.parse(json);
    if (data?.version !== 1) return null;
    return data as SysML2Layout;
  } catch {
    return null;
  }
}

/**
 * Serialize a layout structure to a pretty-printed JSON string.
 */
export function serializeLayout(layout: SysML2Layout): string {
  return JSON.stringify(layout, null, 2) + "\n";
}

/**
 * Compute the layout file URI from a `.sysml` document URI.
 * Example: `file:///path/to/Model.sysml` → `file:///path/to/Model.sysml.layout`
 */
export function layoutUriFromSysmlUri(sysmlUri: string): string {
  return `${sysmlUri}.layout`;
}

/**
 * Update element positions in the layout structure.
 * Returns a new layout (does not mutate the input).
 */
export function updateElementPositions(
  layout: SysML2Layout,
  updates: { name: string; x: number; y: number; width: number; height: number; rotation?: number }[],
): SysML2Layout {
  const newElements = { ...layout.elements };
  for (const item of updates) {
    newElements[item.name] = {
      x: Math.round(item.x),
      y: Math.round(item.y),
      width: Math.round(item.width),
      height: Math.round(item.height),
      ...(item.rotation ? { rotation: Math.round(item.rotation) } : {}),
    };
  }
  return { ...layout, elements: newElements };
}

/**
 * Update connection vertices in the layout structure.
 * Returns a new layout (does not mutate the input).
 */
export function updateConnectionVertices(
  layout: SysML2Layout,
  updates: { id: string; vertices: { x: number; y: number }[] }[],
): SysML2Layout {
  const newConnections = { ...layout.connections };
  for (const item of updates) {
    newConnections[item.id] = {
      vertices: item.vertices.map((v) => ({ x: Math.round(v.x), y: Math.round(v.y) })),
    };
  }
  return { ...layout, connections: newConnections };
}

/**
 * Remove elements and their connections from the layout.
 * Returns a new layout (does not mutate the input).
 */
export function removeElements(layout: SysML2Layout, names: string[]): SysML2Layout {
  const nameSet = new Set(names);
  const newElements = Object.fromEntries(Object.entries(layout.elements).filter(([name]) => !nameSet.has(name)));

  // Remove connections involving deleted elements
  const newConnections = Object.fromEntries(
    Object.entries(layout.connections).filter(([connId]) => {
      const parts = connId.split("→");
      return !parts.some((p) => nameSet.has(p.split(".")[0]));
    }),
  );

  return { ...layout, elements: newElements, connections: newConnections };
}
