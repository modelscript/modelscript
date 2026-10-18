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
  fill?: string | undefined;
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  strokeDasharray?: string | undefined;
  textColor?: string | undefined;
  headerFill?: string | undefined;
  opacity?: number | undefined;
  rx?: number | undefined;
  ry?: number | undefined;
  r?: number | undefined;
  size?: number | undefined;
  fontSize?: number | undefined;
  fontStyle?: string | undefined;
  icon?: string | undefined;
  fillPattern?:
    | "cylinder-horizontal"
    | "cylinder-vertical"
    | "sphere"
    | "HorizontalCylinder"
    | "VerticalCylinder"
    | "Sphere"
    | string
    | undefined;
  router?: "manhattan" | "orth" | "metro" | "normal" | "bezier" | string | undefined;
  connector?: "rounded" | "smooth" | "jumpover" | "normal" | string | undefined;
  arrowHead?: "classic" | "block" | "diamond" | "cross" | "none" | string | undefined;
  sourceArrow?:
    | "classic"
    | "block"
    | "diamond"
    | "hollow-diamond"
    | "hollow-triangle"
    | "open"
    | "half"
    | "none"
    | string
    | undefined;
  targetArrow?:
    | "classic"
    | "block"
    | "diamond"
    | "hollow-diamond"
    | "hollow-triangle"
    | "open"
    | "half"
    | "none"
    | string
    | undefined;
}

/** Spatial mapping & coordinate system configuration */
export interface SpatialPlacementConfig<FieldName extends string = string> {
  /** In-syntax annotation field or decorator where layout coordinates are stored */
  annotationField?: FieldName | undefined;
  /** Schema: 'explicit' (custom fields), 'modelica' (origin + extent + rotation), 'point' (x, y), 'box' (x, y, w, h) */
  schema?: "explicit" | "modelica" | "point" | "box" | "custom" | undefined;
  originField?: FieldName | undefined;
  extentField?: FieldName | undefined;
  rotationField?: FieldName | undefined;
  xField?: FieldName | undefined;
  yField?: FieldName | undefined;
  widthField?: FieldName | undefined;
  heightField?: FieldName | undefined;
  /** Invert Y-axis for mathematical coordinate systems (Y-up) vs screen coordinate systems (Y-down) */
  invertY?: boolean | undefined;
  /** Default automatic layout algorithm when placement is not explicit in the code */
  autoLayout?: "dagre" | "elk" | "grid" | "force" | "tree" | "sequence" | "circular" | undefined;
}

/** Explicit individual port definition for a node */
export interface VisualPortDefinition {
  id: string;
  label?: string | undefined;
  side?: "top" | "bottom" | "left" | "right" | undefined;
  offset?: number | undefined; // 0.0 to 1.0 along perimeter or pixel offset
  x?: number | undefined; // absolute coordinate within icon
  y?: number | undefined;
  angle?: number | undefined;
  conjugated?: boolean | undefined;
  style?: VisualStyle | undefined;
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
    | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor)
    | undefined;
  /** Field or callback for port identifier / label */
  label?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, port: u32) => string) | undefined;
  /** Anchor placement group */
  group?: "in" | "out" | "left" | "right" | "top" | "bottom" | "auto" | "radial" | "absolute" | undefined;
  style?: VisualStyle | undefined;
  /** Explicit static or template port items */
  items?: VisualPortDefinition[] | undefined;
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
  itemLabel?: ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, item: u32) => string) | undefined;
}

/** Reactive / Live Simulation Animation Binding Channel */
export interface ReactiveAnimationChannel {
  /** Target visual attribute (e.g., 'rotation', 'extent', 'fill', 'stroke', 'origin', 'visible', 'text', 'scale') */
  attribute: "rotation" | "extent" | "fill" | "stroke" | "origin" | "visible" | "text" | "scale" | string;
  /** Signal / variable name in the simulation state vector (e.g., 'phi', 'temperature', 'active') */
  signal?: string | undefined;
  /** Value transformation callback (converts simulation numeric state to visual attribute value) */
  transform?: ((db: CodeGraph, node: u32, signalValue: f64) => any) | undefined;
}

/** Configuration for simulation-time reactive animations & dynamic selection */
export interface ReactiveDynamicsConfig {
  /** Function name used in AST for in-code dynamic value selection (e.g., 'DynamicSelect', 'animate') */
  selectFunction?: string | undefined;
  /** Extract static design-time AST argument vs dynamic simulation AST expression */
  extractDynamicSelect?: ((db: CodeGraph, callNode: u32) => { staticExpr: u32; dynamicExpr: u32 }) | undefined;
  /** Evaluates dynamic AST expression against live state lookup */
  evaluateDynamic?: ((db: CodeGraph, dynamicExprNode: u32, getState: (varName: string) => f64) => any) | undefined;
  /** Static animation channel bindings */
  channels?: ReactiveAnimationChannel[] | undefined;
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
    | string
    | undefined;
  tagName?: string | undefined;
  selector?: string | undefined;
  groupSelector?: string | undefined;
  attrs?: Record<string, string | number | boolean | undefined> | undefined;
  textContent?: string | undefined;

  // Spatial & visual coordinates
  x?: number | undefined;
  y?: number | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  cx?: number | undefined;
  cy?: number | undefined;
  r?: number | undefined;
  rx?: number | undefined;
  ry?: number | undefined;
  d?: string | undefined;
  points?: [number, number][] | { x: number; y: number }[] | string | undefined;
  text?: string | undefined;
  src?: string | undefined;
  style?: VisualStyle | undefined;

  /** Nested children / sub-elements / SVG container hierarchy */
  children?: VisualElement[] | undefined;
}

/** Visual Node & Group configuration */
export interface VisualNodeConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  role?: "node" | "group" | "compartment" | undefined;
  label?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => string) | undefined;
  stereotype?: string | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => string) | undefined;
  shape?: "rect" | "circle" | "diamond" | "cylinder" | "package" | "subsystem" | "pill" | "custom" | string | undefined;
  style?: VisualStyle | undefined;
  size?: { width: number; height: number } | undefined;
  spatial?: SpatialPlacementConfig<FieldName> | undefined;
  placement?: SpatialPlacementConfig<FieldName> | undefined; // Alias for backward-compat
  ports?: VisualPortConfig<RuleName, FieldName, QueryName, ModelAttrs> | undefined;
  compartments?: VisualCompartmentConfig<RuleName, FieldName, QueryName, ModelAttrs>[] | undefined;

  /**
   * Dynamic visual representation function / query.
   * Inspects AST nodes, symbols, or types and returns visual elements or vector markup.
   */
  render?:
    | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32, env: EvaluationEnvironment) => VisualElement[] | any)
    | undefined;

  /**
   * Declarative AST graphics extractor: extracts child graphical shape AST nodes from any field/query
   */
  graphics?:
    | {
        query?:
          | FieldName
          | QueryName
          | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor)
          | undefined;
        primitives?: Record<string, Record<string, string>> | undefined;
      }
    | undefined;

  /** Dynamic template expansions & property bindings (e.g. %name, %R, %class) */
  propertyBindings?:
    | Record<string, FieldName | string | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => any)>
    | undefined;

  /** Dual view definition (Icon schematic vs internal Diagram architecture) */
  views?:
    | {
        icon?: VisualElement[] | ((db: CodeGraph, node: u32) => VisualElement[]) | undefined;
        diagram?: VisualElement[] | ((db: CodeGraph, node: u32) => VisualElement[]) | undefined;
      }
    | undefined;

  /** Reactive simulation animation & dynamic expression evaluation */
  dynamics?: ReactiveDynamicsConfig | undefined;
  animation?: ReactiveDynamicsConfig | undefined; // Alias for backward-compat
}

/** Visual Edge & Connection configuration */
export interface VisualEdgeConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  _QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  source: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  target: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  sourcePort?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string) | undefined;
  targetPort?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string) | undefined;
  label?: string | FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string) | undefined;
  waypointsField?: FieldName | undefined;
  style?: VisualStyle | undefined;

  /** Live simulation animation for edge states (e.g. flow velocity, current, active transitions) */
  dynamics?: ReactiveDynamicsConfig | undefined;
  animation?: ReactiveDynamicsConfig | undefined; // Alias for backward-compat
}

/** General Diagram Projection (View / Slice / Perspective) */
export interface DiagramProjectionConfig<RuleName extends string = string, _FieldName extends string = string> {
  label: string;
  description?: string | undefined;
  /** Perspective / Viewpoint identifier */
  perspective?: string | undefined;
  viewpoint?: string | undefined; // Alias for backward-compat
  /** Explicit list of grammar rules included in this projection */
  includeRules?: (RuleName | string)[] | undefined;
  /** Explicit list of grammar rules excluded from this projection */
  excludeRules?: (RuleName | string)[] | undefined;
  /** Explicit list of grammar rules that act as visual group/container boundaries */
  groupRules?: (RuleName | string)[] | undefined;
  /** Explicit list of grammar rules rendered as standalone nodes */
  standaloneRules?: (RuleName | string)[] | undefined;
  /** Explicit list of grammar rules rendered as state bubbles with entry/do/exit compartments */
  stateBubbleRules?: (RuleName | string)[] | undefined;
  /** Explicit list of grammar rules rendered as activity control nodes (fork/join bars, decision/merge diamonds) */
  controlNodeRules?: (RuleName | string)[] | undefined;
  /** Synthesize initial and final pseudostate nodes for states without incoming/outgoing transitions */
  synthesizePseudoStates?: boolean | undefined;
  /** Scope query: which AST nodes are candidate entities */
  scope?: ((db: CodeGraph, root: u32) => Cursor) | undefined;
  expose?: string[] | ((db: CodeGraph, root: u32) => Cursor) | undefined;
  /** Node filter predicate */
  filter?: ((db: CodeGraph, node: u32) => boolean) | ((entry: any) => boolean) | undefined;
  /** Layout strategy */
  defaultLayout?: "dagre" | "elk" | "grid" | "force" | "tree" | "sequence" | "circular" | "manual" | undefined;
}

/** Dynamic In-Model Projection Discovery (e.g. SysML2 views, SQL views, Mermaid subgraphs) */
export interface InModelProjectionDiscoveryConfig<RuleName extends string = string, FieldName extends string = string> {
  /** The grammar rule defining views/projections in user code (e.g. 'ViewUsage', 'ViewDefinition') */
  rule?: NoInfer<RuleName> | undefined;
  viewRule?: NoInfer<RuleName> | undefined; // Alias for backward-compat
  /** Perspective / viewpoint definition rule */
  perspectiveRule?: NoInfer<RuleName> | undefined;
  viewpointRule?: NoInfer<RuleName> | undefined; // Alias for backward-compat
  /** Field extracting the projection name */
  nameField?: FieldName | undefined;
  /** Field extracting the viewpoint / perspective target reference */
  perspectiveField?: FieldName | undefined;
  viewpointField?: FieldName | undefined; // Alias for backward-compat
  /** Field extracting the expose / scope query expression */
  exposeField?: FieldName | undefined;
  /** Field extracting the filter predicate expression */
  filterField?: FieldName | undefined;
  /** Evaluates user's in-model filter expression against candidate AST nodes */
  evaluateFilter?: ((db: CodeGraph, filterNode: u32, candidateNode: u32) => boolean) | undefined;
  /** Evaluates user's in-model expose expression to return an AST cursor */
  evaluateExpose?: ((db: CodeGraph, exposeNode: u32) => Cursor) | undefined;
}

/** Dynamic Graphic Annotation Parser (e.g. Modelica Icon/Diagram, CAD 2D primitives) */
export interface GraphicAnnotationsConfig<_RuleName extends string = string, FieldName extends string = string> {
  /** Annotation clause field in AST (e.g. 'annotationClause') */
  annotationField?: FieldName | undefined;
  /** Graphic primitive AST constructor mappings */
  primitives?: Record<string, Record<string, string>> | undefined;
  iconSection?: string | undefined;
  diagramSection?: string | undefined;
  /** Resolves string template macros (%name, %<param>) against active instance scope */
  resolveTemplate?: ((db: CodeGraph, templateString: string, componentNode: u32) => string) | undefined;
}

/** Bidirectional Visual Mutations (Canvas Action -> AST Synthesis via Unparser) */
export interface VisualMutationConfig {
  createEdge?: ((source: string, target: string, sourcePort?: string, targetPort?: string) => string) | undefined;
  createNode?: ((ruleName: string, name: string, x: number, y: number) => string) | undefined;
  updatePlacement?:
    | ((db: CodeGraph, node: u32, x: number, y: number, w: number, h: number, rot: number) => void)
    | undefined;
  deleteEntity?: ((db: CodeGraph, node: u32) => void) | undefined;
  renameEntity?: ((db: CodeGraph, node: u32, newName: string) => void) | undefined;

  /** Declarative string templates or builders */
  nodeTemplate?: string | ((className: string, name: string) => string) | undefined;
  edgeTemplate?: string | ((source: string, target: string) => string) | undefined;
  /** Per-relationship and per-view edge templates */
  edgeTemplates?:
    | Record<string, string | ((src: string, tgt: string, srcPort?: string, tgtPort?: string) => string)>
    | undefined;
  /** Section names for inserting elements (e.g. { edge: "equations", node: "elements" }) */
  sections?: Record<string, string> | undefined;
  defaultSection?: string | undefined;
  edgeRule?: string | undefined;
  insertionSection?: string | undefined;
}

/** Single stencil/tool item in a diagram palette */
export interface DiagramPaletteItem {
  label: string;
  className: string;
  iconSvg?: string | undefined;
  description?: string | undefined;
  defaultProps?: Record<string, any> | undefined;
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
  time?: f64 | undefined;
}

/**
 * Universal In-Language Expression Evaluator Protocol
 */
export interface ExpressionEvaluatorConfig {
  /**
   * Evaluates ANY in-language AST expression node using an evaluation environment.
   * Works identically for design-time parameter resolution and 60 FPS simulation playback.
   */
  evaluate?: ((db: CodeGraph, exprNode: u32, env: EvaluationEnvironment) => any) | undefined;

  /**
   * Optional recognizer for languages with explicit static/dynamic wrapper syntax (e.g. Modelica DynamicSelect)
   */
  splitStaticDynamic?: ((db: CodeGraph, exprNode: u32) => { staticNode: u32; dynamicNode: u32 }) | undefined;
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
  | "html"
  | "color"
  | "filePicker"
  | "table";

/** A single option in a choice/dropdown field */
export interface PropertyChoiceOption {
  label: string;
  value: any;
  description?: string | undefined;
  icon?: string | undefined;
}

/** Dynamic condition predicate for property visibility or enablement */
export type PropertyPredicate = string | ((ctx: any) => boolean);

/** Field-level validation rule */
export interface PropertyFieldValidation {
  min?: number | undefined;
  max?: number | undefined;
  pattern?: string | undefined;
  validate?: ((value: any, ctx: any) => string | null) | undefined;
}

/** Declarative property field definition */
export interface PropertyFieldConfig {
  key: string;
  label: string;
  kind: PropertyFieldKind;
  description?: string | undefined;
  placeholder?: string | undefined;
  defaultValue?: any;
  unit?: string | undefined;
  choices?: (string | PropertyChoiceOption)[] | ((ctx: any) => (string | PropertyChoiceOption)[]) | undefined;
  enabledIf?: PropertyPredicate | undefined;
  visibleIf?: PropertyPredicate | undefined;
  required?: boolean | undefined;
  validation?: PropertyFieldValidation | undefined;
  readOnly?: boolean | undefined;
}

/** Declarative group (accordion/collapsible section) */
export interface PropertyGroupConfig {
  id: string;
  label: string;
  description?: string | undefined;
  collapsedByDefault?: boolean | undefined;
  visibleIf?: PropertyPredicate | undefined;
  fields: PropertyFieldConfig[];
}

/** Declarative tab */
export interface PropertyTabConfig {
  id: string;
  label: string;
  icon?: string | undefined;
  visibleIf?: PropertyPredicate | undefined;
  groups: PropertyGroupConfig[];
}

/** Schema for an entity rule */
export interface EntityPropertySchema<_RuleName extends string = string> {
  title?: string | ((node: any) => string) | undefined;
  icon?: string | ((node: any) => string) | undefined;
  tabs: PropertyTabConfig[];
}

/** In-model dynamic property and annotation discovery (e.g. Modelica Dialog) */
export interface InModelPropertyDiscoveryHook {
  extractSchema?: ((db: any, node: any, queryEngine: any) => EntityPropertySchema | null) | undefined;
  extractValues?: ((db: any, node: any, queryEngine: any) => Record<string, any> | null) | undefined;
}

/** AST mutation handler for updating properties back to source code */
export interface PropertyMutator<_RuleName extends string = string> {
  updateProperty?: ((db: any, node: any, key: string, value: any, previousValue?: any) => any) | undefined;
  updateModifier?: ((docText: string, node: any, paramName: string, newValue: any) => any) | undefined;
}

/** Property Inspector configuration for a language */
export interface PropertyInspectorConfig<
  RuleName extends string = string,
  _FieldName extends string = string,
  _QueryName extends string = string,
  _ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  entities?: Partial<Record<NoInfer<RuleName>, EntityPropertySchema<RuleName>>> | undefined;
  inModelDiscovery?: InModelPropertyDiscoveryHook | undefined;
  mutator?: PropertyMutator<RuleName> | undefined;
}

/**
 * Declarative sidecar configuration for diagram spatial persistence.
 */
export interface SidecarConfig {
  /**
   * File extension for the sidecar file. Default: ".layout".
   * Examples: ".layout.json", ".sysml.layout", ".layout.yaml"
   */
  extension?: string | undefined;

  /**
   * Path resolution policy.
   * - "alongside": Saved adjacent to source file: `dir/Model.sysml` -> `dir/Model.sysml.layout`
   * - "hidden": Saved as hidden file: `dir/.Model.sysml.layout`
   * - "subfolder": Saved in subfolder: `dir/.layouts/Model.sysml.layout`
   * - Custom resolver function: `(docUri: string, extension: string) => string`
   * Default: "alongside"
   */
  location?: "alongside" | "hidden" | "subfolder" | ((docUri: string, extension: string) => string) | undefined;

  /**
   * Serialization format. Default: "json".
   */
  format?: "json" | "yaml" | "custom" | undefined;

  /** Custom serializer (Layout object -> string) */
  serialize?: ((layout: any) => string) | undefined;

  /** Custom parser (string -> Layout object) */
  parse?: ((content: string) => any) | undefined;
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
  properties?: PropertyInspectorConfig<RuleName, FieldName, QueryName, ModelAttrs> | undefined;

  /** Static / built-in diagram projections */
  projections?: Record<string, DiagramProjectionConfig<RuleName, FieldName>> | undefined;
  views?: Record<string, DiagramProjectionConfig<RuleName, FieldName>> | undefined; // Alias for backward-compat

  /** Dynamic in-model projection / view discovery from user AST (e.g. SysML2 views) */
  inModelProjections?: InModelProjectionDiscoveryConfig<RuleName, FieldName> | undefined;
  inModelViews?: InModelProjectionDiscoveryConfig<RuleName, FieldName> | undefined; // Alias for backward-compat

  /** In-model graphic annotations & vector shape extraction (optional fallback) */
  annotations?: GraphicAnnotationsConfig<RuleName, FieldName> | undefined;

  /** General in-language expression evaluation engine (evaluates in-code expressions at design-time and live simulation) */
  evaluator?: ExpressionEvaluatorConfig | undefined;

  /** Universal reactive dynamics & simulation animation protocol (e.g. DynamicSelect) */
  dynamics?: ReactiveDynamicsConfig | undefined;
  dynamicSelect?: ReactiveDynamicsConfig | undefined; // Alias for backward-compat

  /** Visual entity / node configurations */
  entities?:
    | Partial<Record<NoInfer<RuleName>, VisualNodeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>
    | undefined;
  nodes?: Partial<Record<NoInfer<RuleName>, VisualNodeConfig<RuleName, FieldName, QueryName, ModelAttrs>>> | undefined; // Alias for backward-compat

  /** Visual relationship / edge configurations */
  connections?:
    | Partial<Record<NoInfer<RuleName>, VisualEdgeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>
    | undefined;
  edges?: Partial<Record<NoInfer<RuleName>, VisualEdgeConfig<RuleName, FieldName, QueryName, ModelAttrs>>> | undefined; // Alias for backward-compat

  /** Visual mutations (Unparser-backed AST transformations) */
  mutations?: VisualMutationConfig | undefined;

  /** Stencil / Palette configuration */
  palette?: DiagramPaletteConfig | undefined;

  /** Spatial placement storage strategy */
  placement?:
    | {
        persistence?: "inline" | "sidecar" | undefined;
        rule?: string | undefined;
        formatPlacement?: ((x: number, y: number, w?: number, h?: number, r?: number) => string) | undefined;
        parsePlacement?:
          | ((node: any) => { x: number; y: number; width?: number | undefined; height?: number | undefined })
          | undefined;
        /** Declarative sidecar file options (used when persistence is "sidecar") */
        sidecar?: SidecarConfig | undefined;
      }
    | undefined;

  /** Grammar rule classification sets for structural parent & standalone children */
  structuralRules?: (RuleName | string)[] | undefined;
  standaloneRules?: (RuleName | string)[] | undefined;
  usageRules?: (RuleName | string)[] | undefined;
  definitionRules?: (RuleName | string)[] | undefined;
  portRules?: (RuleName | string)[] | undefined;
  reactiveDynamics?: boolean | undefined;
}

/**
 * Compiles a declarative DiagramConfig into the GraphicsConfig dictionary
 * and PolyglotDiagramOptions consumed by buildPolyglotDiagram.
 */
export function compileDiagramConfigToPolyglot(diagramConfig?: DiagramConfig): {
  gfxConfig: Record<string, any>;
  graphicsConfig: Record<string, any>;
  options: {
    customProjections?: Record<string, any> | undefined;
    structuralKinds?: string[] | undefined;
    standaloneKinds?: string[] | undefined;
    usageKinds?: string[] | undefined;
    definitionKinds?: string[] | undefined;
    portKinds?: string[] | undefined;
    reactiveDynamics?: boolean | undefined;
    inModelDiscovery?: any;
    solderDots?: boolean | undefined;
    mutations?: VisualMutationConfig | undefined;
    palette?: DiagramPaletteConfig | undefined;
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
