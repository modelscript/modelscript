// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Visual Diff Graph & Anchor-Stabilized Merging Engine for ModelScript Diagrams.
// Computes an AST-aware visual delta between two diagram revisions (Base vs Head),
// classifying elements into added, deleted, modified, and unchanged states while
// preserving the reviewer's spatial mental map.

import { computeIncrementalStabilization, type NodePosition } from "./incremental-layout.js";
import type { CoordinateSystem, DiagramData, DiagramEdge, DiagramNode, X6Markup } from "./protocol.js";

export type DiffStatus = "added" | "deleted" | "modified" | "unchanged";

export interface VisualPropertyDiff {
  key: string;
  oldValue?: any;
  newValue?: any;
  isBreaking: boolean;
}

export interface VisualDiffNode extends DiagramNode {
  diffStatus: DiffStatus;
  isBreaking?: boolean;
  propertyChanges?: VisualPropertyDiff[];
  oldCoordinates?: { x: number; y: number };
  diffLabel?: string;
}

export interface VisualDiffEdge extends DiagramEdge {
  diffStatus: DiffStatus;
  isBreaking?: boolean;
  oldSource?: { cell: string; port?: string };
  oldTarget?: { cell: string; port?: string };
  diffLabel?: string;
}

export interface VisualDiffStats {
  addedNodes: number;
  deletedNodes: number;
  modifiedNodes: number;
  unchangedNodes: number;
  breakingChanges: number;
  addedEdges: number;
  deletedEdges: number;
  modifiedEdges: number;
  unchangedEdges: number;
}

export interface VisualDiffData {
  nodes: VisualDiffNode[];
  edges: VisualDiffEdge[];
  coordinateSystem: CoordinateSystem;
  diagramBackground: X6Markup | null;
  stats: VisualDiffStats;
  baseDiagram?: DiagramData | null;
  headDiagram?: DiagramData | null;
}

export interface VisualDiffOptions {
  /**
   * Keys considered breaking if their value changes (e.g. "direction", "isAbstract", "type").
   */
  breakingKeys?: string[];

  /**
   * Keys to ignore during property diffing (e.g. "annotationClause", "description").
   */
  ignoredKeys?: string[];

  /**
   * Layout stabilization options.
   */
  padding?: number;
  iterations?: number;
}

const DEFAULT_BREAKING_KEYS = [
  "direction",
  "isAbstract",
  "typeName",
  "type",
  "multiplicity",
  "causality",
  "variability",
  "flowDirection",
];

const DEFAULT_IGNORED_KEYS = ["annotationClause", "documentation", "docInfo", "docRevisions"];

/**
 * Extracts a normalized matching key for a node (prefers properties.name or id).
 */
function getNodeKey(node: DiagramNode): string {
  const propName = node.properties?.values?.name || node.properties?.values?.id;
  if (propName && typeof propName === "string") return propName;
  if (node.id) return node.id;
  return "";
}

/**
 * Extracts source or target cell id from edge endpoint.
 */
function getEndpointCell(endpoint: any): string {
  if (!endpoint) return "";
  if (typeof endpoint === "string") return endpoint;
  return endpoint.cell || "";
}

/**
 * Extracts source or target port id from edge endpoint.
 */
function getEndpointPort(endpoint: any): string {
  if (!endpoint) return "";
  if (typeof endpoint === "object") return endpoint.port || "";
  return "";
}

/**
 * Builds an edge matching key from cell and port endpoints.
 */
function getEdgeKey(edge: DiagramEdge): string {
  const sCell = getEndpointCell(edge.source);
  const sPort = getEndpointPort(edge.source);
  const tCell = getEndpointCell(edge.target);
  const tPort = getEndpointPort(edge.target);
  return `${sCell}${sPort ? ":" + sPort : ""}-->${tCell}${tPort ? ":" + tPort : ""}`;
}

/**
 * Compares two property maps and extracts fine-grained deltas.
 */
function diffProperties(
  oldValues: Record<string, any> = {},
  newValues: Record<string, any> = {},
  breakingKeys: Set<string>,
  ignoredKeys: Set<string>,
): { propertyChanges: VisualPropertyDiff[]; isBreaking: boolean } {
  const propertyChanges: VisualPropertyDiff[] = [];
  let isBreaking = false;

  const allKeys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);

  for (const k of allKeys) {
    if (ignoredKeys.has(k)) continue;

    const oldV = oldValues[k];
    const newV = newValues[k];

    // Primitive or JSON equality check
    const isDifferent =
      typeof oldV === "object" || typeof newV === "object"
        ? JSON.stringify(oldV) !== JSON.stringify(newV)
        : oldV !== newV;

    if (isDifferent) {
      const keyBreaking = breakingKeys.has(k);
      if (keyBreaking) isBreaking = true;
      propertyChanges.push({
        key: k,
        oldValue: oldV,
        newValue: newV,
        isBreaking: keyBreaking,
      });
    }
  }

  return { propertyChanges, isBreaking };
}

/**
 * Constructs a unified, anchor-stabilized VisualDiffData model from Base and Head revisions.
 */
export function buildVisualDiffGraph(
  baseDiagram: DiagramData | null | undefined,
  headDiagram: DiagramData | null | undefined,
  options: VisualDiffOptions = {},
): VisualDiffData {
  const breakingKeys = new Set(options.breakingKeys || DEFAULT_BREAKING_KEYS);
  const ignoredKeys = new Set(options.ignoredKeys || DEFAULT_IGNORED_KEYS);

  const baseNodes = baseDiagram?.nodes || [];
  const headNodes = headDiagram?.nodes || [];
  const baseEdges = baseDiagram?.edges || [];
  const headEdges = headDiagram?.edges || [];

  const baseNodeMap = new Map<string, DiagramNode>();
  for (const n of baseNodes) {
    baseNodeMap.set(getNodeKey(n), n);
  }

  const headNodeMap = new Map<string, DiagramNode>();
  for (const n of headNodes) {
    headNodeMap.set(getNodeKey(n), n);
  }

  const stats: VisualDiffStats = {
    addedNodes: 0,
    deletedNodes: 0,
    modifiedNodes: 0,
    unchangedNodes: 0,
    breakingChanges: 0,
    addedEdges: 0,
    deletedEdges: 0,
    modifiedEdges: 0,
    unchangedEdges: 0,
  };

  const diffNodes: VisualDiffNode[] = [];
  const processedHeadKeys = new Set<string>();

  // 1. Process Base Nodes: check if deleted or retained (modified/unchanged)
  for (const [key, baseNode] of baseNodeMap) {
    const headNode = headNodeMap.get(key);

    if (!headNode) {
      // DELETED Node (existed in Base, missing in Head)
      stats.deletedNodes++;
      stats.breakingChanges++; // Deletion of architectural component is breaking
      diffNodes.push({
        ...baseNode,
        diffStatus: "deleted",
        isBreaking: true,
        diffLabel: "DELETED",
      });
    } else {
      // Node exists in both: check for modifications
      processedHeadKeys.add(key);

      const oldVals = baseNode.properties?.values || {};
      const newVals = headNode.properties?.values || {};
      const { propertyChanges, isBreaking: propBreaking } = diffProperties(oldVals, newVals, breakingKeys, ignoredKeys);

      // Check if port count or directions changed
      const oldPorts = baseNode.ports?.items || [];
      const newPorts = headNode.ports?.items || [];
      const portsModified = oldPorts.length !== newPorts.length;
      const isBreaking = propBreaking || portsModified;

      const isModified = propertyChanges.length > 0 || portsModified;

      if (isModified) {
        stats.modifiedNodes++;
        if (isBreaking) stats.breakingChanges++;
        diffNodes.push({
          ...headNode,
          diffStatus: "modified",
          isBreaking,
          propertyChanges,
          oldCoordinates: { x: baseNode.x, y: baseNode.y },
          diffLabel: isBreaking ? "MODIFIED (BREAKING)" : "MODIFIED",
        });
      } else {
        stats.unchangedNodes++;
        diffNodes.push({
          ...headNode,
          diffStatus: "unchanged",
          oldCoordinates: { x: baseNode.x, y: baseNode.y },
        });
      }
    }
  }

  // 2. Process remaining Head Nodes: ADDED nodes
  for (const [key, headNode] of headNodeMap) {
    if (!processedHeadKeys.has(key)) {
      stats.addedNodes++;
      diffNodes.push({
        ...headNode,
        diffStatus: "added",
        isBreaking: false,
        diffLabel: "ADDED",
      });
    }
  }

  // 3. Anchor-Preserving Layout Stabilization
  // Use Base positions as fixed anchors; stabilize incoming Head & Added nodes
  const existingPositions: NodePosition[] = baseNodes.map((n) => ({
    id: getNodeKey(n),
    x: n.x ?? 0,
    y: n.y ?? 0,
    width: n.width ?? 120,
    height: n.height ?? 60,
  }));

  const incomingPositions: NodePosition[] = diffNodes.map((n) => ({
    id: getNodeKey(n),
    x: n.x ?? 0,
    y: n.y ?? 0,
    width: n.width ?? 120,
    height: n.height ?? 60,
  }));

  const stabilizationEdges = headEdges.map((e) => ({
    source: getEndpointCell(e.source),
    target: getEndpointCell(e.target),
  }));

  const stabilizedPositions = computeIncrementalStabilization(
    existingPositions,
    incomingPositions,
    stabilizationEdges,
    {
      padding: options.padding ?? 32,
      iterations: options.iterations ?? 20,
    },
  );

  const posMap = new Map<string, NodePosition>();
  for (const sp of stabilizedPositions) {
    posMap.set(sp.id, sp);
  }

  // Apply stabilized coordinates
  for (const n of diffNodes) {
    const key = getNodeKey(n);
    const pos = posMap.get(key);
    if (pos) {
      n.x = pos.x;
      n.y = pos.y;
      n.width = pos.width;
      n.height = pos.height;
    }
  }

  // 4. Process Edges
  const baseEdgeMap = new Map<string, DiagramEdge>();
  for (const e of baseEdges) {
    baseEdgeMap.set(getEdgeKey(e), e);
  }

  const headEdgeMap = new Map<string, DiagramEdge>();
  for (const e of headEdges) {
    headEdgeMap.set(getEdgeKey(e), e);
  }

  const diffEdges: VisualDiffEdge[] = [];
  const processedHeadEdgeKeys = new Set<string>();

  for (const [key, baseEdge] of baseEdgeMap) {
    const headEdge = headEdgeMap.get(key);

    if (!headEdge) {
      // DELETED Edge
      stats.deletedEdges++;
      stats.breakingChanges++;
      diffEdges.push({
        ...baseEdge,
        diffStatus: "deleted",
        isBreaking: true,
        diffLabel: "DISCONNECTED",
      });
    } else {
      // UNCHANGED Edge
      processedHeadEdgeKeys.add(key);
      stats.unchangedEdges++;
      diffEdges.push({
        ...headEdge,
        diffStatus: "unchanged",
      });
    }
  }

  for (const [key, headEdge] of headEdgeMap) {
    if (!processedHeadEdgeKeys.has(key)) {
      // ADDED Edge
      stats.addedEdges++;
      diffEdges.push({
        ...headEdge,
        diffStatus: "added",
        isBreaking: false,
        diffLabel: "CONNECTED",
      });
    }
  }

  // 5. Calculate bounding coordinate system encompassing all nodes
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of diffNodes) {
    const nx = n.x ?? 0;
    const ny = n.y ?? 0;
    const nw = n.width ?? 120;
    const nh = n.height ?? 60;

    minX = Math.min(minX, nx);
    minY = Math.min(minY, ny);
    maxX = Math.max(maxX, nx + nw);
    maxY = Math.max(maxY, ny + nh);
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const padding = options.padding ?? 40;
  const coordinateSystem: CoordinateSystem = {
    x: Math.floor(minX - padding),
    y: Math.floor(minY - padding),
    width: Math.ceil(maxX - minX + padding * 2),
    height: Math.ceil(maxY - minY + padding * 2),
  };

  return {
    nodes: diffNodes,
    edges: diffEdges,
    coordinateSystem,
    diagramBackground: headDiagram?.diagramBackground || baseDiagram?.diagramBackground || null,
    stats,
    baseDiagram,
    headDiagram,
  };
}
