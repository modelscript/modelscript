// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Canonical type definitions for the ModelScript Diagram API.
// All diagram-related types, method constants, and request/response shapes
// live here. Clients and server implementations import from this file.

import type { TextEdit } from "vscode-languageserver-protocol";

// ── LSP Method Constants ──

export const DiagramMethods = {
  /** Read diagram data for rendering */
  getData: "modelscript/diagram.getData",
  /** Apply a batch of diagram edit actions atomically */
  applyEdits: "modelscript/diagram.applyEdits",
  /** Get component properties on-demand (lazy loading) */
  getComponentProperties: "modelscript/diagram.getComponentProperties",
} as const;

// ── Shared Value Types ──

export interface Point {
  x: number;
  y: number;
}

export interface EdgeUpdate {
  source: string;
  target: string;
  points: Point[];
}

export interface PlacementItem {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  edges?: EdgeUpdate[];
  connectedOnly?: boolean;
}

// ── X6 Markup (DOM-free SVG tree for webview rendering) ──

export interface X6Markup {
  tagName: string;
  selector?: string;
  groupSelector?: string;
  attrs?: Record<string, string | number | undefined>;
  children?: X6Markup[];
  textContent?: string;
}

// ── Diagram Data (read model) ──

export interface ComponentPropertyData {
  classKind?: string;
  className: string;
  name: string;
  description: string;
  parameters: {
    name: string;
    value: string;
    description?: string;
    isBoolean?: boolean;
    unit?: string;
  }[];
  docInfo?: string;
  docRevisions?: string;
  iconSvg?: string;
}

export interface DiagramPort {
  id: string;
  group: string;
  args: { x: number; y: number; angle: number };
  markup: X6Markup;
}

export interface DiagramNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  zIndex: number;
  markup: X6Markup;
  ports: {
    items: DiagramPort[];
    groups: Record<string, { position: string; zIndex: number }>;
  };
  properties?: ComponentPropertyData;
  autoLayout?: boolean;
}

export interface DiagramEdge {
  id: string;
  source: { cell: string; port: string; anchor: string; connectionPoint: { name: string } };
  target: { cell: string; port: string; anchor: string; connectionPoint: { name: string } };
  vertices?: { x: number; y: number }[];
  connector?: string;
  zIndex: number;
  attrs: {
    line: {
      stroke: string;
      strokeWidth: number;
      strokeDasharray?: string;
      sourceMarker?: unknown;
      targetMarker?: unknown;
      "vector-effect": string;
      "pointer-events": string;
    };
  };
}

export interface CoordinateSystem {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  coordinateSystem: CoordinateSystem;
  diagramBackground: X6Markup | null;
  isLoading?: boolean;
}

// ── Diagram Edit Actions ──

export type DiagramEditAction =
  | { type: "move"; items: PlacementItem[] }
  | { type: "resize"; item: PlacementItem }
  | { type: "rotate"; item: PlacementItem }
  | { type: "connect"; source: string; target: string; points?: Point[] }
  | { type: "disconnect"; source: string; target: string }
  | { type: "moveEdge"; edges: EdgeUpdate[] }
  | { type: "addComponent"; className: string; x: number; y: number }
  | { type: "deleteComponents"; names: string[] }
  | { type: "updateName"; oldName: string; newName: string }
  | { type: "updateDescription"; name: string; description: string }
  | { type: "updateParameter"; name: string; parameter: string; value: string };

// ── Request / Response Types ──

// getData
export interface DiagramGetDataParams {
  uri: string;
  className?: string;
  /** One of "All" | "BDD" | "IBD" | "StateMachine". Accepts string for LSP wire compat. */
  diagramType?: string;
}

// applyEdits
export interface DiagramApplyEditsParams {
  uri: string;
  /** Monotonically increasing sequence number from the client */
  seq: number;
  /** Batch of actions to apply atomically */
  actions: DiagramEditAction[];
}

export interface DiagramApplyEditsResult {
  /** Echo back the request seq so the client can correlate */
  seq: number;
  /** LSP TextEdits to apply to the document */
  edits: TextEdit[];
  /** Hint to the client on how to react after applying edits */
  renderHint: "none" | "immediate" | "debounced";
}

// getComponentProperties
export interface DiagramGetComponentPropertiesParams {
  uri: string;
  componentName: string;
  className?: string;
}

// ── Backward Compatibility Aliases ──
// These maintain compatibility with code importing DiagramEditRequest/DiagramEditResponse.

/** @deprecated Use DiagramApplyEditsParams */
export type DiagramEditRequest = DiagramApplyEditsParams;

/** @deprecated Use DiagramApplyEditsResult */
export type DiagramEditResponse = DiagramApplyEditsResult;
