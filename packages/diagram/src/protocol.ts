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
  /** Get schema-driven property definitions */
  getPropertySchema: "modelscript/diagram.getPropertySchema",
  /** Drill down into child subsystem / component diagram */
  drillDown: "modelscript/diagram.drillDown",
  /** Get palette / stencils for diagram toolbox */
  getPalette: "modelscript/diagram.getPalette",
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
  rotation?: number;
  edges?: EdgeUpdate[];
  connectedOnly?: boolean;
}

// ── X6 Markup (DOM-free SVG tree for webview rendering) ──

export interface X6Markup {
  tagName: string;
  selector?: string;
  groupSelector?: string;
  attrs?: Record<string, string | number>;
  style?: Record<string, string | number>;
  className?: string;
  children?: X6Markup[];
  textContent?: string;
}

// ── Property Inspector Schema ──

/** Supported field input kinds in the property inspector */
export type PropertyFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "expression"
  | "choice"
  | "quantity"
  | "typeReference"
  | "codeBlock"
  | "color"
  | "filePicker"
  | "table";

export interface PropertyChoiceOption {
  label: string;
  value: any;
  description?: string;
  icon?: string;
}

export interface PropertyFieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  validate?: (value: any, ctx: any) => string | null;
}

export interface PropertyFieldConfig {
  key: string;
  label: string;
  kind: PropertyFieldKind;
  description?: string;
  placeholder?: string;
  defaultValue?: any;
  unit?: string;
  choices?: (string | PropertyChoiceOption)[];
  enabledIf?: string;
  visibleIf?: string;
  required?: boolean;
  validation?: PropertyFieldValidation;
  readOnly?: boolean;
}

export interface PropertyGroupConfig {
  id: string;
  label: string;
  description?: string;
  collapsedByDefault?: boolean;
  visibleIf?: string;
  fields: PropertyFieldConfig[];
}

export interface PropertyTabConfig {
  id: string;
  label: string;
  icon?: string;
  visibleIf?: string;
  groups: PropertyGroupConfig[];
}

export interface EntityPropertySchema {
  title?: string;
  icon?: string;
  tabs: PropertyTabConfig[];
}

// ── Diagram Data (read model) ──

export interface ComponentPropertyData {
  classKind?: string;
  className: string;
  localizedClassName?: string;
  name: string;
  localizedName?: string;
  description: string;
  localizedDescription?: string;
  parameters: {
    name: string;
    localizedName?: string;
    value: string;
    defaultValue?: string;
    description?: string;
    localizedDescription?: string;
    isBoolean?: boolean;
    unit?: string;
    tab?: string;
    group?: string;
    enable?: string;
  }[];
  documentation?: {
    info?: string;
    revisions?: string;
  };
  docInfo?: string;
  docRevisions?: string;
  iconSvg?: string;
  icon?: string;
  /** Structured schema-driven property definition */
  schema?: EntityPropertySchema;
  /** Property values map (key -> value) */
  values?: Record<string, any>;
  /** Validation error map (key -> error message) */
  errors?: Record<string, string>;
}

export interface DiagramPort {
  id: string;
  group: string;
  args: { x: number; y: number; angle: number };
  markup: X6Markup;
}

export interface ReactiveAnimationBinding {
  componentName: string;
  property: string;
  variableName: string;
  transform?: string;
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
  animations?: ReactiveAnimationBinding[];
  compartments?: {
    header: string;
    entries: string[];
  }[];
  attrs?: any;
  data?: any;
}

export interface DiagramEdge {
  id: string;
  source: { cell: string; port: string; anchor: string; connectionPoint: { name: string } };
  target: { cell: string; port: string; anchor: string; connectionPoint: { name: string } };
  vertices?: { x: number; y: number }[];
  connector?: string;
  router?: string;
  zIndex: number;
  animations?: ReactiveAnimationBinding[];
  style?: any;
  labels?: any[];
  attrs: {
    line: {
      stroke: string;
      strokeWidth: number;
      strokeDasharray?: string;
      sourceMarker?: any;
      targetMarker?: any;
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
  | {
      type: "connect";
      source: string;
      target: string;
      points?: Point[];
      edgeType?: string;
      sourcePort?: string;
      targetPort?: string;
      section?: string;
    }
  | { type: "disconnect"; source: string; target: string; edgeType?: string }
  | { type: "move"; items: PlacementItem[] }
  | { type: "resize"; item: PlacementItem }
  | { type: "rotate"; item: PlacementItem }
  | { type: "moveEdge"; edges: EdgeUpdate[] }
  | { type: "addComponent"; className: string; x: number; y: number; name?: string; section?: string }
  | { type: "deleteComponents"; names: string[] }
  | {
      type: "reconnect";
      edgeId?: string;
      oldSource: string;
      oldTarget: string;
      newSource: string;
      newTarget: string;
      oldSourcePort?: string;
      oldTargetPort?: string;
      newSourcePort?: string;
      newTargetPort?: string;
      edgeType?: string;
      section?: string;
    }
  | { type: "updateName"; oldName: string; newName: string }
  | { type: "updateDescription"; name: string; description: string }
  | { type: "updateParameter"; name: string; parameter: string; value: string }
  | { type: "updateProperty"; name: string; key: string; value: any; previousValue?: any };

// ── SVG Export Options ──

export interface SvgExportOptions {
  theme?: "dark" | "light";
  padding?: number;
  scale?: number;
  embedFonts?: boolean;
  background?: string;
}

// ── Stencil / Palette ──

export interface DiagramPaletteItem {
  label: string;
  className: string;
  iconSvg?: string;
  description?: string;
  defaultProps?: Record<string, any>;
}

export interface DiagramPaletteCategory {
  name: string;
  items: DiagramPaletteItem[];
}

export interface DiagramPalette {
  categories: DiagramPaletteCategory[];
}

export interface DiagramGetPaletteParams {
  uri: string;
}

// ── Drill-Down Navigation ──

export interface DiagramDrillDownParams {
  uri: string;
  componentId?: string;
  className?: string;
  componentName?: string;
  nodeId?: string;
}

export interface DiagramDrillDownResult {
  data: DiagramData | null;
  breadcrumbs: { id: string; label: string; uri?: string }[];
  targetUri?: string;
  targetClassName?: string;
}

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

// exportDiagram
export interface DiagramExportParams {
  uri?: string;
  format: "svg" | "png" | "jpeg";
  theme?: "dark" | "light";
  scale?: number;
  padding?: number;
}

export interface DiagramExportResult {
  format: "svg" | "png" | "jpeg";
  data: string; // SVG XML string or base64 data URL
}

// ── Multi-User Collaboration Protocol ──

export interface PeerPresence {
  peerId: string;
  name: string;
  color: string;
  cursor?: Point;
  selection?: string[];
  viewport?: { x: number; y: number; zoom: number };
  lastActive: number;
}

export interface SpatialDelta {
  peerId: string;
  items: PlacementItem[];
  timestamp: number;
}

export interface SelectionLock {
  peerId: string;
  peerName: string;
  color: string;
  componentNames: string[];
  timestamp: number;
}

export interface DiagramComment {
  id: string;
  peerId: string;
  authorName: string;
  x: number;
  y: number;
  text: string;
  timestamp: number;
  resolved?: boolean;
}

export type CollabMessage =
  | { type: "presence"; presence: PeerPresence }
  | { type: "spatialDelta"; delta: SpatialDelta }
  | { type: "selectionLock"; lock: SelectionLock }
  | { type: "comment"; comment: DiagramComment }
  | { type: "peerLeave"; peerId: string };
