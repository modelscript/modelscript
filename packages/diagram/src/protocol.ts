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
  rotation?: number | undefined;
  edges?: EdgeUpdate[] | undefined;
  connectedOnly?: boolean | undefined;
}

// ── X6 Markup (DOM-free SVG tree for webview rendering) ──

export interface X6Markup {
  tagName: string;
  selector?: string | undefined;
  groupSelector?: string | undefined;
  attrs?: Record<string, string | number> | undefined;
  style?: Record<string, string | number> | undefined;
  className?: string | undefined;
  children?: X6Markup[] | undefined;
  textContent?: string | undefined;
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
  | "html"
  | "color"
  | "filePicker"
  | "table";

export interface PropertyChoiceOption {
  label: string;
  value: unknown;
  description?: string | undefined;
  icon?: string | undefined;
}

export interface PropertyFieldValidation {
  min?: number | undefined;
  max?: number | undefined;
  pattern?: string | undefined;
  validate?: ((value: unknown, ctx: Record<string, unknown>) => string | null) | undefined;
}

export interface PropertyFieldConfig {
  key: string;
  label: string;
  kind: PropertyFieldKind;
  description?: string | undefined;
  placeholder?: string | undefined;
  defaultValue?: unknown;
  unit?: string | undefined;
  choices?: (string | PropertyChoiceOption)[] | undefined;
  enabledIf?: string | undefined;
  visibleIf?: string | undefined;
  required?: boolean | undefined;
  validation?: PropertyFieldValidation | undefined;
  readOnly?: boolean | undefined;
}

export interface PropertyGroupConfig {
  id: string;
  label: string;
  description?: string | undefined;
  collapsedByDefault?: boolean | undefined;
  visibleIf?: string | undefined;
  fields: PropertyFieldConfig[];
}

export interface PropertyTabConfig {
  id: string;
  label: string;
  icon?: string | undefined;
  visibleIf?: string | undefined;
  groups: PropertyGroupConfig[];
}

export interface EntityPropertySchema {
  title?: string | undefined;
  icon?: string | undefined;
  tabs: PropertyTabConfig[];
}

// ── Diagram Data (read model) ──

export interface ComponentPropertyData {
  classKind?: string | undefined;
  className: string;
  localizedClassName?: string | undefined;
  name: string;
  localizedName?: string | undefined;
  description: string;
  localizedDescription?: string | undefined;
  parameters: {
    name: string;
    localizedName?: string | undefined;
    value: string;
    defaultValue?: string | undefined;
    description?: string | undefined;
    localizedDescription?: string | undefined;
    isBoolean?: boolean | undefined;
    unit?: string | undefined;
    tab?: string | undefined;
    group?: string | undefined;
    enable?: string | undefined;
  }[];
  documentation?:
    | {
        info?: string | undefined;
        revisions?: string | undefined;
      }
    | undefined;
  docInfo?: string | undefined;
  docRevisions?: string | undefined;
  iconSvg?: string | undefined;
  icon?: string | undefined;
  /** Structured schema-driven property definition */
  schema?: EntityPropertySchema | undefined;
  /** Property values map (key -> value) */
  values?: Record<string, unknown> | undefined;
  /** Validation error map (key -> error message) */
  errors?: Record<string, string> | undefined;
}

export interface DiagramPort {
  id: string;
  group: string;
  args: { x: number; y: number; angle: number };
  markup: X6Markup;
  isConjugated?: boolean | undefined;
  direction?: "in" | "out" | "inout" | string | undefined;
}

export interface ReactiveAnimationBinding {
  componentName: string;
  property: string;
  variableName: string;
  transform?: string | undefined;
}

export interface DiagramNodeAttrs {
  body?:
    | {
        fill?: string | undefined;
        stroke?: string | undefined;
        strokeWidth?: number | undefined;
        strokeDasharray?: string | undefined;
        rx?: number | undefined;
        ry?: number | undefined;
        fillPattern?: string | undefined;
        opacity?: number | undefined;
        filter?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  label?:
    | {
        text?: string | undefined;
        fill?: string | undefined;
        fontSize?: number | undefined;
        fontWeight?: string | number | undefined;
        [key: string]: unknown;
      }
    | undefined;
  header?:
    | {
        text?: string | undefined;
        fill?: string | undefined;
        fontSize?: number | undefined;
        [key: string]: unknown;
      }
    | undefined;
  icon?:
    | {
        href?: string | undefined;
        "xlink:href"?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  tab?:
    | {
        width?: number | undefined;
        height?: number | undefined;
        fill?: string | undefined;
        stroke?: string | undefined;
        rx?: number | undefined;
        ry?: number | undefined;
        [key: string]: unknown;
      }
    | undefined;
  tabStereotype?:
    | {
        text?: string | undefined;
        fill?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  tabLabel?:
    | {
        text?: string | undefined;
        fill?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  [key: string]: Record<string, unknown> | undefined;
}

export interface DiagramNodeData {
  fillPattern?: string | undefined;
  ruleName?: string | undefined;
  multiplicity?: number | undefined;
  icon?: string | undefined;
  sections?: { header: string; entries: string[] }[] | undefined;
  swimlane?: string | undefined;
  [key: string]: unknown;
}

export interface DiagramEdgeStyle {
  connector?: string | undefined;
  router?: string | undefined;
  strokeDasharray?: string | undefined;
  [key: string]: unknown;
}

export interface DiagramEdgeLabel {
  attrs?:
    | {
        text?:
          | {
              text?: string | undefined;
              fill?: string | undefined;
              fontSize?: number | undefined;
              [key: string]: unknown;
            }
          | undefined;
        label?:
          | {
              text?: string | undefined;
              [key: string]: unknown;
            }
          | undefined;
        rect?: Record<string, unknown> | undefined;
        [key: string]: unknown;
      }
    | undefined;
  position?: number | Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export type DiagramEdgeMarker =
  | string
  | {
      name?: string | undefined;
      width?: number | undefined;
      height?: number | undefined;
      [key: string]: unknown;
    }
  | null;

export interface DiagramNode {
  id: string;
  shape?: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  zIndex: number;
  markup: X6Markup | X6Markup[];
  ports: {
    items: DiagramPort[];
    groups: Record<string, { position: string; zIndex: number }>;
  };
  properties?: ComponentPropertyData | undefined;
  autoLayout?: boolean | undefined;
  animations?: ReactiveAnimationBinding[] | undefined;
  compartments?:
    | {
        header: string;
        entries: string[];
      }[]
    | undefined;
  attrs?: DiagramNodeAttrs | undefined;
  data?: DiagramNodeData | undefined;
}

export interface DiagramEdge {
  id: string;
  source: { cell: string; port: string; anchor: string; connectionPoint: { name: string } };
  target: { cell: string; port: string; anchor: string; connectionPoint: { name: string } };
  vertices?: { x: number; y: number }[] | undefined;
  connector?: string | undefined;
  router?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
  zIndex: number;
  animations?: ReactiveAnimationBinding[] | undefined;
  style?: DiagramEdgeStyle | undefined;
  labels?: DiagramEdgeLabel[] | undefined;
  data?: Record<string, unknown> | undefined;
  attrs: {
    line: {
      stroke: string;
      strokeWidth: number;
      strokeDasharray?: string | undefined;
      sourceMarker?: DiagramEdgeMarker | undefined;
      targetMarker?: DiagramEdgeMarker | undefined;
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
  isLoading?: boolean | undefined;
  availableViews?: { id: string; label: string; description?: string | undefined }[] | undefined;
  activeView?: string | undefined;
}

// ── Diagram Edit Actions ──

export type DiagramEditAction =
  | {
      type: "connect";
      source: string;
      target: string;
      points?: Point[] | undefined;
      color?: [number, number, number] | undefined;
      edgeType?: string | undefined;
      sourcePort?: string | undefined;
      targetPort?: string | undefined;
      section?: string | undefined;
    }
  | { type: "disconnect"; source: string; target: string; edgeType?: string | undefined }
  | { type: "move"; items: PlacementItem[] }
  | { type: "resize"; item: PlacementItem }
  | { type: "rotate"; item: PlacementItem }
  | { type: "moveEdge"; edges: EdgeUpdate[] }
  | {
      type: "addComponent";
      className: string;
      x: number;
      y: number;
      name?: string | undefined;
      section?: string | undefined;
    }
  | { type: "deleteComponents"; names: string[] }
  | {
      type: "reconnect";
      edgeId?: string | undefined;
      oldSource: string;
      oldTarget: string;
      newSource: string;
      newTarget: string;
      points?: Point[] | undefined;
      color?: [number, number, number] | undefined;
      oldSourcePort?: string | undefined;
      oldTargetPort?: string | undefined;
      newSourcePort?: string | undefined;
      newTargetPort?: string | undefined;
      edgeType?: string | undefined;
      section?: string | undefined;
    }
  | { type: "updateName"; oldName: string; newName: string }
  | { type: "updateDescription"; name: string; description: string }
  | { type: "updateParameter"; name: string; parameter: string; value: string }
  | { type: "updateProperty"; name: string; key: string; value: unknown; previousValue?: unknown };

// ── SVG Export Options ──

export interface SvgExportOptions {
  theme?: "dark" | "light" | "blueprint" | string | undefined;
  padding?: number | undefined;
  scale?: number | undefined;
  embedFonts?: boolean | undefined;
  background?: string | undefined;
}

// ── Stencil / Palette ──

export interface DiagramPaletteItem {
  label: string;
  className: string;
  iconSvg?: string | undefined;
  description?: string | undefined;
  defaultProps?: Record<string, unknown> | undefined;
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
  componentId?: string | undefined;
  className?: string | undefined;
  componentName?: string | undefined;
  nodeId?: string | undefined;
}

export interface DiagramDrillDownResult {
  data: DiagramData | null;
  breadcrumbs: { id: string; label: string; uri?: string | undefined }[];
  targetUri?: string | undefined;
  targetClassName?: string | undefined;
}

// ── Request / Response Types ──

// getData
export interface DiagramGetDataParams {
  uri: string;
  className?: string | undefined;
  /** One of "All" | "BDD" | "IBD" | "StateMachine". Accepts string for LSP wire compat. */
  diagramType?: string | undefined;
  /** Optional sidecar file content passed by the client (e.g. from IDE's virtual filesystem / workspace) */
  sidecarContent?: string | undefined;
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
  /** Optional sidecar file URI to persist layout changes (for DSLs using external layout files like SysML2/OWL2) */
  sidecarUri?: string | undefined;
  /** Optional sidecar file serialized content to write to sidecarUri */
  sidecarContent?: string | undefined;
}

// getComponentProperties
export interface DiagramGetComponentPropertiesParams {
  uri: string;
  componentName: string;
  className?: string | undefined;
}

// exportDiagram
export interface DiagramExportParams {
  uri?: string | undefined;
  format: "svg" | "png" | "jpeg";
  theme?: "dark" | "light" | undefined;
  scale?: number | undefined;
  padding?: number | undefined;
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
  cursor?: Point | undefined;
  selection?: string[] | undefined;
  viewport?: { x: number; y: number; zoom: number } | undefined;
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
  resolved?: boolean | undefined;
}

export type CollabMessage =
  | { type: "presence"; presence: PeerPresence }
  | { type: "spatialDelta"; delta: SpatialDelta }
  | { type: "selectionLock"; lock: SelectionLock }
  | { type: "comment"; comment: DiagramComment }
  | { type: "peerLeave"; peerId: string };
