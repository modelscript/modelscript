// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview General-Purpose 2D Diagram & Visual Modeling DSL types.
 *
 * Extracted from language.ts for maintainability. Contains all visual/diagram
 * entity configuration types, property inspector types, and the
 * compileDiagramConfigToPolyglot() compiler function.
 */

import type { ASTQueryFunction, CodeGraph, Cursor, f64, u32 } from "./language.js";

// ---------------------------------------------------------------------------
// General-Purpose 2D Diagram & Visual Modeling DSL (First-Principles Engine)
// ---------------------------------------------------------------------------

/** Visual styling attributes for graphical entities and connections */
export interface VisualStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  textColor?: string;
  headerFill?: string;
  opacity?: number;
  rx?: number;
  ry?: number;
  r?: number;
  size?: number;
  fontSize?: number;
  fontStyle?: string;
  icon?: string;
  fillPattern?:
    | "cylinder-horizontal"
    | "cylinder-vertical"
    | "sphere"
    | "HorizontalCylinder"
    | "VerticalCylinder"
    | "Sphere"
    | string;
  router?: "manhattan" | "orth" | "metro" | "normal" | "bezier" | string;
  connector?: "rounded" | "smooth" | "jumpover" | "normal" | string;
  arrowHead?: "classic" | "block" | "diamond" | "cross" | "none" | string;
  sourceArrow?:
    | "classic"
    | "block"
    | "diamond"
    | "hollow-diamond"
    | "hollow-triangle"
    | "open"
    | "half"
    | "none"
    | string;
  targetArrow?:
    | "classic"
    | "block"
    | "diamond"
    | "hollow-diamond"
    | "hollow-triangle"
    | "open"
    | "half"
    | "none"
    | string;
}

/** Spatial mapping & coordinate system configuration */
export interface SpatialPlacementConfig<FieldName extends string = string> {
  /** In-syntax annotation field or decorator where layout coordinates are stored */
  annotationField?: FieldName;
  /** Schema: 'explicit' (custom fields), 'modelica' (origin + extent + rotation), 'point' (x, y), 'box' (x, y, w, h) */
  schema?: "explicit" | "modelica" | "point" | "box" | "custom";
  originField?: FieldName;
  extentField?: FieldName;
  rotationField?: FieldName;
  xField?: FieldName;
  yField?: FieldName;
  widthField?: FieldName;
  heightField?: FieldName;
  /** Invert Y-axis for mathematical coordinate systems (Y-up) vs screen coordinate systems (Y-down) */
  invertY?: boolean;
  /** Default automatic layout algorithm when placement is not explicit in the code */
  autoLayout?: "dagre" | "elk" | "grid" | "force" | "tree" | "sequence" | "circular";
}

/** Explicit individual port definition for a node */
export interface VisualPortDefinition {
  id: string;
  label?: string;
  side?: "top" | "bottom" | "left" | "right";
  offset?: number; // 0.0 to 1.0 along perimeter or pixel offset
  x?: number; // absolute coordinate within icon
  y?: number;
  angle?: number;
  conjugated?: boolean;
  style?: VisualStyle;
}

/** Port / Anchor configuration for connecting edges to nodes */
export interface VisualPortConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Query or rule to retrieve child port nodes */
  query?:
    | QueryName
    | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>
    | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor);
  /** Field or callback for port identifier / label */
  label?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, port: u32) => string);
  /** Anchor placement group */
  group?: "in" | "out" | "left" | "right" | "top" | "bottom" | "auto" | "radial" | "absolute";
  style?: VisualStyle;
  /** Explicit static or template port items */
  items?: VisualPortDefinition[];
}

/** Structured internal compartment configuration (e.g. attributes, operations, parameters) */
export interface VisualCompartmentConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  header: string;
  query:
    | QueryName
    | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>
    | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor);
  itemLabel?: (db: CodeGraph<ModelAttrs, RuleName, FieldName>, item: u32) => string;
}

/** Reactive / Live Simulation Animation Binding Channel */
export interface ReactiveAnimationChannel {
  /** Target visual attribute (e.g., 'rotation', 'extent', 'fill', 'stroke', 'origin', 'visible', 'text', 'scale') */
  attribute: "rotation" | "extent" | "fill" | "stroke" | "origin" | "visible" | "text" | "scale" | string;
  /** Signal / variable name in the simulation state vector (e.g., 'phi', 'temperature', 'active') */
  signal?: string;
  /** Value transformation callback (converts simulation numeric state to visual attribute value) */
  transform?: (db: CodeGraph, node: u32, signalValue: f64) => any;
}

/** Configuration for simulation-time reactive animations & dynamic selection */
export interface ReactiveDynamicsConfig {
  /** Function name used in AST for in-code dynamic value selection (e.g., 'DynamicSelect', 'animate') */
  selectFunction?: string;
  /** Extract static design-time AST argument vs dynamic simulation AST expression */
  extractDynamicSelect?: (db: CodeGraph, callNode: u32) => { staticExpr: u32; dynamicExpr: u32 };
  /** Evaluates dynamic AST expression against live state lookup */
  evaluateDynamic?: (db: CodeGraph, dynamicExprNode: u32, getState: (varName: string) => f64) => any;
  /** Static animation channel bindings */
  channels?: ReactiveAnimationChannel[];
}

/**
 * Visual Element / Vector Glyph Primitive & DOM-Free SVG Hierarchy
 * Fully isomorphic with X6Markup: supports high-level geometric primitives,
 * SVG element tag names, and nested container trees (<svg>, <defs>, <g>, <linearGradient>, <pattern>).
 */
export interface VisualElement {
  /** Primitive type or SVG tag name (e.g. 'rect', 'circle', 'path', 'g', 'svg', 'defs') */
  type?:
    | "rect"
    | "circle"
    | "ellipse"
    | "line"
    | "polygon"
    | "path"
    | "text"
    | "image"
    | "group"
    | "svg"
    | "defs"
    | "g"
    | string;
  tagName?: string;
  selector?: string;
  groupSelector?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  textContent?: string;

  // Spatial & visual coordinates
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  d?: string;
  points?: [number, number][] | { x: number; y: number }[] | string;
  text?: string;
  src?: string;
  style?: VisualStyle;

  /** Nested children / sub-elements / SVG container hierarchy */
  children?: VisualElement[];
}

/** Visual Node & Group configuration */
export interface VisualNodeConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  role?: "node" | "group" | "compartment";
  label?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => string);
  stereotype?: string | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => string);
  shape?: "rect" | "circle" | "diamond" | "cylinder" | "package" | "subsystem" | "pill" | "custom" | string;
  style?: VisualStyle;
  size?: { width: number; height: number };
  spatial?: SpatialPlacementConfig<FieldName>;
  placement?: SpatialPlacementConfig<FieldName>; // Alias for backward-compat
  ports?: VisualPortConfig<RuleName, FieldName, QueryName, ModelAttrs>;
  compartments?: VisualCompartmentConfig<RuleName, FieldName, QueryName, ModelAttrs>[];

  /**
   * Dynamic visual representation function / query.
   * Inspects AST nodes, symbols, or types and returns visual elements or vector markup.
   */
  render?: (
    db: CodeGraph<ModelAttrs, RuleName, FieldName>,
    node: u32,
    env: EvaluationEnvironment,
  ) => VisualElement[] | any;

  /**
   * Declarative AST graphics extractor: extracts child graphical shape AST nodes from any field/query
   */
  graphics?: {
    query?: FieldName | QueryName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor);
    primitives?: Record<string, Record<string, string>>;
  };

  /** Dynamic template expansions & property bindings (e.g. %name, %R, %class) */
  propertyBindings?: Record<
    string,
    FieldName | string | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => any)
  >;

  /** Dual view definition (Icon schematic vs internal Diagram architecture) */
  views?: {
    icon?: VisualElement[] | ((db: CodeGraph, node: u32) => VisualElement[]);
    diagram?: VisualElement[] | ((db: CodeGraph, node: u32) => VisualElement[]);
  };

  /** Reactive simulation animation & dynamic expression evaluation */
  dynamics?: ReactiveDynamicsConfig;
  animation?: ReactiveDynamicsConfig; // Alias for backward-compat
}

/** Visual Edge & Connection configuration */
export interface VisualEdgeConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  source: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  target: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  sourcePort?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  targetPort?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  label?: string | FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  waypointsField?: FieldName;
  style?: VisualStyle;

  /** Live simulation animation for edge states (e.g. flow velocity, current, active transitions) */
  dynamics?: ReactiveDynamicsConfig;
  animation?: ReactiveDynamicsConfig; // Alias for backward-compat
}

/** General Diagram Projection (View / Slice / Perspective) */
export interface DiagramProjectionConfig<RuleName extends string = string, FieldName extends string = string> {
  label: string;
  description?: string;
  /** Perspective / Viewpoint identifier */
  perspective?: string;
  viewpoint?: string; // Alias for backward-compat
  /** Explicit list of grammar rules included in this projection */
  includeRules?: (RuleName | string)[];
  /** Explicit list of grammar rules excluded from this projection */
  excludeRules?: (RuleName | string)[];
  /** Explicit list of grammar rules that act as visual group/container boundaries */
  groupRules?: (RuleName | string)[];
  /** Explicit list of grammar rules rendered as standalone nodes */
  standaloneRules?: (RuleName | string)[];
  /** Scope query: which AST nodes are candidate entities */
  scope?: (db: CodeGraph, root: u32) => Cursor;
  expose?: string[] | ((db: CodeGraph, root: u32) => Cursor);
  /** Node filter predicate */
  filter?: ((db: CodeGraph, node: u32) => boolean) | ((entry: any) => boolean);
  /** Layout strategy */
  defaultLayout?: "dagre" | "elk" | "grid" | "force" | "tree" | "sequence" | "circular" | "manual";
}

/** Dynamic In-Model Projection Discovery (e.g. SysML2 views, SQL views, Mermaid subgraphs) */
export interface InModelProjectionDiscoveryConfig<RuleName extends string = string, FieldName extends string = string> {
  /** The grammar rule defining views/projections in user code (e.g. 'ViewUsage', 'ViewDefinition') */
  rule?: NoInfer<RuleName>;
  viewRule?: NoInfer<RuleName>; // Alias for backward-compat
  /** Perspective / viewpoint definition rule */
  perspectiveRule?: NoInfer<RuleName>;
  viewpointRule?: NoInfer<RuleName>; // Alias for backward-compat
  /** Field extracting the projection name */
  nameField?: FieldName;
  /** Field extracting the viewpoint / perspective target reference */
  perspectiveField?: FieldName;
  viewpointField?: FieldName; // Alias for backward-compat
  /** Field extracting the expose / scope query expression */
  exposeField?: FieldName;
  /** Field extracting the filter predicate expression */
  filterField?: FieldName;
  /** Evaluates user's in-model filter expression against candidate AST nodes */
  evaluateFilter?: (db: CodeGraph, filterNode: u32, candidateNode: u32) => boolean;
  /** Evaluates user's in-model expose expression to return an AST cursor */
  evaluateExpose?: (db: CodeGraph, exposeNode: u32) => Cursor;
}

/** Dynamic Graphic Annotation Parser (e.g. Modelica Icon/Diagram, CAD 2D primitives) */
export interface GraphicAnnotationsConfig<RuleName extends string = string, FieldName extends string = string> {
  /** Annotation clause field in AST (e.g. 'annotationClause') */
  annotationField?: FieldName;
  /** Graphic primitive AST constructor mappings */
  primitives?: Record<string, Record<string, string>>;
  iconSection?: string;
  diagramSection?: string;
  /** Resolves string template macros (%name, %<param>) against active instance scope */
  resolveTemplate?: (db: CodeGraph, templateString: string, componentNode: u32) => string;
}

/** Bidirectional Visual Mutations (Canvas Action -> AST Synthesis via Unparser) */
export interface VisualMutationConfig {
  createEdge?: (source: string, target: string, sourcePort?: string, targetPort?: string) => string;
  createNode?: (ruleName: string, name: string, x: number, y: number) => string;
  updatePlacement?: (db: CodeGraph, node: u32, x: number, y: number, w: number, h: number, rot: number) => void;
  deleteEntity?: (db: CodeGraph, node: u32) => void;
  renameEntity?: (db: CodeGraph, node: u32, newName: string) => void;

  /** Declarative string templates or builders */
  nodeTemplate?: string | ((className: string, name: string) => string);
  edgeTemplate?: string | ((source: string, target: string) => string);
  /** Per-relationship and per-view edge templates */
  edgeTemplates?: Record<string, string | ((src: string, tgt: string, srcPort?: string, tgtPort?: string) => string)>;
  /** Section names for inserting elements (e.g. { edge: "equations", node: "elements" }) */
  sections?: Record<string, string>;
  defaultSection?: string;
  edgeRule?: string;
  insertionSection?: string;
}

/** Single stencil/tool item in a diagram palette */
export interface DiagramPaletteItem {
  label: string;
  className: string;
  iconSvg?: string;
  description?: string;
  defaultProps?: Record<string, any>;
}

/** Category grouping for diagram palette items */
export interface DiagramPaletteCategory {
  name: string;
  items: DiagramPaletteItem[];
}

/** Stencil / Palette configuration for diagram authoring toolboxes */
export interface DiagramPaletteConfig {
  categories: DiagramPaletteCategory[];
}

/**
 * Generic Runtime Environment / State Store Lookup
 * Resolves identifiers to values from either static parameter bindings (design-time)
 * or live simulation / telemetry state vectors (runtime playback).
 */
export interface EvaluationEnvironment {
  /** Retrieves variable or parameter value by identifier */
  get(identifier: string): any;
  /** Numerical value lookup */
  getNumber(identifier: string): f64;
  /** String value lookup */
  getString(identifier: string): string;
  /** Boolean condition lookup */
  getBoolean(identifier: string): boolean;
  /** Current simulation / execution time */
  time?: f64;
}

/**
 * Universal In-Language Expression Evaluator Protocol
 */
export interface ExpressionEvaluatorConfig {
  /**
   * Evaluates ANY in-language AST expression node using an evaluation environment.
   * Works identically for design-time parameter resolution and 60 FPS simulation playback.
   */
  evaluate?: (db: CodeGraph, exprNode: u32, env: EvaluationEnvironment) => any;

  /**
   * Optional recognizer for languages with explicit static/dynamic wrapper syntax (e.g. Modelica DynamicSelect)
   */
  splitStaticDynamic?: (db: CodeGraph, exprNode: u32) => { staticNode: u32; dynamicNode: u32 };
}

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

/** A single option in a choice/dropdown field */
export interface PropertyChoiceOption {
  label: string;
  value: any;
  description?: string;
  icon?: string;
}

/** Dynamic condition predicate for property visibility or enablement */
export type PropertyPredicate = string | ((ctx: any) => boolean);

/** Field-level validation rule */
export interface PropertyFieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  validate?: (value: any, ctx: any) => string | null;
}

/** Declarative property field definition */
export interface PropertyFieldConfig {
  key: string;
  label: string;
  kind: PropertyFieldKind;
  description?: string;
  placeholder?: string;
  defaultValue?: any;
  unit?: string;
  choices?: (string | PropertyChoiceOption)[] | ((ctx: any) => (string | PropertyChoiceOption)[]);
  enabledIf?: PropertyPredicate;
  visibleIf?: PropertyPredicate;
  required?: boolean;
  validation?: PropertyFieldValidation;
  readOnly?: boolean;
}

/** Declarative group (accordion/collapsible section) */
export interface PropertyGroupConfig {
  id: string;
  label: string;
  description?: string;
  collapsedByDefault?: boolean;
  visibleIf?: PropertyPredicate;
  fields: PropertyFieldConfig[];
}

/** Declarative tab */
export interface PropertyTabConfig {
  id: string;
  label: string;
  icon?: string;
  visibleIf?: PropertyPredicate;
  groups: PropertyGroupConfig[];
}

/** Schema for an entity rule */
export interface EntityPropertySchema<RuleName extends string = string> {
  title?: string | ((node: any) => string);
  icon?: string | ((node: any) => string);
  tabs: PropertyTabConfig[];
}

/** In-model dynamic property and annotation discovery (e.g. Modelica Dialog) */
export interface InModelPropertyDiscoveryHook {
  extractSchema?: (db: any, node: any, queryEngine: any) => EntityPropertySchema | null;
  extractValues?: (db: any, node: any, queryEngine: any) => Record<string, any> | null;
}

/** AST mutation handler for updating properties back to source code */
export interface PropertyMutator<RuleName extends string = string> {
  updateProperty?: (db: any, node: any, key: string, value: any, previousValue?: any) => any;
  updateModifier?: (docText: string, node: any, paramName: string, newValue: any) => any;
}

/** Property Inspector configuration for a language */
export interface PropertyInspectorConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  entities?: Partial<Record<NoInfer<RuleName>, EntityPropertySchema<RuleName>>>;
  inModelDiscovery?: InModelPropertyDiscoveryHook;
  mutator?: PropertyMutator<RuleName>;
}

/**
 * Universal 2D Visual Modeling & Diagram DSL Configuration
 */
export interface DiagramConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Declarative Property Inspector Configuration */
  properties?: PropertyInspectorConfig<RuleName, FieldName, QueryName, ModelAttrs>;

  /** Static / built-in diagram projections */
  projections?: Record<string, DiagramProjectionConfig<RuleName, FieldName>>;
  views?: Record<string, DiagramProjectionConfig<RuleName, FieldName>>; // Alias for backward-compat

  /** Dynamic in-model projection / view discovery from user AST (e.g. SysML2 views) */
  inModelProjections?: InModelProjectionDiscoveryConfig<RuleName, FieldName>;
  inModelViews?: InModelProjectionDiscoveryConfig<RuleName, FieldName>; // Alias for backward-compat

  /** In-model graphic annotations & vector shape extraction (optional fallback) */
  annotations?: GraphicAnnotationsConfig<RuleName, FieldName>;

  /** General in-language expression evaluation engine (evaluates in-code expressions at design-time and live simulation) */
  evaluator?: ExpressionEvaluatorConfig;

  /** Universal reactive dynamics & simulation animation protocol (e.g. DynamicSelect) */
  dynamics?: ReactiveDynamicsConfig;
  dynamicSelect?: ReactiveDynamicsConfig; // Alias for backward-compat

  /** Visual entity / node configurations */
  entities?: Partial<Record<NoInfer<RuleName>, VisualNodeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>;
  nodes?: Partial<Record<NoInfer<RuleName>, VisualNodeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>; // Alias for backward-compat

  /** Visual relationship / edge configurations */
  connections?: Partial<Record<NoInfer<RuleName>, VisualEdgeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>;
  edges?: Partial<Record<NoInfer<RuleName>, VisualEdgeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>; // Alias for backward-compat

  /** Visual mutations (Unparser-backed AST transformations) */
  mutations?: VisualMutationConfig;

  /** Stencil / Palette configuration */
  palette?: DiagramPaletteConfig;

  /** Spatial placement storage strategy */
  placement?: {
    persistence?: "inline" | "sidecar";
    rule?: string;
    formatPlacement?: (x: number, y: number, w?: number, h?: number, r?: number) => string;
    parsePlacement?: (node: any) => { x: number; y: number; width?: number; height?: number };
  };

  /** Grammar rule classification sets for structural parent & standalone children */
  structuralRules?: (RuleName | string)[];
  standaloneRules?: (RuleName | string)[];
  usageRules?: (RuleName | string)[];
  definitionRules?: (RuleName | string)[];
  portRules?: (RuleName | string)[];
  reactiveDynamics?: boolean;
}

/**
 * Compiles a declarative DiagramConfig into the GraphicsConfig dictionary
 * and PolyglotDiagramOptions consumed by buildPolyglotDiagram.
 */
export function compileDiagramConfigToPolyglot(diagramConfig?: DiagramConfig): {
  gfxConfig: Record<string, any>;
  graphicsConfig: Record<string, any>;
  options: {
    customProjections?: Record<string, any>;
    structuralKinds?: string[];
    standaloneKinds?: string[];
    usageKinds?: string[];
    definitionKinds?: string[];
    portKinds?: string[];
    reactiveDynamics?: boolean;
    inModelDiscovery?: any;
    solderDots?: boolean;
    mutations?: VisualMutationConfig;
    palette?: DiagramPaletteConfig;
    placement?: any;
  };
} {
  const gfxConfig: Record<string, any> = {};
  if (!diagramConfig || Object.keys(diagramConfig).length === 0) {
    return { gfxConfig, graphicsConfig: gfxConfig, options: {} };
  }

  // Compile nodes / entities
  const nodes = diagramConfig.nodes || diagramConfig.entities || {};
  for (const [ruleName, nodeCfg] of Object.entries(nodes)) {
    if (!nodeCfg) continue;
    const role = nodeCfg.role || (nodeCfg.shape === "subsystem" || nodeCfg.shape === "package" ? "group" : "node");
    const shape = nodeCfg.shape || "rect";
    const size = nodeCfg.size;

    const ports: any = {};
    if (nodeCfg.ports) {
      if (nodeCfg.ports.items && nodeCfg.ports.items.length > 0) {
        ports.items = nodeCfg.ports.items.map((p) => ({
          id: p.id,
          group: p.side || "auto",
          args: p.x !== undefined || p.y !== undefined ? { x: p.x, y: p.y, angle: p.angle } : undefined,
          attrs: p.style ? { circle: { fill: p.style.fill, stroke: p.style.stroke } } : undefined,
        }));
      }
      if (nodeCfg.ports.group) {
        ports.groups = {
          [nodeCfg.ports.group]: { position: nodeCfg.ports.group },
        };
      }
    }

    const compartments = nodeCfg.compartments
      ? nodeCfg.compartments.map((c) => ({
          header: c.header,
          query: typeof c.query === "string" ? c.query : undefined,
        }))
      : undefined;

    let bodyFill = nodeCfg.style?.fill;
    if (nodeCfg.style?.fillPattern) {
      const p = nodeCfg.style.fillPattern;
      if (p === "cylinder-horizontal" || p === "HorizontalCylinder") {
        bodyFill = "url(#grad-cylinder-horizontal)";
      } else if (p === "cylinder-vertical" || p === "VerticalCylinder") {
        bodyFill = "url(#grad-cylinder-vertical)";
      } else if (p === "sphere" || p === "Sphere") {
        bodyFill = "url(#grad-sphere)";
      }
    }

    const nodeAttrs = nodeCfg.style
      ? {
          body: {
            fill: bodyFill,
            stroke: nodeCfg.style.stroke,
            strokeWidth: nodeCfg.style.strokeWidth,
            rx: nodeCfg.style.rx,
            ry: nodeCfg.style.ry,
          },
          ...(nodeCfg.style.icon ? { icon: nodeCfg.style.icon } : {}),
        }
      : undefined;

    const portsObj = Object.keys(ports).length > 0 ? ports : undefined;
    gfxConfig[ruleName] = {
      role,
      ports: portsObj,
      compartments,
      node: {
        shape,
        size,
        ports: portsObj,
        compartments,
        attrs: nodeAttrs,
        animation: (nodeCfg as any).animation || (nodeCfg as any).animations,
      },
    };
  }

  // Compile edges / connections
  const edges = diagramConfig.edges || diagramConfig.connections || {};
  for (const [ruleName, edgeCfg] of Object.entries(edges)) {
    if (!edgeCfg) continue;

    const formatMarker = (marker?: string) => {
      if (!marker || marker === "none") return undefined;
      if (marker === "classic" || marker === "block") return { name: marker };
      const stroke = edgeCfg.style?.stroke || "#38bdf8";
      if (marker === "diamond") return { name: "path", d: "M 0 0 L 5 -4 L 10 0 L 5 4 Z", fill: stroke };
      if (marker === "hollow-diamond")
        return { name: "path", d: "M 0 0 L 5 -4 L 10 0 L 5 4 Z", fill: "#ffffff", stroke };
      if (marker === "hollow-triangle") return { name: "path", d: "M 0 -6 L 10 0 L 0 6 Z", fill: "#ffffff", stroke };
      if (marker === "open") return { name: "path", d: "M 0 -5 L 10 0 L 0 5", fill: "none", stroke };
      if (marker === "half") return { name: "path", d: "M 0 0 L 10 0 L 0 5 Z", fill: stroke };
      return { name: marker };
    };

    const targetMarker = formatMarker(edgeCfg.style?.targetArrow || edgeCfg.style?.arrowHead);
    const sourceMarker = formatMarker(edgeCfg.style?.sourceArrow);

    gfxConfig[ruleName] = {
      role: "edge",
      edge: {
        shape: "edge",
        source: typeof edgeCfg.source === "string" ? edgeCfg.source : undefined,
        target: typeof edgeCfg.target === "string" ? edgeCfg.target : undefined,
        sourcePort: typeof edgeCfg.sourcePort === "string" ? edgeCfg.sourcePort : undefined,
        targetPort: typeof edgeCfg.targetPort === "string" ? edgeCfg.targetPort : undefined,
        router: edgeCfg.style?.router,
        connector: edgeCfg.style?.connector,
        attrs: edgeCfg.style
          ? {
              line: {
                stroke: edgeCfg.style.stroke,
                strokeWidth: edgeCfg.style.strokeWidth,
                strokeDasharray: edgeCfg.style.strokeDasharray,
                targetMarker,
                sourceMarker,
              },
            }
          : targetMarker || sourceMarker
            ? {
                line: {
                  targetMarker,
                  sourceMarker,
                },
              }
            : undefined,
        animation: (edgeCfg as any).animation || (edgeCfg as any).animations,
      },
    };
  }

  const options = {
    customProjections: diagramConfig.projections || diagramConfig.views,
    structuralKinds: diagramConfig.structuralRules ? [...diagramConfig.structuralRules] : undefined,
    standaloneKinds: diagramConfig.standaloneRules ? [...diagramConfig.standaloneRules] : undefined,
    usageKinds: diagramConfig.usageRules ? [...diagramConfig.usageRules] : undefined,
    definitionKinds: diagramConfig.definitionRules ? [...diagramConfig.definitionRules] : undefined,
    portKinds: diagramConfig.portRules ? [...diagramConfig.portRules] : undefined,
    reactiveDynamics: diagramConfig.reactiveDynamics,
    inModelDiscovery: diagramConfig.inModelProjections || diagramConfig.inModelViews,
    solderDots: true,
    mutations: diagramConfig.mutations,
    palette: diagramConfig.palette,
    placement: diagramConfig.placement,
    properties: diagramConfig.properties,
  };

  return { gfxConfig, graphicsConfig: gfxConfig, options };
}

// Backward-compatible type aliases
export type DiagramStyle = VisualStyle;
export type DiagramPlacementConfig<FieldName extends string = string> = SpatialPlacementConfig<FieldName>;
export type DiagramPortConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualPortConfig<R, F, Q, M>;
export type DiagramCompartmentConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualCompartmentConfig<R, F, Q, M>;
export type DiagramAnimationBinding = ReactiveAnimationChannel;
export type DiagramAnimationConfig = ReactiveDynamicsConfig;
export type DiagramNodeConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualNodeConfig<R, F, Q, M>;
export type DiagramEdgeConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualEdgeConfig<R, F, Q, M>;
export type DiagramViewConfig = DiagramProjectionConfig;
export type DiagramMutationConfig = VisualMutationConfig;
export type InModelViewDiscoveryConfig<
  R extends string = string,
  F extends string = string,
> = InModelProjectionDiscoveryConfig<R, F>;
export type InModelGraphicAnnotationsConfig<
  R extends string = string,
  F extends string = string,
> = GraphicAnnotationsConfig<R, F>;
export type InModelDynamicSelectConfig = ReactiveDynamicsConfig;
