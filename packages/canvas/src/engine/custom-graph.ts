// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AlignmentGuideLine } from "../core/alignment-guides.js";
import { CameraController } from "../core/camera.js";
import { Scissor3DPortalManager, type Embedded3DPortalSpec } from "../renderers/scissor-3d-manager.js";
import { ScissorSnapshotBaker } from "../renderers/snapshot-baker.js";
import { SpatialSurfaceBridge } from "../renderers/spatial-vr-bridge.js";
import { WebGpuSchematicRenderer, type WebGpuLike } from "../renderers/webgpu-renderer.js";
import type { WorldBounds, WorldPoint } from "../schema/canvas-document.js";
import { hitTestScatterBrush, paintCanvasPlot, type CanvasPlotSpec } from "../widgets/canvas-plot.js";
import {
  paintCanvasTable,
  paintStickyBadge,
  type CanvasTableSpec,
  type StickyBadgeSpec,
} from "../widgets/canvas-table.js";
import {
  AnimationPropKind,
  CompiledAnimationEngine,
  SimulationTimelineStore,
  type AnimationBindingSpec,
} from "./animation-engine.js";
import {
  applyAttrsToGlyph,
  compileGlyphMarkup,
  materializeGlyphToSvg,
  paintGlyphToCanvas2D,
  patchGlyphAttrPath,
  readGlyphAttrPath,
  setSvgTextContent,
  type Canvas2DContextLike,
  type CompiledGlyph,
  type DiagramMarkupNode,
} from "./glyph-compiler.js";
import { CanvasPointerFSM, type ResizeHandleKind, type WiringPreview } from "./pointer-fsm.js";
import { SceneNodeFlags, SoaSceneGraph, type SoaEdgeRecord } from "./soa-scene.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface UnifiedEdgeTerminal {
  cell?: string | undefined;
  port?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  anchor?: unknown;
  connectionPoint?: unknown;
}

export interface UnifiedPortItem {
  id: string;
  group?: string | undefined;
  args?: { x?: number | undefined; y?: number | undefined; angle?: number | undefined } | undefined;
  markup?: DiagramMarkupNode | DiagramMarkupNode[] | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  direction?: string | undefined;
  [key: string]: unknown;
}

export interface UnifiedCellView {
  cell: UnifiedCell;
  graph: UnifiedGraph;
  container: Element | null;
  routePoints: WorldPoint[];
  sourcePoint?: WorldPoint | undefined;
  targetPoint?: WorldPoint | undefined;
  getVertexIndex(x: number, y: number): number;
}

export type UnifiedRouterFn = (
  vertices: WorldPoint[],
  args: Record<string, unknown>,
  view: UnifiedCellView,
) => WorldPoint[];

export type UnifiedConnectorFn = (
  sourcePoint: WorldPoint,
  targetPoint: WorldPoint,
  routePoints: WorldPoint[],
  args: Record<string, unknown>,
  view: UnifiedCellView,
) => string;

export interface UnifiedSelectionOptions {
  enabled?: boolean | undefined;
  showNodeSelectionBox?: boolean | undefined;
  showEdgeSelectionBox?: boolean | undefined;
  rubberband?: boolean | undefined;
  multiple?: boolean | undefined;
  modifiers?: string | string[] | undefined;
  multipleSelectionModifiers?: string | string[] | undefined;
  pointerEvents?: string | undefined;
  filter?: ((cell: UnifiedCell) => boolean) | undefined;
}

export interface UnifiedTransformOptions {
  resizing?: boolean | { enabled?: boolean | ((node: UnifiedCell) => boolean) | undefined } | undefined;
  rotating?: boolean | { enabled?: boolean | ((node: UnifiedCell) => boolean) | undefined } | undefined;
}

export interface UnifiedGraphOptions {
  container?: HTMLElement | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** Rendering backend mode: "auto" switches to virtualized Canvas2D/WebGPU above highScaleThreshold nodes. */
  renderMode?: "auto" | "svg" | "canvas2d" | undefined;
  /** Node threshold at which "auto" mode switches from SVG DOM to high-scale Canvas2D/WebGPU (default: 1500). */
  highScaleThreshold?: number | undefined;
  /** Prefer WebGPU instanced schematic pipeline when high-scale mode activates and `navigator.gpu` is available. */
  preferWebGpu?: boolean | undefined;
  /** Callback fired when the user brushes scatter/Pareto samples on a pinned plot widget. */
  onWidgetBrush?: ((widgetId: string, brushedIndices: number[], linkedIds: string[]) => void) | undefined;
  async?: boolean | undefined;
  autoResize?: boolean | undefined;
  background?: { color?: string | undefined } | undefined;
  grid?:
    | boolean
    | number
    | {
        size?: number | undefined;
        visible?: boolean | undefined;
        type?: string | undefined;
        args?: unknown;
      }
    | undefined;
  panning?: boolean | { enabled?: boolean | undefined } | undefined;
  mousewheel?:
    | boolean
    | { enabled?: boolean | undefined; global?: boolean | undefined; modifiers?: string | string[] | undefined }
    | undefined;
  embedding?: { enabled?: boolean | undefined } | undefined;
  interacting?: boolean | ((view: { cell: UnifiedCell }) => boolean | Record<string, boolean>) | undefined;
  connecting?:
    | {
        router?: unknown;
        connector?: unknown;
        snap?: boolean | { radius?: number | undefined } | undefined;
        allowBlank?: boolean | (() => boolean) | undefined;
        allowMulti?: boolean | (() => boolean) | undefined;
        allowLoop?: boolean | (() => boolean) | undefined;
        allowNode?: boolean | (() => boolean) | undefined;
        allowEdge?: boolean | (() => boolean) | undefined;
        allowPort?: boolean | (() => boolean) | undefined;
        highlight?: boolean | undefined;
        highlighting?: Record<string, unknown> | undefined;
        validateMagnet?:
          | ((args: { cell?: UnifiedCell | null | undefined; magnet?: Element | null | undefined }) => boolean)
          | undefined;
        validateConnection?:
          | ((args: {
              sourceCell?: UnifiedCell | null | undefined;
              targetCell?: UnifiedCell | null | undefined;
              sourceMagnet?: Element | null | undefined;
              targetMagnet?: Element | null | undefined;
              sourcePort?: string | null | undefined;
              targetPort?: string | null | undefined;
            }) => boolean)
          | undefined;
        validateEdge?: ((args: { edge: UnifiedCell }) => boolean) | undefined;
        createEdge?: (() => UnifiedCell) | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface UnifiedCanvasWidgetSpec {
  id: string;
  kind: "plot" | "table" | "sticky";
  bounds: WorldBounds;
  plot?: CanvasPlotSpec | undefined;
  table?: CanvasTableSpec | undefined;
  sticky?: StickyBadgeSpec | undefined;
  /** Optional world-space leader tether target (wire/port) drawn as a dashed connector. */
  tetherTarget?: { x: number; y: number; label?: string | undefined } | undefined;
}

/** Selection plugin replacement with native rotated/flipped OBB selection boxes. */
export class UnifiedSelection {
  public readonly name = "selection";
  public readonly options: UnifiedSelectionOptions;
  public selectionImpl: {
    container?: HTMLElement | undefined;
    createSelectionBox?: ((cell: UnifiedCell) => void) | undefined;
    repositionSelectionBoxesInPlace?: (() => void) | undefined;
  } = {};

  constructor(options: UnifiedSelectionOptions = {}) {
    this.options = options;
  }
}

/** Transform plugin replacement with native rotated 8-way resize & rotate handles. */
export class UnifiedTransform {
  public readonly name = "transform";
  public readonly options: UnifiedTransformOptions;

  constructor(options: UnifiedTransformOptions = {}) {
    this.options = options;
  }
}

function defaultPolylinePath(
  source: WorldPoint,
  target: WorldPoint,
  routePoints: WorldPoint[],
  connectorName: string,
  radius = 8,
): string {
  const pts = [source, ...routePoints, target];
  if (pts.length < 2) return "";
  if (connectorName === "rounded" && pts.length >= 3 && radius > 0) {
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const next = pts[i + 1]!;
      const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
      const r = Math.min(radius, d1 / 2, d2 / 2);
      if (r <= 0.5) {
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }
      const p1x = curr.x - ((curr.x - prev.x) / d1) * r;
      const p1y = curr.y - ((curr.y - prev.y) / d1) * r;
      const p2x = curr.x + ((next.x - curr.x) / d2) * r;
      const p2y = curr.y + ((next.y - curr.y) / d2) * r;
      d += ` L ${p1x} ${p1y} Q ${curr.x} ${curr.y} ${p2x} ${p2y}`;
    }
    const last = pts[pts.length - 1]!;
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i]!.x} ${pts[i]!.y}`;
  }
  return d;
}

let autoCellCounter = 1;

function resolvePortScalar(raw: unknown, total: number): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.endsWith("%")) {
      const pct = parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(pct) ? (pct / 100) * total : undefined;
    }
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function resolvePortsWithGroups(
  items: UnifiedPortItem[],
  groups: Record<string, unknown>,
  width: number,
  height: number,
): UnifiedPortItem[] {
  const countsByGroup = new Map<string, number>();
  for (const p of items) {
    const g = p.group ?? "";
    countsByGroup.set(g, (countsByGroup.get(g) ?? 0) + 1);
  }
  const indexByGroup = new Map<string, number>();

  return items.map((raw) => {
    const p: UnifiedPortItem = { ...raw, args: raw.args ? { ...raw.args } : {} };
    const grpName = p.group ?? "";
    const idx = indexByGroup.get(grpName) ?? 0;
    indexByGroup.set(grpName, idx + 1);
    const totalInGroup = countsByGroup.get(grpName) ?? 1;

    const grpSpec =
      grpName && typeof groups[grpName] === "object" && groups[grpName] !== null
        ? (groups[grpName] as Record<string, unknown>)
        : null;

    if (!p.markup && grpSpec?.["markup"]) {
      p.markup = grpSpec["markup"] as DiagramMarkupNode | DiagramMarkupNode[];
    }
    if (!p.attrs && grpSpec?.["attrs"]) {
      p.attrs = grpSpec["attrs"] as Record<string, Record<string, unknown>>;
    }

    const posSpec = grpSpec?.["position"];
    const posName =
      typeof posSpec === "string"
        ? posSpec
        : posSpec && typeof posSpec === "object"
          ? String((posSpec as Record<string, unknown>)["name"] ?? "")
          : grpName;
    const posArgs =
      posSpec && typeof posSpec === "object" && typeof (posSpec as Record<string, unknown>)["args"] === "object"
        ? ((posSpec as Record<string, unknown>)["args"] as Record<string, unknown>)
        : undefined;

    const rawX = (p.args as Record<string, unknown> | undefined)?.["x"] ?? posArgs?.["x"];
    const rawY = (p.args as Record<string, unknown> | undefined)?.["y"] ?? posArgs?.["y"];
    let x = resolvePortScalar(rawX, width);
    let y = resolvePortScalar(rawY, height);

    const frac = (idx + 1) / (totalInGroup + 1);
    if (x === undefined || y === undefined) {
      if (posName === "left" || posName === "in") {
        if (x === undefined) x = 0;
        if (y === undefined) y = height * frac;
      } else if (posName === "right" || posName === "out") {
        if (x === undefined) x = width;
        if (y === undefined) y = height * frac;
      } else if (posName === "top") {
        if (x === undefined) x = width * frac;
        if (y === undefined) y = 0;
      } else if (posName === "bottom") {
        if (x === undefined) x = width * frac;
        if (y === undefined) y = height;
      }
    }

    p.args = {
      ...(p.args ?? {}),
      x: x ?? 0,
      y: y ?? 0,
    };
    return p;
  });
}

/**
 * Unified Cell (Node or Edge) backed by `SoaSceneGraph` and `CompiledGlyph`.
 * Implements the full drop-in API surface previously satisfied by AntV X6 cells.
 */
export class UnifiedCell {
  public readonly id: string;
  public readonly kind: "node" | "edge";
  public shape: string;
  public x = 0;
  public y = 0;
  public width = 0;
  public height = 0;
  public angle = 0;
  public zIndex = 0;
  public visible = true;
  public opacity = 1;

  public source?: UnifiedEdgeTerminal | undefined;
  public target?: UnifiedEdgeTerminal | undefined;
  public vertices: WorldPoint[] = [];
  public router?: unknown;
  public connector?: unknown;
  public labels: unknown[] = [];

  private graph: UnifiedGraph | null = null;
  private data: Record<string, unknown> = {};
  private markup: DiagramMarkupNode | DiagramMarkupNode[] | undefined;
  private attrs: Record<string, Record<string, unknown>> = {};
  private compiledGlyph: CompiledGlyph | null = null;
  private ports: UnifiedPortItem[] = [];
  private portGroups: Record<string, unknown> = {};
  private children = new Set<UnifiedCell>();
  private parent: UnifiedCell | null = null;
  private tools: unknown[] = [];
  private customProps = new Map<string, unknown>();

  /** Optional live DOM elements bound to this cell when mounted in a browser surface. */
  public view: UnifiedCellView | null = null;
  public selectorElements = new Map<string, Element[]>();

  constructor(kind: "node" | "edge", metadata: Record<string, unknown>, graph?: UnifiedGraph | null) {
    this.kind = kind;
    this.graph = graph ?? null;
    this.id =
      typeof metadata["id"] === "string" && metadata["id"].length > 0 ? metadata["id"] : `${kind}_${autoCellCounter++}`;
    this.shape = typeof metadata["shape"] === "string" ? metadata["shape"] : kind === "edge" ? "edge" : "rect";
    this.zIndex = typeof metadata["zIndex"] === "number" ? metadata["zIndex"] : 0;
    this.opacity = typeof metadata["opacity"] === "number" ? metadata["opacity"] : 1;
    this.visible = metadata["visible"] !== false;

    if (metadata["data"] && typeof metadata["data"] === "object") {
      this.data = { ...(metadata["data"] as Record<string, unknown>) };
    }
    if (metadata["attrs"] && typeof metadata["attrs"] === "object") {
      for (const [k, v] of Object.entries(metadata["attrs"] as Record<string, unknown>)) {
        if (v && typeof v === "object") {
          this.attrs[k] = { ...(v as Record<string, unknown>) };
        }
      }
    }

    if (kind === "node") {
      this.x = typeof metadata["x"] === "number" ? metadata["x"] : 0;
      this.y = typeof metadata["y"] === "number" ? metadata["y"] : 0;
      this.width = typeof metadata["width"] === "number" ? metadata["width"] : 80;
      this.height = typeof metadata["height"] === "number" ? metadata["height"] : 40;
      this.angle = typeof metadata["angle"] === "number" ? metadata["angle"] : 0;
      this.markup = metadata["markup"] as DiagramMarkupNode | DiagramMarkupNode[] | undefined;

      const rawPorts = metadata["ports"] as
        | { items?: UnifiedPortItem[] | undefined; groups?: Record<string, unknown> | undefined }
        | UnifiedPortItem[]
        | undefined;
      if (Array.isArray(rawPorts)) {
        this.ports = resolvePortsWithGroups(rawPorts, this.portGroups, this.width, this.height);
      } else if (rawPorts && typeof rawPorts === "object") {
        this.portGroups = rawPorts.groups ? { ...rawPorts.groups } : {};
        const rawItems = Array.isArray(rawPorts.items) ? rawPorts.items : [];
        this.ports = resolvePortsWithGroups(rawItems, this.portGroups, this.width, this.height);
      }
      this.compiledGlyph = compileGlyphMarkup(this.markup, this.attrs, this.width, this.height);
    } else {
      this.source = this.normalizeTerminal(metadata["source"]);
      this.target = this.normalizeTerminal(metadata["target"]);
      if (Array.isArray(metadata["vertices"])) {
        this.vertices = (metadata["vertices"] as WorldPoint[]).map((p) => ({ x: p.x, y: p.y }));
      }
      this.router = metadata["router"];
      this.connector = metadata["connector"];
      if (Array.isArray(metadata["labels"])) {
        this.labels = [...metadata["labels"]];
      }
    }
  }

  private normalizeTerminal(raw: unknown): UnifiedEdgeTerminal {
    if (typeof raw === "string") return { cell: raw };
    if (raw && typeof raw === "object") {
      return { ...(raw as UnifiedEdgeTerminal) };
    }
    return {};
  }

  public attachGraph(graph: UnifiedGraph | null): void {
    this.graph = graph;
  }

  public isNode(): boolean {
    return this.kind === "node";
  }

  public isEdge(): boolean {
    return this.kind === "edge";
  }

  public getCompiledGlyph(): CompiledGlyph | null {
    return this.compiledGlyph;
  }

  public remove(): void {
    this.graph?.removeCell(this);
  }

  public getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  public setPosition(x: number, y: number, options?: { silent?: boolean | undefined }): void {
    const prev = { x: this.x, y: this.y };
    const dx = x - this.x;
    const dy = y - this.y;
    this.x = x;
    this.y = y;
    this.graph?.scene.setNodePosition(this.id, x, y);
    if (dx !== 0 || dy !== 0) {
      for (const child of this.children) {
        child.x += dx;
        child.y += dy;
      }
    }
    this.graph?.syncCellDom(this);
    if (!options?.silent) {
      this.graph?.emit("node:change:position", {
        cell: this,
        node: this,
        current: { x, y },
        previous: prev,
      });
    }
  }

  public position(x?: number, y?: number): { x: number; y: number } {
    if (typeof x === "number" && typeof y === "number") {
      this.setPosition(x, y);
    }
    return this.getPosition();
  }

  public translate(dx: number, dy: number): void {
    this.setPosition(this.x + dx, this.y + dy);
  }

  public getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  public size(width?: number, height?: number): { width: number; height: number } {
    if (typeof width === "number" && typeof height === "number") {
      this.setSize(width, height);
    }
    return this.getSize();
  }

  public setSize(width: number, height: number): void {
    const prev = { width: this.width, height: this.height };
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.graph?.scene.setNodeSize(this.id, this.width, this.height);
    this.graph?.syncCellDom(this);
    this.graph?.emit("node:change:size", {
      cell: this,
      node: this,
      current: { width: this.width, height: this.height },
      previous: prev,
    });
  }

  public resize(width: number, height: number): void {
    this.setSize(width, height);
  }

  public getAngle(): number {
    return this.angle;
  }

  public rotate(angle: number, options?: { absolute?: boolean | undefined }): void {
    const prev = this.angle;
    const next = options?.absolute ? angle : this.angle + angle;
    this.angle = ((next % 360) + 360) % 360;
    this.graph?.scene.setNodeRotation(this.id, this.angle);
    this.graph?.syncCellDom(this);
    this.graph?.emit("node:change:angle", { cell: this, node: this, current: this.angle, previous: prev });
  }

  public getBBox(): WorldBounds {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  public getZIndex(): number {
    return this.zIndex;
  }

  public setZIndex(z: number): void {
    this.zIndex = z;
    this.graph?.syncCellDom(this);
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.graph?.scene.setNodeFlag(this.id, SceneNodeFlags.VISIBLE, visible);
    if (this.view?.container && "style" in this.view.container) {
      (this.view.container as HTMLElement).style.display = visible ? "" : "none";
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public getData(): Record<string, unknown> {
    return this.data;
  }

  public setData(
    data: Record<string, unknown>,
    options?: { overwrite?: boolean | undefined; [key: string]: unknown },
  ): void {
    this.data = options?.overwrite ? { ...data } : { ...this.data, ...data };
    if (this.kind === "node") {
      const flipX = Boolean(this.data["flipX"]);
      const flipY = Boolean(this.data["flipY"]);
      this.graph?.scene.setNodeFlip(this.id, flipX, flipY);
    }
    this.graph?.syncCellDom(this);
  }

  public getMarkup(): DiagramMarkupNode | DiagramMarkupNode[] | undefined {
    return this.markup;
  }

  public setMarkup(markup: unknown): void {
    this.markup = markup as DiagramMarkupNode | DiagramMarkupNode[] | undefined;
    if (this.kind === "node") {
      this.compiledGlyph = compileGlyphMarkup(this.markup, this.attrs, this.width, this.height);
      this.graph?.rebuildCellDom(this);
    }
  }

  public getAttrs(): Record<string, Record<string, unknown>> {
    return this.attrs;
  }

  public setAttrs(attrs: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(attrs)) {
      if (v && typeof v === "object") {
        this.attrs[k] = { ...(this.attrs[k] ?? {}), ...(v as Record<string, unknown>) };
      }
    }
    if (this.compiledGlyph) {
      applyAttrsToGlyph(this.compiledGlyph, this.attrs);
    }
    this.graph?.syncCellDom(this);
  }

  public attr(path: string, val?: unknown): unknown {
    if (arguments.length === 1) {
      const slash = path.indexOf("/");
      if (slash > 0) {
        const sel = path.slice(0, slash);
        const key = path.slice(slash + 1);
        const stored = this.attrs[sel]?.[key];
        if (stored !== undefined) return stored;
        return this.compiledGlyph ? readGlyphAttrPath(this.compiledGlyph, path) : undefined;
      }
      return this.attrs[path];
    }

    const slash = path.indexOf("/");
    if (slash > 0) {
      const sel = path.slice(0, slash);
      const key = path.slice(slash + 1);
      if (!this.attrs[sel]) this.attrs[sel] = {};
      if (val === null || val === undefined) {
        Reflect.deleteProperty(this.attrs[sel]!, key);
      } else {
        this.attrs[sel]![key] = val;
      }
      if (this.compiledGlyph) {
        patchGlyphAttrPath(this.compiledGlyph, path, val);
      }
      this.graph?.patchCellSelectorDom(this, sel, key, val);
    } else if (val && typeof val === "object") {
      this.attrs[path] = { ...(this.attrs[path] ?? {}), ...(val as Record<string, unknown>) };
      if (this.compiledGlyph) applyAttrsToGlyph(this.compiledGlyph, this.attrs);
      this.graph?.syncCellDom(this);
    }
    return this;
  }

  public prop(path: string | string[], val?: unknown): unknown {
    const key = Array.isArray(path) ? path.join("/") : path;
    if (arguments.length === 1) {
      if (key === "source") return this.source;
      if (key === "target") return this.target;
      if (key === "source/anchor") return this.source?.anchor;
      if (key === "target/anchor") return this.target?.anchor;
      if (key === "zIndex") return this.zIndex;
      if (key === "ports") return { items: this.ports, groups: this.portGroups };
      return this.customProps.get(key);
    }
    if (key === "source/anchor" && this.source) this.source.anchor = val;
    else if (key === "target/anchor" && this.target) this.target.anchor = val;
    else if (key === "zIndex" && typeof val === "number") this.setZIndex(val);
    else if (key === "ports") {
      if (Array.isArray(val)) {
        this.ports = resolvePortsWithGroups(val as UnifiedPortItem[], this.portGroups, this.width, this.height);
      } else if (val && typeof val === "object") {
        const obj = val as { items?: UnifiedPortItem[] | undefined; groups?: Record<string, unknown> | undefined };
        if (obj.groups) this.portGroups = { ...obj.groups };
        const rawItems = Array.isArray(obj.items) ? obj.items : [];
        this.ports = resolvePortsWithGroups(rawItems, this.portGroups, this.width, this.height);
      }
      this.graph?.scene.setNodePorts(
        this.id,
        this.ports.map((p) => ({
          id: p.id,
          group: p.group,
          x: p.args?.x ?? 0,
          y: p.args?.y ?? 0,
          angle: p.args?.angle,
        })),
      );
      this.graph?.rebuildCellDom(this);
    } else this.customProps.set(key, val);
    return this;
  }

  public setPortProp(portId: string, path: string | string[], val?: unknown): this {
    const port = this.ports.find((p) => p.id === portId);
    if (!port) return this;
    const key = Array.isArray(path) ? path.join("/") : path;
    if (key === "args" && val && typeof val === "object") {
      port.args = { ...(port.args ?? {}), ...(val as Record<string, unknown>) };
    } else if (key.startsWith("args/")) {
      const sub = key.slice(5);
      port.args = { ...(port.args ?? {}), [sub]: val };
    } else if (key === "attrs" && val && typeof val === "object") {
      port.attrs = { ...(port.attrs ?? {}), ...(val as Record<string, Record<string, unknown>>) };
    } else if (key.startsWith("attrs/")) {
      const rest = key.slice(6);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        const sel = rest.slice(0, slash);
        const attrKey = rest.slice(slash + 1);
        port.attrs = port.attrs ?? {};
        port.attrs[sel] = { ...(port.attrs[sel] ?? {}), [attrKey]: val };
      }
    } else if (key === "markup") {
      port.markup = val as DiagramMarkupNode | DiagramMarkupNode[] | undefined;
    }
    this.ports = resolvePortsWithGroups(this.ports, this.portGroups, this.width, this.height);
    this.graph?.scene.setNodePorts(
      this.id,
      this.ports.map((p) => ({
        id: p.id,
        group: p.group,
        x: p.args?.x ?? 0,
        y: p.args?.y ?? 0,
        angle: p.args?.angle,
      })),
    );
    const updatedPort = this.ports.find((p) => p.id === portId);
    const containerEl = this.view?.container;
    const existingPortEl =
      (key === "args" || key.startsWith("args/")) && containerEl
        ? containerEl.querySelector(`.x6-port[port-id="${portId}"], .x6-port[port="${portId}"]`)
        : null;
    if (existingPortEl && updatedPort) {
      existingPortEl.setAttribute("transform", `translate(${updatedPort.args?.x ?? 0}, ${updatedPort.args?.y ?? 0})`);
    } else {
      this.graph?.rebuildCellDom(this);
    }
    return this;
  }

  public removeProp(path: string | string[]): void {
    const key = Array.isArray(path) ? path.join("/") : path;
    if (key === "source/anchor" && this.source) delete this.source.anchor;
    else if (key === "target/anchor" && this.target) delete this.target.anchor;
    else this.customProps.delete(key);
  }

  public addChild(child: UnifiedCell): void {
    this.children.add(child);
    child.parent = this;
    this.graph?.scene.setParent(child.id, this.id);
  }

  public removeChild(child: UnifiedCell): void {
    this.children.delete(child);
    if (child.parent === this) child.parent = null;
    this.graph?.scene.setParent(child.id, null);
  }

  public getParent(): UnifiedCell | null {
    return this.parent;
  }

  public getChildren(): UnifiedCell[] {
    return Array.from(this.children);
  }

  public getPorts(): UnifiedPortItem[] {
    return this.ports;
  }

  public getPort(portId: string): UnifiedPortItem | undefined {
    return this.ports.find((p) => p.id === portId);
  }

  public getPortProp(portId: string, prop?: string): unknown {
    const p = this.getPort(portId);
    if (!p) return undefined;
    if (!prop) return p;
    return p[prop];
  }

  public getPortGroups(): Record<string, unknown> {
    return this.portGroups;
  }

  public getSource(): UnifiedEdgeTerminal {
    return this.source ?? {};
  }

  public setSource(source: UnifiedEdgeTerminal): void {
    this.source = this.normalizeTerminal(source);
    this.graph?.syncEdgeToScene(this);
    this.graph?.syncCellDom(this);
    this.graph?.emit("edge:change:source", { cell: this, edge: this, current: this.source });
  }

  public getTarget(): UnifiedEdgeTerminal {
    return this.target ?? {};
  }

  public setTarget(target: UnifiedEdgeTerminal): void {
    this.target = this.normalizeTerminal(target);
    this.graph?.syncEdgeToScene(this);
    this.graph?.syncCellDom(this);
    this.graph?.emit("edge:change:target", { cell: this, edge: this, current: this.target });
  }

  public getSourceCellId(): string {
    return this.source?.cell ?? "";
  }

  public getTargetCellId(): string {
    return this.target?.cell ?? "";
  }

  public getSourcePortId(): string | undefined {
    return this.source?.port;
  }

  public getTargetPortId(): string | undefined {
    return this.target?.port;
  }

  public getSourceCell(): UnifiedCell | null {
    return this.source?.cell ? (this.graph?.getCellById(this.source.cell) ?? null) : null;
  }

  public getTargetCell(): UnifiedCell | null {
    return this.target?.cell ? (this.graph?.getCellById(this.target.cell) ?? null) : null;
  }

  public getSourcePoint(): WorldPoint {
    if (this.source && typeof this.source.x === "number" && typeof this.source.y === "number") {
      return { x: this.source.x, y: this.source.y };
    }
    const edgeRec = this.graph?.scene.getEdge(this.id);
    if (edgeRec && this.graph) {
      return this.graph.scene.resolveEdgeEndpoints(edgeRec).source;
    }
    return { x: 0, y: 0 };
  }

  public getTargetPoint(): WorldPoint {
    if (this.target && typeof this.target.x === "number" && typeof this.target.y === "number") {
      return { x: this.target.x, y: this.target.y };
    }
    const edgeRec = this.graph?.scene.getEdge(this.id);
    if (edgeRec && this.graph) {
      return this.graph.scene.resolveEdgeEndpoints(edgeRec).target;
    }
    return { x: 0, y: 0 };
  }

  public getVertices(): WorldPoint[] {
    return this.vertices.map((p) => ({ x: p.x, y: p.y }));
  }

  public setVertices(vertices: WorldPoint[], options?: { ignoreSnap?: boolean | undefined }): void {
    this.vertices = vertices.map((p) => ({ x: p.x, y: p.y }));
    this.graph?.syncEdgeToScene(this);
    this.graph?.syncCellDom(this);
    this.graph?.emit("edge:change:vertices", {
      cell: this,
      edge: this,
      current: this.getVertices(),
      options,
    });
  }

  public insertVertex(vertex: WorldPoint, index?: number): void {
    const idx = index === undefined ? this.vertices.length : Math.max(0, Math.min(this.vertices.length, index));
    const next = this.getVertices();
    next.splice(idx, 0, { x: vertex.x, y: vertex.y });
    this.setVertices(next);
  }

  public getRouter(): unknown {
    return this.router;
  }

  public setRouter(router: unknown): void {
    this.router = router;
    this.graph?.syncCellDom(this);
  }

  public removeRouter(): void {
    this.router = undefined;
    this.graph?.syncCellDom(this);
  }

  public getConnector(): unknown {
    return this.connector;
  }

  public setConnector(connector: unknown): void {
    this.connector = connector;
    this.graph?.syncCellDom(this);
  }

  public setLabels(labels: unknown[]): void {
    this.labels = [...labels];
    this.graph?.syncCellDom(this);
  }

  public addTools(tools: unknown[]): void {
    this.tools = [...tools];
    this.graph?.syncEdgeToolsDom(this);
  }

  public removeTools(): void {
    this.tools = [];
    this.graph?.syncEdgeToolsDom(this);
  }

  public getTools(): unknown[] {
    return this.tools;
  }

  public startBatch(_name: string): void {
    // Supported for tool compatibility
  }

  public stopBatch(_name: string): void {
    // Supported for tool compatibility
  }

  public findView(graph?: UnifiedGraph): UnifiedCellView | null {
    const g = graph ?? this.graph;
    return g ? g.findViewByCell(this) : this.view;
  }
}

/**
 * Custom Unified Graph Engine — 100% AntV X6 Replacement.
 *
 * Combines:
 *  - SoaSceneGraph (50,000+ node scalability & zero-copy WASM export)
 *  - CameraController (cursor-centered zoom, pan, fit, bookmarks)
 *  - CanvasPointerFSM (DOM-free 2D/3D/VR interaction with native rotated handles & orthogonal segment drag)
 *  - Scissor3DPortalManager (unlimited embedded CAD/FEA/CFD viewports on 1 WebGL context)
 *  - CompiledAnimationEngine + SimulationTimelineStore (zero-GC 60 FPS SCADA & Modelica animation)
 *  - Canvas2D Plot/Table widgets (Modelon Impact-style pinned widgets & VR CanvasTexture support)
 */
export class UnifiedGraph {
  private static readonly routerRegistry = new Map<string, UnifiedRouterFn>();
  private static readonly connectorRegistry = new Map<string, UnifiedConnectorFn>();

  public static registerRouter(name: string, fn: UnifiedRouterFn, force = true): void {
    if (force || !UnifiedGraph.routerRegistry.has(name)) {
      UnifiedGraph.routerRegistry.set(name, fn);
    }
  }

  public static registerConnector(name: string, fn: UnifiedConnectorFn, force = true): void {
    if (force || !UnifiedGraph.connectorRegistry.has(name)) {
      UnifiedGraph.connectorRegistry.set(name, fn);
    }
  }

  public readonly container: HTMLElement;
  public readonly options: UnifiedGraphOptions;
  public readonly scene: SoaSceneGraph;
  public readonly camera: CameraController;
  public readonly fsm: CanvasPointerFSM;
  public readonly portal3DManager: Scissor3DPortalManager;
  public readonly snapshotBaker: ScissorSnapshotBaker;
  public readonly webGpuRenderer: WebGpuSchematicRenderer;
  public readonly animationEngine: CompiledAnimationEngine;
  public readonly timelineStore: SimulationTimelineStore;

  public disposed = false;
  public readonly coord: {
    localToGraphRect: (rect: WorldBounds) => WorldBounds;
  };

  private width: number;
  private height: number;
  private gridSize = 2;
  private gridVisible = true;
  private gridType: string = "doubleMesh";
  private gridColor = "rgba(255, 255, 255, 0.12)";
  private bgColor = "transparent";
  private renderModePreference: "auto" | "svg" | "canvas2d" = "auto";
  private highScaleThreshold = 1500;
  private activeRenderMode: "svg" | "canvas2d" = "svg";
  private preferWebGpu = false;
  private webGpuInitAttempted = false;

  private cells = new Map<string, UnifiedCell>();
  private selectedIds = new Set<string>();
  private widgets = new Map<string, UnifiedCanvasWidgetSpec>();
  private plugins = new Map<string, unknown>();
  private listeners = new Map<string, Set<(args: unknown) => void>>();
  private batchDepth = 0;
  private markerCache = new Map<string, string>();
  private canvas2DRafId: number | null = null;
  private simPlaybackRafId: number | null = null;
  private simLastFrameMs = 0;
  private hasLoadedSimulation = false;
  private activeWidgetInteraction: {
    mode: "drag" | "resize" | "brush";
    widgetId: string;
    startU: number;
    startV: number;
    origBounds: WorldBounds;
  } | null = null;

  // Browser DOM layers (null in headless Node environment)
  private rootEl: HTMLElement | null = null;
  private svgEl: SVGSVGElement | null = null;
  private defsEl: SVGDefsElement | null = null;
  private canvas2DEl: HTMLCanvasElement | null = null;
  private webGpuCanvasEl: HTMLCanvasElement | null = null;
  private widgetCanvasEl: HTMLCanvasElement | null = null;
  private gridPatternId: string;
  private gridRectEl: SVGRectElement | null = null;
  private viewportG: SVGGElement | null = null;
  private edgesG: SVGGElement | null = null;
  private nodesG: SVGGElement | null = null;
  private toolsG: SVGGElement | null = null;
  private edgeToolsG: SVGGElement | null = null;
  private guidesG: SVGGElement | null = null;
  private marqueeRectEl: SVGRectElement | null = null;
  private selectionOverlayEl: HTMLElement | null = null;
  private widgetLayerEl: HTMLElement | null = null;
  private wirePreviewPathEl: SVGPathElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cleanupDomListeners: (() => void)[] = [];

  constructor(options: UnifiedGraphOptions = {}) {
    this.options = options;
    this.container = options.container ?? ({} as HTMLElement);
    this.width = options.width ?? (this.container?.clientWidth || 800);
    this.height = options.height ?? (this.container?.clientHeight || 600);
    this.renderModePreference = options.renderMode ?? "auto";
    this.highScaleThreshold = Math.max(100, options.highScaleThreshold ?? 1500);
    this.preferWebGpu = options.preferWebGpu === true;
    this.activeRenderMode = this.renderModePreference === "canvas2d" ? "canvas2d" : "svg";
    this.gridPatternId = `ms-grid-${autoCellCounter++}`;

    if (typeof options.grid === "object" && options.grid !== null) {
      this.gridSize = Math.max(1, options.grid.size ?? 2);
      this.gridVisible = options.grid.visible !== false;
      this.gridType = options.grid.type ?? "doubleMesh";
    } else if (typeof options.grid === "number") {
      this.gridSize = Math.max(1, options.grid);
    }
    if (options.background?.color) {
      this.bgColor = options.background.color;
    }

    this.scene = new SoaSceneGraph(1024, 256);
    this.camera = new CameraController({ minZoom: 0.02, maxZoom: 20, initial: { tx: 0, ty: 0, zoom: 1 } });
    this.portal3DManager = new Scissor3DPortalManager({
      devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    });
    this.snapshotBaker = new ScissorSnapshotBaker();
    this.webGpuRenderer = new WebGpuSchematicRenderer();
    this.animationEngine = new CompiledAnimationEngine();
    this.timelineStore = new SimulationTimelineStore();

    this.fsm = new CanvasPointerFSM(
      this.scene,
      {
        onSelectionChange: (nodeIds, edgeIds) => {
          this.syncSelectionFromFsm(nodeIds, edgeIds);
        },
        onNodesMoved: (moves, committed) => {
          for (const [id, pt] of Object.entries(moves)) {
            const cell = this.cells.get(id);
            if (!cell) continue;
            const prev = { x: cell.x, y: cell.y };
            cell.x = pt.x;
            cell.y = pt.y;
            this.syncCellDom(cell);
            this.refreshConnectedEdges(cell);
            this.emit("node:change:position", { cell, node: cell, current: pt, previous: prev });
            if (committed) {
              this.emit("node:moved", { cell, node: cell });
            }
          }
          this.syncSelectionBoxesDom();
          this.scheduleCanvas2DRender();
        },
        onNodeResized: (nodeId, bounds, committed) => {
          const cell = this.cells.get(nodeId);
          if (!cell) return;
          const prev = { width: cell.width, height: cell.height };
          cell.x = bounds.x;
          cell.y = bounds.y;
          cell.width = bounds.width;
          cell.height = bounds.height;
          this.syncCellDom(cell);
          this.refreshConnectedEdges(cell);
          this.emit("node:change:size", {
            cell,
            node: cell,
            current: { width: bounds.width, height: bounds.height },
            previous: prev,
          });
          this.emit(committed ? "node:resized" : "node:resizing", { cell, node: cell });
          this.syncSelectionBoxesDom();
          this.scheduleCanvas2DRender();
        },
        onNodeRotated: (nodeId, angleDeg, committed) => {
          const cell = this.cells.get(nodeId);
          if (!cell) return;
          cell.angle = angleDeg;
          this.syncCellDom(cell);
          this.refreshConnectedEdges(cell);
          this.emit("node:change:angle", { cell, node: cell, current: angleDeg });
          this.emit(committed ? "node:rotated" : "node:rotating", { cell, node: cell });
          this.syncSelectionBoxesDom();
          this.scheduleCanvas2DRender();
        },
        onWireConnected: ({ sourceNodeId, sourcePortId, targetNodeId, targetPortId }) => {
          const edge = this.options.connecting?.createEdge ? this.options.connecting.createEdge() : this.createEdge({});
          edge.setSource({ cell: sourceNodeId, port: sourcePortId });
          edge.setTarget({ cell: targetNodeId, port: targetPortId });
          if (!edge.getRouter() && this.options.connecting?.router) {
            edge.setRouter(this.options.connecting.router);
          }
          if (!edge.getConnector() && this.options.connecting?.connector) {
            edge.setConnector(this.options.connecting.connector);
          }
          this.addEdge(edge);
          this.emit("edge:connected", { isNew: true, edge, cell: edge });
        },
        onEdgeVerticesChanged: (edgeId, vertices, committed) => {
          const edge = this.cells.get(edgeId);
          if (!edge) return;
          edge.setVertices(vertices);
          this.syncEdgeToolsDom(edge);
          if (committed) {
            this.emit("edge:mouseup", { edge, cell: edge });
          }
        },
        onPanDelta: (dx, dy) => {
          const next = this.camera.panByScreenDelta(dx, dy);
          this.applyViewportTransformDom();
          this.emit("translate", { tx: next.tx, ty: next.ty });
        },
        onAlignmentGuides: (guides) => {
          this.syncAlignmentGuidesDom(guides);
        },
        onMarqueeChange: (rect) => {
          this.syncMarqueeDom(rect);
        },
        onWiringPreview: (preview) => {
          this.syncMagnetHighlightsDom(preview);
          if (!this.wirePreviewPathEl) return;
          if (!preview) {
            this.wirePreviewPathEl.setAttribute("d", "");
            return;
          }
          const srcPt = preview.sourcePoint;
          const tgtPt = preview.snappedTarget
            ? { x: preview.snappedTarget.x, y: preview.snappedTarget.y }
            : preview.currentPoint;
          let routePts: WorldPoint[] = [];

          const srcCell = this.cells.get(preview.sourceNodeId);
          const tgtCell = preview.snappedTarget ? this.cells.get(preview.snappedTarget.nodeId) : undefined;
          const mockEdge = {
            id: "__wiring_preview__",
            getSource: () => ({ cell: preview.sourceNodeId, port: preview.sourcePortId }),
            getTarget: () =>
              preview.snappedTarget
                ? { cell: preview.snappedTarget.nodeId, port: preview.snappedTarget.portId }
                : { x: tgtPt.x, y: tgtPt.y },
            getSourceCell: () => srcCell ?? null,
            getTargetCell: () => tgtCell ?? null,
            getSourcePortId: () => preview.sourcePortId,
            getTargetPortId: () => preview.snappedTarget?.portId,
            getSourcePoint: () => srcPt,
            getTargetPoint: () => tgtPt,
            getVertices: () => [],
          };
          const mockView: UnifiedCellView = {
            cell: mockEdge as unknown as UnifiedCell,
            graph: this,
            container: null,
            sourcePoint: srcPt,
            targetPoint: tgtPt,
            routePoints: [],
            getVertexIndex: () => -1,
          };

          const routerSpec = this.options.connecting?.router;
          const routerName =
            typeof routerSpec === "string"
              ? routerSpec
              : routerSpec && typeof routerSpec === "object"
                ? (routerSpec as { name?: string | undefined }).name
                : undefined;
          const routerFn = routerName ? UnifiedGraph.routerRegistry.get(routerName) : undefined;
          if (routerFn) {
            try {
              const routerArgs =
                routerSpec && typeof routerSpec === "object"
                  ? ((routerSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
                  : {};
              const routed = routerFn([], routerArgs, mockView);
              if (Array.isArray(routed)) {
                routePts = routed;
              }
            } catch {
              routePts = [];
            }
          }

          if (routePts.length === 0 && Math.abs(tgtPt.x - srcPt.x) > 1 && Math.abs(tgtPt.y - srcPt.y) > 1) {
            const portWorld = this.scene.getPortWorldPosition(preview.sourceNodeId, preview.sourcePortId);
            const horiz = portWorld ? Math.abs(portWorld.nx) >= Math.abs(portWorld.ny) : true;
            routePts = horiz ? [{ x: tgtPt.x, y: srcPt.y }] : [{ x: srcPt.x, y: tgtPt.y }];
          }
          mockView.routePoints = routePts;

          const connSpec = this.options.connecting?.connector;
          const connName =
            typeof connSpec === "string"
              ? connSpec
              : connSpec && typeof connSpec === "object"
                ? ((connSpec as { name?: string | undefined }).name ?? "rounded")
                : "rounded";
          const connArgs =
            connSpec && typeof connSpec === "object"
              ? ((connSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
              : {};
          const connFn = UnifiedGraph.connectorRegistry.get(connName);
          let d = "";
          if (connFn) {
            try {
              d = connFn(srcPt, tgtPt, routePts, connArgs, mockView);
            } catch {
              d = defaultPolylinePath(srcPt, tgtPt, routePts, connName);
            }
          } else {
            d = defaultPolylinePath(srcPt, tgtPt, routePts, connName);
          }
          this.wirePreviewPathEl.setAttribute("d", d);
        },
        onNodeInteractiveClick: (nodeId, phase) => {
          const node = this.cells.get(nodeId);
          if (!node) return;
          if (phase === "down") this.emit("node:mousedown", { node, cell: node });
          else if (phase === "up") this.emit("node:mouseup", { node, cell: node });
          else if (phase === "click") {
            this.emit("node:click", { node, cell: node });
            this.emit("cell:click", { cell: node, x: node.x, y: node.y });
          }
        },
        validateConnection: (sId, sPort, tId, tPort) => {
          const validator = this.options.connecting?.validateConnection;
          if (!validator) return true;
          return validator({
            sourceCell: this.cells.get(sId) ?? null,
            targetCell: this.cells.get(tId) ?? null,
            sourcePort: sPort,
            targetPort: tPort,
          });
        },
        validateMagnet: (nodeId, portId) => {
          const vm = this.options.connecting?.validateMagnet;
          if (!vm) return true;
          const cell = this.cells.get(nodeId) ?? null;
          const view = cell ? this.findViewByCell(cell) : null;
          const magnet =
            view?.container?.querySelector?.(`.x6-port[port="${portId}"], .x6-port[port-id="${portId}"]`) ?? null;
          return vm({ cell, magnet });
        },
        canInteract: (cellId) => {
          const inter = this.options.interacting;
          if (inter === undefined || inter === true) return true;
          if (inter === false) return false;
          const cell = this.cells.get(cellId);
          if (!cell) return true;
          return inter({ cell });
        },
        selectionFilter: (cellId) => {
          const selPlugin = this.getPlugin("selection");
          const filter = selPlugin instanceof UnifiedSelection ? selPlugin.options.filter : undefined;
          if (!filter) return true;
          const cell = this.cells.get(cellId);
          if (!cell) return true;
          if (typeof filter === "function") return filter(cell);
          return true;
        },
      },
      { gridSize: this.gridSize },
    );

    this.coord = {
      localToGraphRect: (rect: WorldBounds): WorldBounds => {
        const s = this.camera.getState();
        return {
          x: rect.x * s.zoom + s.tx,
          y: rect.y * s.zoom + s.ty,
          width: rect.width * s.zoom,
          height: rect.height * s.zoom,
        };
      },
    };

    this.mountDomIfAvailable();
  }

  private mountDomIfAvailable(): void {
    if (typeof document === "undefined" || !this.container || typeof this.container.appendChild !== "function") {
      return;
    }

    const style = this.container.style;
    if (style) {
      if (!style.position) style.position = "relative";
      style.overflow = "hidden";
      style.backgroundColor = this.bgColor;
    }

    const root = document.createElement("div");
    root.className = "x6-graph ms-unified-canvas";
    root.style.position = "relative";
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.userSelect = "none";

    // High-scale Canvas2D layer (auto-activated above highScaleThreshold nodes)
    const canvas2D = document.createElement("canvas");
    canvas2D.className = "ms-canvas2d-layer";
    canvas2D.style.position = "absolute";
    canvas2D.style.inset = "0";
    canvas2D.style.width = "100%";
    canvas2D.style.height = "100%";
    canvas2D.style.display = this.activeRenderMode === "canvas2d" ? "block" : "none";
    canvas2D.style.pointerEvents = "none";

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "x6-graph-svg");
    svg.setAttribute("width", String(this.width));
    svg.setAttribute("height", String(this.height));
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";

    const defs = document.createElementNS(SVG_NS, "defs");
    const pattern = document.createElementNS(SVG_NS, "pattern");
    pattern.setAttribute("id", this.gridPatternId);
    pattern.setAttribute("width", String(this.gridSize * 10));
    pattern.setAttribute("height", String(this.gridSize * 10));
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    const gridPath = document.createElementNS(SVG_NS, "path");
    const step = this.gridSize * 10;
    gridPath.setAttribute("d", `M ${step} 0 L 0 0 0 ${step}`);
    gridPath.setAttribute("fill", "none");
    gridPath.setAttribute("stroke", this.gridColor);
    gridPath.setAttribute("stroke-width", "1");
    pattern.appendChild(gridPath);
    defs.appendChild(pattern);
    svg.appendChild(defs);

    const gridRect = document.createElementNS(SVG_NS, "rect");
    gridRect.setAttribute("width", "100%");
    gridRect.setAttribute("height", "100%");
    gridRect.setAttribute("fill", this.gridVisible ? `url(#${this.gridPatternId})` : "none");
    gridRect.setAttribute("pointer-events", "none");
    svg.appendChild(gridRect);

    const viewportG = document.createElementNS(SVG_NS, "g");
    viewportG.setAttribute("class", "x6-graph-svg-viewport");

    const edgesG = document.createElementNS(SVG_NS, "g");
    edgesG.setAttribute("class", "ms-edges-layer");
    const nodesG = document.createElementNS(SVG_NS, "g");
    nodesG.setAttribute("class", "ms-nodes-layer");
    const toolsG = document.createElementNS(SVG_NS, "g");
    toolsG.setAttribute("class", "ms-tools-layer");

    const guidesG = document.createElementNS(SVG_NS, "g");
    guidesG.setAttribute("class", "ms-alignment-guides");
    guidesG.setAttribute("pointer-events", "none");

    const edgeToolsG = document.createElementNS(SVG_NS, "g");
    edgeToolsG.setAttribute("class", "ms-edge-tools");

    const marqueeRect = document.createElementNS(SVG_NS, "rect");
    marqueeRect.setAttribute("class", "ms-marquee-rect");
    marqueeRect.setAttribute("fill", "rgba(56, 189, 248, 0.12)");
    marqueeRect.setAttribute("stroke", "#38bdf8");
    marqueeRect.setAttribute("stroke-width", "1");
    marqueeRect.setAttribute("stroke-dasharray", "4 3");
    marqueeRect.setAttribute("vector-effect", "non-scaling-stroke");
    marqueeRect.setAttribute("pointer-events", "none");
    marqueeRect.style.display = "none";

    const previewPath = document.createElementNS(SVG_NS, "path");
    previewPath.setAttribute("fill", "none");
    previewPath.setAttribute("stroke", "#0891b2");
    previewPath.setAttribute("stroke-width", "1.5");
    previewPath.setAttribute("stroke-dasharray", "5 4");
    previewPath.setAttribute("vector-effect", "non-scaling-stroke");
    previewPath.setAttribute("pointer-events", "none");

    toolsG.appendChild(guidesG);
    toolsG.appendChild(edgeToolsG);
    toolsG.appendChild(marqueeRect);
    toolsG.appendChild(previewPath);

    viewportG.appendChild(edgesG);
    viewportG.appendChild(nodesG);
    viewportG.appendChild(toolsG);
    svg.appendChild(viewportG);

    const widgetLayer = document.createElement("div");
    widgetLayer.className = "ms-widget-portal-layer";
    widgetLayer.style.position = "absolute";
    widgetLayer.style.inset = "0";
    widgetLayer.style.pointerEvents = "none";

    const widgetCanvas = document.createElement("canvas");
    widgetCanvas.className = "ms-widgets-canvas";
    widgetCanvas.style.position = "absolute";
    widgetCanvas.style.inset = "0";
    widgetCanvas.style.width = "100%";
    widgetCanvas.style.height = "100%";
    widgetCanvas.style.display = "none";
    widgetCanvas.style.pointerEvents = "none";
    widgetLayer.appendChild(widgetCanvas);

    const selOverlay = document.createElement("div");
    selOverlay.className = "x6-widget-selection";
    selOverlay.style.position = "absolute";
    selOverlay.style.inset = "0";
    selOverlay.style.pointerEvents = "none";

    root.appendChild(canvas2D);
    root.appendChild(svg);
    root.appendChild(widgetLayer);
    root.appendChild(selOverlay);
    this.container.appendChild(root);

    this.rootEl = root;
    this.canvas2DEl = canvas2D;
    this.widgetCanvasEl = widgetCanvas;
    this.svgEl = svg;
    this.defsEl = defs;
    this.gridRectEl = gridRect;
    this.viewportG = viewportG;
    this.edgesG = edgesG;
    this.nodesG = nodesG;
    this.toolsG = toolsG;
    this.guidesG = guidesG;
    this.edgeToolsG = edgeToolsG;
    this.marqueeRectEl = marqueeRect;
    this.widgetLayerEl = widgetLayer;
    this.selectionOverlayEl = selOverlay;
    this.wirePreviewPathEl = previewPath;

    this.attachDomEventListeners(root);

    if (this.options.autoResize && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w > 0 && h > 0 && (w !== this.width || h !== this.height)) {
          this.resize(w, h);
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  private attachDomEventListeners(root: HTMLElement): void {
    const toLocal = (e: MouseEvent | PointerEvent): { u: number; v: number; sx: number; sy: number } => {
      const pt = this.clientToLocal(e.clientX, e.clientY);
      const rect = this.container.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      return { u: pt.x, v: pt.y, sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    };

    const hitTestWidget = (
      u: number,
      v: number,
    ): { widget: UnifiedCanvasWidgetSpec; mode: "drag" | "resize" | "brush" } | null => {
      const list = Array.from(this.widgets.values()).reverse();
      for (const w of list) {
        const b = w.bounds;
        if (u < b.x || u > b.x + b.width || v < b.y || v > b.y + b.height) continue;
        // Bottom-right 14x14 corner = resize handle
        if (u >= b.x + b.width - 14 && v >= b.y + b.height - 14) {
          return { widget: w, mode: "resize" };
        }
        // Scatter / Pareto plot body below header = brush select
        if (w.kind === "plot" && w.plot && (w.plot.kind === "scatter" || w.plot.kind === "pareto") && v > b.y + 22) {
          return { widget: w, mode: "brush" };
        }
        // Title bar or sticky/table body = drag move
        return { widget: w, mode: "drag" };
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const { u, v, sx, sy } = toLocal(e);
      if (e.button === 0 && this.widgets.size > 0) {
        const hit = hitTestWidget(u, v);
        if (hit) {
          this.activeWidgetInteraction = {
            mode: hit.mode,
            widgetId: hit.widget.id,
            startU: u,
            startV: v,
            origBounds: { ...hit.widget.bounds },
          };
          return;
        }
      }
      if (e.button === 0) {
        (root as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
      }
      let pointerPortHit: { nodeId: string; portId: string } | null = null;
      const targetEl = e.target as Element | null;
      const portEl = targetEl?.closest?.(".x6-port, [data-port], [magnet='true']");
      if (portEl) {
        const portId =
          portEl.getAttribute("port-id") ?? portEl.getAttribute("port") ?? portEl.getAttribute("data-port");
        const nodeEl = portEl.closest?.("[data-cell-id]");
        const nodeId = nodeEl?.getAttribute("data-cell-id");
        if (nodeId && portId) {
          pointerPortHit = { nodeId, portId };
        }
      }
      this.fsm.handleEvent({
        planeId: "primary",
        u,
        v,
        screenX: sx,
        screenY: sy,
        button: e.button,
        buttons: e.buttons,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        phase: "down",
        pointerPortHit,
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      const { u, v, sx, sy } = toLocal(e);
      if (this.activeWidgetInteraction) {
        const inter = this.activeWidgetInteraction;
        if (inter.mode === "drag") {
          this.setWidgetPosition(
            inter.widgetId,
            Math.round(inter.origBounds.x + (u - inter.startU)),
            Math.round(inter.origBounds.y + (v - inter.startV)),
          );
        } else if (inter.mode === "resize") {
          this.setWidgetSize(
            inter.widgetId,
            Math.max(120, Math.round(inter.origBounds.width + (u - inter.startU))),
            Math.max(80, Math.round(inter.origBounds.height + (v - inter.startV))),
          );
        } else if (inter.mode === "brush") {
          this.brushPlotWidget(inter.widgetId, {
            x0: Math.min(inter.startU, u),
            y0: Math.min(inter.startV, v),
            x1: Math.max(inter.startU, u),
            y1: Math.max(inter.startV, v),
          });
        }
        return;
      }
      this.fsm.handleEvent({
        planeId: "primary",
        u,
        v,
        screenX: sx,
        screenY: sy,
        button: e.button,
        buttons: e.buttons,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        phase: "move",
      });
      this.emit("blank:pointermove", { x: u, y: v, e });
    };

    const onPointerUp = (e: PointerEvent) => {
      (root as { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(e.pointerId);
      const { u, v, sx, sy } = toLocal(e);
      if (this.activeWidgetInteraction) {
        const finished = this.activeWidgetInteraction;
        this.activeWidgetInteraction = null;
        this.emit("widget:changed", { widgetId: finished.widgetId, mode: finished.mode });
        return;
      }
      const hitNode = this.scene.hitTestNode(u, v);
      this.fsm.handleEvent({
        planeId: "primary",
        u,
        v,
        screenX: sx,
        screenY: sy,
        button: e.button,
        buttons: e.buttons,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        phase: "up",
      });
      if (!hitNode) {
        this.emit("blank:mouseup", { x: u, y: v, e });
        this.emit("blank:click", { x: u, y: v, e });
      }
      this.emit("blank:pointerup", { x: u, y: v, e });
    };

    const onDblClick = (e: MouseEvent) => {
      const { u, v } = toLocal(e);
      const hitNode = this.scene.hitTestNode(u, v);
      if (hitNode) {
        const cell = this.cells.get(hitNode.id);
        if (cell) this.emit("node:dblclick", { node: cell, cell, e });
      } else {
        const hitEdge = this.scene.hitTestEdge(u, v, 8);
        if (hitEdge) {
          const cell = this.cells.get(hitEdge.edge.id);
          if (cell) this.emit("edge:dblclick", { edge: cell, cell, e });
        }
      }
      this.fsm.handleEvent({
        planeId: "primary",
        u,
        v,
        button: e.button,
        buttons: e.buttons,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        phase: "dblclick",
      });
    };

    const onContextMenu = (e: MouseEvent) => {
      const { u, v } = toLocal(e);
      const hitNode = this.scene.hitTestNode(u, v);
      if (hitNode) {
        const cell = this.cells.get(hitNode.id);
        if (cell) this.emit("node:contextmenu", { node: cell, cell, e });
        return;
      }
      const hitEdge = this.scene.hitTestEdge(u, v, 8);
      if (hitEdge) {
        const cell = this.cells.get(hitEdge.edge.id);
        if (cell) this.emit("edge:contextmenu", { edge: cell, cell, e });
        return;
      }
      this.emit("blank:contextmenu", { x: u, y: v, e });
    };

    const onWheel = (e: WheelEvent) => {
      const mw = this.options.mousewheel;
      const enabled = mw === true || (typeof mw === "object" && mw.enabled !== false);
      if (!enabled) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = this.container.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        const next = this.camera.zoomByWheelDelta(e.deltaY, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        this.applyViewportTransformDom();
        this.emit("scale", { sx: next.zoom, sy: next.zoom });
      }
    };

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("dblclick", onDblClick);
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("wheel", onWheel, { passive: false });

    this.cleanupDomListeners.push(() => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("dblclick", onDblClick);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("wheel", onWheel);
    });
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pauseSimulation();
    if (this.canvas2DRafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.canvas2DRafId);
      this.canvas2DRafId = null;
    }
    this.webGpuRenderer.dispose();
    this.snapshotBaker.dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const fn of this.cleanupDomListeners) fn();
    this.cleanupDomListeners = [];
    if (this.rootEl && this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
    this.rootEl = null;
    this.svgEl = null;
    this.defsEl = null;
    this.canvas2DEl = null;
    this.webGpuCanvasEl = null;
    this.widgetCanvasEl = null;
    this.markerCache.clear();
    this.cells.clear();
    this.selectedIds.clear();
    this.scene.clear();
    this.listeners.clear();
  }

  // ── Event Bus ──

  public on<T = Record<string, unknown>>(event: string, handler: (args: T) => void): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (args: unknown) => void);
    return this;
  }

  public off<T = Record<string, unknown>>(event: string, handler?: (args: T) => void): this {
    if (!handler) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(handler as (args: unknown) => void);
    }
    return this;
  }

  public emit(event: string, args: unknown = {}): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(args);
    }
  }

  // ── Plugins ──

  public use(plugin: unknown): this {
    if (plugin && typeof plugin === "object") {
      const p = plugin as { name?: string | undefined };
      const key = p.name ?? `plugin_${this.plugins.size}`;
      this.plugins.set(key, plugin);
      if (plugin instanceof UnifiedSelection && this.selectionOverlayEl) {
        plugin.selectionImpl.container = this.selectionOverlayEl;
      }
    }
    return this;
  }

  public getPlugin(name: string): unknown {
    return this.plugins.get(name);
  }

  // ── Background & Grid ──

  public drawBackground(options: { color: string }): void {
    this.bgColor = options.color;
    if (this.container?.style) {
      this.container.style.backgroundColor = options.color;
    }
  }

  public drawGrid(options: Record<string, unknown>): void {
    this.gridVisible = true;
    if (typeof options["type"] === "string") {
      this.gridType = options["type"];
    }
    const args = options["args"];
    if (Array.isArray(args)) {
      const major = args[args.length - 1] as { color?: string | undefined } | undefined;
      if (major?.color) this.gridColor = major.color;
    } else if (args && typeof args === "object" && "color" in args) {
      const color = (args as { color?: string | undefined }).color;
      if (color) this.gridColor = color;
    }
    if (this.gridRectEl) {
      this.gridRectEl.setAttribute("fill", `url(#${this.gridPatternId})`);
    }
    const pathEl = this.svgEl?.querySelector(`#${this.gridPatternId} path`);
    if (pathEl) {
      pathEl.setAttribute("stroke", this.gridColor);
    }
  }

  public showGrid(): void {
    this.gridVisible = true;
    this.gridRectEl?.setAttribute("fill", `url(#${this.gridPatternId})`);
  }

  public hideGrid(): void {
    this.gridVisible = false;
    this.gridRectEl?.setAttribute("fill", "none");
  }

  public clearGrid(): void {
    this.hideGrid();
  }

  public setGridSize(size: number): void {
    this.gridSize = Math.max(1, size);
    this.fsm.setOptions({ gridSize: this.gridSize });
  }

  public getGridSize(): number {
    return this.gridSize;
  }

  public getGridType(): string {
    return this.gridType;
  }

  public snapToGrid(x: number, y: number): { x: number; y: number; toJSON: () => { x: number; y: number } } {
    const sx = this.fsm.snap(x);
    const sy = this.fsm.snap(y);
    return { x: sx, y: sy, toJSON: () => ({ x: sx, y: sy }) };
  }

  // ── Cells (Nodes & Edges) ──

  public createEdge(metadata: Record<string, unknown>): UnifiedCell {
    return new UnifiedCell("edge", metadata, this);
  }

  public addNode(metadata: Record<string, unknown> | UnifiedCell): UnifiedCell {
    const node = metadata instanceof UnifiedCell ? metadata : new UnifiedCell("node", metadata, this);
    node.attachGraph(this);
    this.cells.set(node.id, node);

    const data = node.getData();
    let flags: number = node.visible ? SceneNodeFlags.VISIBLE : SceneNodeFlags.NONE;
    if (data["readOnly"] || data["isInherited"]) flags |= SceneNodeFlags.READONLY;
    if (data["locked"]) flags |= SceneNodeFlags.LOCKED;
    if (data["portal"]) flags |= SceneNodeFlags.PORTAL;
    if (data["widget"]) flags |= SceneNodeFlags.WIDGET;
    if (node.id.startsWith("solder_dot_") || node.id.startsWith("__") || node.id === "diagram_background") {
      flags |= SceneNodeFlags.EPHEMERAL;
    }

    this.scene.upsertNode({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      angleDeg: node.angle,
      flipX: Boolean(data["flipX"]),
      flipY: Boolean(data["flipY"]),
      opacity: node.opacity,
      zIndex: node.zIndex,
      flags,
    });

    const ports = node.getPorts();
    if (ports.length > 0) {
      this.scene.setNodePorts(
        node.id,
        ports.map((p) => ({
          id: p.id,
          group: p.group,
          x: p.args?.x ?? 0,
          y: p.args?.y ?? 0,
          angle: p.args?.angle ?? 0,
          direction: p.direction,
        })),
      );
    }

    // Automatically register embedded 3D CAD/FEA/CFD portal or canvas widget if attached in metadata
    if (data["portal"] && typeof data["portal"] === "object") {
      const pSpec = data["portal"] as Partial<Embedded3DPortalSpec>;
      if (pSpec.kind && pSpec.artifactUri) {
        this.registerEmbeddedPortal({
          id: node.id,
          kind: pSpec.kind,
          artifactUri: pSpec.artifactUri,
          bounds: node.getBBox(),
          featurePins: pSpec.featurePins,
          isAnimating: pSpec.isAnimating,
          snapshotDataUrl: pSpec.snapshotDataUrl,
        });
      }
    }
    if (data["widget"] && typeof data["widget"] === "object") {
      const wSpec = data["widget"] as Partial<UnifiedCanvasWidgetSpec>;
      if (wSpec.kind) {
        this.registerCanvasWidget({
          id: node.id,
          kind: wSpec.kind,
          bounds: node.getBBox(),
          plot: wSpec.plot,
          table: wSpec.table,
          sticky: wSpec.sticky,
        });
      }
    }

    this.evaluateRenderMode();
    if (this.activeRenderMode === "svg") {
      this.rebuildCellDom(node);
    } else {
      this.scheduleCanvas2DRender();
    }
    this.emit("cell:added", { cell: node });
    this.emit("node:added", { node, cell: node });
    return node;
  }

  public addEdge(metadata: Record<string, unknown> | UnifiedCell): UnifiedCell {
    const edge = metadata instanceof UnifiedCell ? metadata : new UnifiedCell("edge", metadata, this);
    edge.attachGraph(this);
    this.cells.set(edge.id, edge);
    this.syncEdgeToScene(edge);
    if (this.activeRenderMode === "svg") {
      this.rebuildCellDom(edge);
    } else {
      this.scheduleCanvas2DRender();
    }
    this.emit("cell:added", { cell: edge });
    this.emit("edge:added", { edge, cell: edge });
    return edge;
  }

  public syncEdgeToScene(edge: UnifiedCell): void {
    const src = edge.getSource();
    const tgt = edge.getTarget();
    const rec: SoaEdgeRecord = {
      id: edge.id,
      sourceNodeId: src.cell ?? "",
      sourcePortId: src.port,
      sourcePoint: typeof src.x === "number" && typeof src.y === "number" ? { x: src.x, y: src.y } : undefined,
      targetNodeId: tgt.cell ?? "",
      targetPortId: tgt.port,
      targetPoint: typeof tgt.x === "number" && typeof tgt.y === "number" ? { x: tgt.x, y: tgt.y } : undefined,
      vertices: edge.getVertices(),
      routePoints: edge.view?.routePoints ?? [],
      zIndex: edge.zIndex,
      flags: SceneNodeFlags.VISIBLE,
    };
    this.scene.upsertEdge(rec);
  }

  public getCellById(id?: string): UnifiedCell | null {
    if (!id) return null;
    return this.cells.get(id) ?? null;
  }

  public getCells(): UnifiedCell[] {
    return Array.from(this.cells.values());
  }

  public getNodes(): UnifiedCell[] {
    const out: UnifiedCell[] = [];
    for (const c of this.cells.values()) {
      if (c.isNode()) out.push(c);
    }
    return out;
  }

  public getEdges(): UnifiedCell[] {
    const out: UnifiedCell[] = [];
    for (const c of this.cells.values()) {
      if (c.isEdge()) out.push(c);
    }
    return out;
  }

  public getConnectedEdges(node: { id?: string | undefined } | string): UnifiedCell[] {
    const id = typeof node === "string" ? node : (node?.id ?? "");
    if (!id) return [];
    const edgeIds = this.scene.getConnectedEdgeIds(id);
    const out: UnifiedCell[] = [];
    for (const eid of edgeIds) {
      const c = this.cells.get(eid);
      if (c && c.isEdge()) out.push(c);
    }
    return out;
  }

  public removeCell(cellOrId: unknown): UnifiedCell | null {
    const id =
      typeof cellOrId === "string"
        ? cellOrId
        : cellOrId && typeof cellOrId === "object" && "id" in cellOrId
          ? String((cellOrId as { id: string }).id)
          : "";
    const cell = this.cells.get(id);
    if (!cell) return null;

    this.cells.delete(id);
    this.selectedIds.delete(id);
    this.widgets.delete(id);
    this.portal3DManager.unregisterPortal(id);

    if (cell.isNode()) {
      this.scene.removeNode(id);
    } else {
      this.scene.removeEdge(id);
    }

    if (cell.view?.container && cell.view.container.parentNode) {
      cell.view.container.parentNode.removeChild(cell.view.container);
    }
    cell.attachGraph(null);

    this.emit("cell:removed", { cell });
    this.emit(cell.isNode() ? "node:removed" : "edge:removed", {
      cell,
      node: cell.isNode() ? cell : undefined,
      edge: cell.isEdge() ? cell : undefined,
    });
    this.syncSelectionBoxesDom();
    return cell;
  }

  public removeCells(cells: UnifiedCell[]): UnifiedCell[] {
    const removed: UnifiedCell[] = [];
    for (const c of cells) {
      const r = this.removeCell(c);
      if (r) removed.push(r);
    }
    return removed;
  }

  public clearCells(): void {
    const all = Array.from(this.cells.values());
    for (const c of all) {
      if (c.view?.container && c.view.container.parentNode) {
        c.view.container.parentNode.removeChild(c.view.container);
      }
      c.attachGraph(null);
    }
    this.cells.clear();
    this.selectedIds.clear();
    this.widgets.clear();
    this.scene.clear();
    this.syncSelectionBoxesDom();
  }

  public batchUpdate(_name: string, execute: () => void): void {
    this.batchDepth++;
    try {
      execute();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        this.applyViewportTransformDom();
      }
    }
  }

  public fromJSON(data: {
    nodes?: Record<string, unknown>[] | undefined;
    edges?: Record<string, unknown>[] | undefined;
  }): void {
    this.batchUpdate("fromJSON", () => {
      this.clearCells();
      for (const n of data.nodes ?? []) {
        this.addNode(n);
      }
      for (const e of data.edges ?? []) {
        this.addEdge(e);
      }
    });
  }

  public findViewByCell(cell: UnifiedCell | string): UnifiedCellView | null {
    const c = typeof cell === "string" ? this.cells.get(cell) : cell;
    if (!c) return null;
    if (!c.view) {
      c.view = {
        cell: c,
        graph: this,
        container: null,
        routePoints: c.isEdge() ? c.getVertices() : [],
        getVertexIndex: (x: number, y: number) => {
          const verts = c.getVertices();
          if (verts.length === 0) return 0;
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < verts.length; i++) {
            const d = Math.hypot(verts[i]!.x - x, verts[i]!.y - y);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          return bestIdx;
        },
      };
    }
    return c.view;
  }

  // ── Selection ──

  public getSelectedCells(): UnifiedCell[] {
    const out: UnifiedCell[] = [];
    for (const id of this.selectedIds) {
      const c = this.cells.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  public isSelected(cell: UnifiedCell): boolean {
    return this.selectedIds.has(cell.id);
  }

  public select(cellOrCells: UnifiedCell | UnifiedCell[]): void {
    const list = Array.isArray(cellOrCells) ? cellOrCells : [cellOrCells];
    const added: UnifiedCell[] = [];
    for (const c of list) {
      if (!this.selectedIds.has(c.id)) {
        this.selectedIds.add(c.id);
        this.scene.setNodeFlag(c.id, SceneNodeFlags.SELECTED, true);
        added.push(c);
        if (c.isEdge()) this.emit("edge:selected", { edge: c, cell: c });
      }
    }
    if (added.length > 0) {
      this.syncSelectionBoxesDom();
      this.emit("selection:changed", { added, removed: [], selected: this.getSelectedCells() });
    }
  }

  public unselect(cellOrCells: UnifiedCell | UnifiedCell[]): void {
    const list = Array.isArray(cellOrCells) ? cellOrCells : [cellOrCells];
    const removed: UnifiedCell[] = [];
    for (const c of list) {
      if (this.selectedIds.delete(c.id)) {
        this.scene.setNodeFlag(c.id, SceneNodeFlags.SELECTED, false);
        removed.push(c);
      }
    }
    if (removed.length > 0) {
      this.syncSelectionBoxesDom();
      this.emit("selection:changed", { added: [], removed, selected: this.getSelectedCells() });
    }
  }

  public cleanSelection(): void {
    if (this.selectedIds.size === 0) return;
    const removed = this.getSelectedCells();
    for (const c of removed) {
      this.scene.setNodeFlag(c.id, SceneNodeFlags.SELECTED, false);
    }
    this.selectedIds.clear();
    this.syncSelectionBoxesDom();
    this.emit("selection:changed", { added: [], removed, selected: [] });
  }

  private syncSelectionFromFsm(nodeIds: string[], edgeIds: string[]): void {
    const next = new Set([...nodeIds, ...edgeIds]);
    const added: UnifiedCell[] = [];
    const removed: UnifiedCell[] = [];
    for (const id of next) {
      if (!this.selectedIds.has(id)) {
        const c = this.cells.get(id);
        if (c) added.push(c);
      }
    }
    for (const id of this.selectedIds) {
      if (!next.has(id)) {
        const c = this.cells.get(id);
        if (c) removed.push(c);
      }
    }
    this.selectedIds = next;
    this.syncSelectionBoxesDom();
    if (added.length > 0 || removed.length > 0) {
      for (const c of added) {
        if (c.isEdge()) this.emit("edge:selected", { edge: c, cell: c });
      }
      this.emit("selection:changed", { added, removed, selected: this.getSelectedCells() });
    }
  }

  // ── Viewport / Camera ──

  public scale(): { sx: number; sy: number } {
    const z = this.camera.getState().zoom;
    return { sx: z, sy: z };
  }

  public translate(tx?: number, ty?: number): { tx: number; ty: number } {
    if (typeof tx === "number" && typeof ty === "number") {
      const next = this.camera.setState({ tx, ty });
      this.applyViewportTransformDom();
      this.emit("translate", { tx: next.tx, ty: next.ty });
      return { tx: next.tx, ty: next.ty };
    }
    const s = this.camera.getState();
    return { tx: s.tx, ty: s.ty };
  }

  public zoom(factor?: number, options?: { absolute?: boolean | undefined }): number {
    const cur = this.camera.getState().zoom;
    if (typeof factor !== "number") return cur;
    const target = options?.absolute ? factor : cur + factor;
    const next = this.camera.zoomAtScreenPoint(target, { x: this.width / 2, y: this.height / 2 });
    this.applyViewportTransformDom();
    this.emit("scale", { sx: next.zoom, sy: next.zoom });
    return next.zoom;
  }

  public zoomTo(factor: number): void {
    this.zoom(factor, { absolute: true });
  }

  public resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (this.svgEl) {
      this.svgEl.setAttribute("width", String(this.width));
      this.svgEl.setAttribute("height", String(this.height));
    }
    this.scheduleCanvas2DRender();
    this.renderWidgetCanvasDom();
  }

  public zoomToRect(
    rect: WorldBounds,
    options?: {
      padding?: number | undefined;
      maxScale?: number | undefined;
      viewportArea?: WorldBounds | undefined;
    },
  ): void {
    const pad = options?.padding ?? 24;
    const area = options?.viewportArea ?? { x: 0, y: 0, width: this.width, height: this.height };
    const safeW = Math.max(1, rect.width);
    const safeH = Math.max(1, rect.height);
    const availW = Math.max(16, area.width - pad * 2);
    const availH = Math.max(16, area.height - pad * 2);
    let zoom = this.camera.clampZoom(Math.min(availW / safeW, availH / safeH));
    if (options?.maxScale !== undefined && zoom > options.maxScale) {
      zoom = this.camera.clampZoom(options.maxScale);
    }
    const cx = rect.x + safeW / 2;
    const cy = rect.y + safeH / 2;
    const tx = area.x + area.width / 2 - cx * zoom;
    const ty = area.y + area.height / 2 - cy * zoom;
    this.camera.setState({ tx, ty, zoom });
    this.applyViewportTransformDom();
    const s = this.camera.getState();
    this.emit("scale", { sx: s.zoom, sy: s.zoom });
    this.emit("translate", { tx: s.tx, ty: s.ty });
  }

  public zoomToFit(options?: {
    padding?: number | undefined;
    maxScale?: number | undefined;
    viewportArea?: WorldBounds | undefined;
  }): void {
    const bounds = this.scene.getContentBounds();
    if (!bounds) return;
    this.zoomToRect(bounds, options);
  }

  public centerPoint(worldX: number, worldY: number): void {
    const z = this.camera.getState().zoom;
    const tx = this.width / 2 - worldX * z;
    const ty = this.height / 2 - worldY * z;
    this.translate(tx, ty);
  }

  public centerContent(): void {
    const bounds = this.scene.getContentBounds();
    if (!bounds) return;
    this.centerPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }

  public centerCell(cell: UnifiedCell): void {
    const bb = cell.getBBox();
    this.centerPoint(bb.x + bb.width / 2, bb.y + bb.height / 2);
  }

  public clientToLocal(x: number, y: number): WorldPoint {
    const rect = this.container?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    return this.camera.screenToWorld({ x: x - rect.left, y: y - rect.top });
  }

  public matrix(): { a: number; d: number; e: number; f: number } {
    const s = this.camera.getState();
    return { a: s.zoom, d: s.zoom, e: s.tx, f: s.ty };
  }

  // ── First-Class Unified Extensions (Nested 3D Portals, Widgets, Animations, 3D/VR) ──

  /** Returns the active rendering backend ("svg" for standard schematics, "canvas2d" or "webgpu" above highScaleThreshold). */
  public getActiveRenderMode(): "svg" | "canvas2d" | "webgpu" {
    if (this.activeRenderMode === "canvas2d" && this.webGpuRenderer.isReady()) {
      return "webgpu";
    }
    return this.activeRenderMode;
  }

  /** Initializes optional WebGPU instanced schematic rendering on a dedicated GPU canvas layer. */
  public async enableWebGpu(gpuOverride?: WebGpuLike | null): Promise<boolean> {
    this.preferWebGpu = true;
    this.webGpuInitAttempted = true;
    if (!this.webGpuCanvasEl && typeof document !== "undefined" && this.rootEl) {
      const gpuCanvas = document.createElement("canvas");
      gpuCanvas.className = "ms-webgpu-layer";
      gpuCanvas.style.position = "absolute";
      gpuCanvas.style.inset = "0";
      gpuCanvas.style.width = "100%";
      gpuCanvas.style.height = "100%";
      gpuCanvas.style.pointerEvents = "none";
      gpuCanvas.style.display = "none";
      this.rootEl.insertBefore(gpuCanvas, this.rootEl.firstChild);
      this.webGpuCanvasEl = gpuCanvas;
    }
    const ok = await this.webGpuRenderer.initialize(this.webGpuCanvasEl, gpuOverride);
    if (ok && this.activeRenderMode === "canvas2d") {
      this.scheduleCanvas2DRender();
    }
    return ok;
  }

  /** Registers a live embedded 3D CAD / FEA / CFD / STEP / VTK portal inside this schematic canvas. */
  public registerEmbeddedPortal(spec: Embedded3DPortalSpec): void {
    this.portal3DManager.registerPortal(spec);
  }

  /** Computes clipped WebGL scissor rects for all visible 3D portals on 1 shared WebGL context. */
  public computeEmbedded3DScissorRects() {
    return this.portal3DManager.computeFrameScissorRects(this.camera, {
      width: this.width,
      height: this.height,
    });
  }

  /** Pins a Modelon Impact-style Canvas2D plot, table, or KPI sticky widget onto the schematic canvas. */
  public registerCanvasWidget(widget: UnifiedCanvasWidgetSpec): void {
    this.widgets.set(widget.id, widget);
    this.renderWidgetCanvasDom();
    this.scheduleCanvas2DRender();
  }

  public removeCanvasWidget(widgetId: string): boolean {
    const deleted = this.widgets.delete(widgetId);
    if (deleted) {
      this.renderWidgetCanvasDom();
      this.scheduleCanvas2DRender();
    }
    return deleted;
  }

  /** Moves a pinned Canvas2D plot, table, or KPI sticky widget in world coordinates. */
  public setWidgetPosition(widgetId: string, x: number, y: number): boolean {
    const w = this.widgets.get(widgetId);
    if (!w) return false;
    w.bounds = { ...w.bounds, x, y };
    this.renderWidgetCanvasDom();
    this.scheduleCanvas2DRender();
    return true;
  }

  /** Resizes a pinned Canvas2D plot, table, or KPI sticky widget in world coordinates. */
  public setWidgetSize(widgetId: string, width: number, height: number): boolean {
    const w = this.widgets.get(widgetId);
    if (!w) return false;
    w.bounds = { ...w.bounds, width: Math.max(100, width), height: Math.max(60, height) };
    this.renderWidgetCanvasDom();
    this.scheduleCanvas2DRender();
    return true;
  }

  /** Connects a pinned widget to a world-space wire or port via a dashed leader tether. */
  public setWidgetTether(
    widgetId: string,
    target: { x: number; y: number; label?: string | undefined } | undefined,
  ): boolean {
    const w = this.widgets.get(widgetId);
    if (!w) return false;
    w.tetherTarget = target;
    if (w.plot) w.plot.tetherTarget = target;
    if (w.sticky) w.sticky.tetherTarget = target;
    this.renderWidgetCanvasDom();
    this.scheduleCanvas2DRender();
    return true;
  }

  /**
   * Brushes a Monte Carlo / Pareto scatter plot widget in world coordinates,
   * automatically highlighting linked rows on any pinned `table` widgets and
   * notifying `onWidgetBrush` / `"widget:brushed"` listeners.
   */
  public brushPlotWidget(
    widgetId: string,
    brushRect: { x0: number; y0: number; x1: number; y1: number } | undefined,
  ): { indices: number[]; linkedIds: string[] } {
    const w = this.widgets.get(widgetId);
    if (!w || w.kind !== "plot" || !w.plot) return { indices: [], linkedIds: [] };
    w.plot.brushRect = brushRect;
    const hit = brushRect
      ? hitTestScatterBrush(w.plot, w.bounds.x, w.bounds.y, w.bounds.width, w.bounds.height, brushRect)
      : { indices: [], linkedIds: [] };

    for (const other of this.widgets.values()) {
      if (other.kind === "table" && other.table) {
        other.table.highlightedRowIds = hit.linkedIds.length > 0 ? hit.linkedIds : undefined;
      }
    }
    this.renderWidgetCanvasDom();
    this.scheduleCanvas2DRender();
    this.options.onWidgetBrush?.(widgetId, hit.indices, hit.linkedIds);
    this.emit("widget:brushed", { widgetId, indices: hit.indices, linkedIds: hit.linkedIds });
    return hit;
  }

  /** Synchronizes the vertical time crosshair across all pinned Canvas2D plot widgets. */
  public syncPlotCrosshair(time: number | undefined): void {
    for (const w of this.widgets.values()) {
      if (w.kind === "plot" && w.plot) {
        w.plot.crosshairX = time;
      }
    }
    this.renderWidgetCanvasDom();
    this.scheduleCanvas2DRender();
  }

  public getCanvasWidgets(): UnifiedCanvasWidgetSpec[] {
    return Array.from(this.widgets.values());
  }

  public getWidgetPortalLayer(): HTMLElement | null {
    return this.widgetLayerEl;
  }

  public getToolsLayer(): SVGGElement | null {
    return this.toolsG;
  }

  /** Compiles SCADA / Modelica `ReactiveAnimationBinding`s into zero-GC SoA tables. */
  public compileAnimations(bindings: AnimationBindingSpec[], varIndexMap?: Map<string, number>): void {
    this.animationEngine.compile(bindings, varIndexMap);
  }

  /**
   * Loads a full `Float64Array` simulation trajectory buffer into the shared
   * `SimulationTimelineStore`, re-syncs plot crosshairs, and ticks compiled animations at t0.
   */
  public loadSimulationResult(result: { time: ArrayLike<number>; signals: Record<string, ArrayLike<number>> }): void {
    const timeArr = result.time instanceof Float64Array ? result.time : Float64Array.from(result.time);
    const signalsF64: Record<string, Float64Array> = {};
    for (const [k, v] of Object.entries(result.signals)) {
      signalsF64[k] = v instanceof Float64Array ? v : Float64Array.from(v);
    }
    this.timelineStore.loadTrajectories(timeArr, signalsF64);
    this.hasLoadedSimulation = timeArr.length > 0;
    const st = this.timelineStore.getState();
    const frame = this.timelineStore.getCurrentFrame();
    if (frame.length > 0) {
      this.tickAnimations(frame, 0);
    }
    this.syncPlotCrosshair(st.currentTime);
    this.emit("simulation:loaded", { start: st.startTime, end: st.endTime, current: st.currentTime });
  }

  /** Starts 60 FPS lockstep playback across 2D schematic animations, pinned plots, and `"simulation:tick"` subscribers. */
  public playSimulation(speed = 1): void {
    this.timelineStore.setPlaybackRate(speed);
    this.timelineStore.setPlaying(true);
    if (this.simPlaybackRafId !== null || typeof requestAnimationFrame !== "function") return;
    this.simLastFrameMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const step = (now: number) => {
      if (this.disposed || !this.timelineStore.getState().playing) {
        this.simPlaybackRafId = null;
        return;
      }
      const dtSec = Math.max(0, Math.min(0.1, (now - this.simLastFrameMs) / 1000));
      this.simLastFrameMs = now;
      const st = this.timelineStore.advance(dtSec);
      const frame = this.timelineStore.getCurrentFrame();
      if (frame.length > 0) {
        this.tickAnimations(frame, dtSec);
      }
      this.syncPlotCrosshair(st.currentTime);
      this.emit("simulation:tick", { time: st.currentTime, frame, playing: st.playing });
      this.simPlaybackRafId = requestAnimationFrame(step);
    };
    this.simPlaybackRafId = requestAnimationFrame(step);
  }

  /** Pauses active simulation timeline playback. */
  public pauseSimulation(): void {
    this.timelineStore.setPlaying(false);
    if (this.simPlaybackRafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.simPlaybackRafId);
      this.simPlaybackRafId = null;
    }
  }

  /** Seeks the loaded simulation timeline to an exact timestamp, updating animations & plots immediately. */
  public seekSimulation(time: number): void {
    const st = this.timelineStore.seek(time);
    const frame = this.timelineStore.getCurrentFrame();
    if (frame.length > 0) {
      this.tickAnimations(frame, 0);
    }
    this.syncPlotCrosshair(st.currentTime);
    this.emit("simulation:tick", { time: st.currentTime, frame, playing: st.playing });
  }

  public isSimulationPlaying(): boolean {
    return this.timelineStore.getState().playing;
  }

  public getSimulationTimeRange(): { start: number; end: number; current: number } | null {
    if (!this.hasLoadedSimulation) return null;
    const st = this.timelineStore.getState();
    return { start: st.startTime, end: st.endTime, current: st.currentTime };
  }

  /** Applies a single zero-GC Float64Array simulation frame across all compiled schematic animations. */
  public tickAnimations(frame: Float64Array, dtSeconds = 1 / 60): number {
    return this.animationEngine.tick(frame, dtSeconds, (upd) => {
      const cell = this.cells.get(upd.targetId);
      if (!cell) return;
      if (upd.propKind === AnimationPropKind.FILL_COLOR && upd.color) {
        cell.attr(`${upd.selector}/fill`, upd.color);
      } else if (upd.propKind === AnimationPropKind.STROKE_COLOR && upd.color) {
        cell.attr(`${upd.selector}/stroke`, upd.color);
      } else if (upd.propKind === AnimationPropKind.ROTATION) {
        cell.rotate(upd.numericValue, { absolute: true });
      } else if (upd.propKind === AnimationPropKind.OPACITY) {
        cell.attr(`${upd.selector}/opacity`, Math.max(0, Math.min(1, upd.normalized)));
      } else if (upd.propKind === AnimationPropKind.VISIBLE) {
        cell.setVisible(upd.numericValue > 0.5);
      } else if (upd.propKind === AnimationPropKind.TEXT && upd.formattedValue !== undefined) {
        cell.attr(`${upd.selector}/text`, upd.formattedValue);
      } else if (upd.propKind === AnimationPropKind.FLOW_SPEED) {
        cell.attr(`${upd.selector}/stroke-dashoffset`, -upd.numericValue);
      } else if (upd.propKind === AnimationPropKind.STROKE_WIDTH) {
        cell.attr(`${upd.selector}/stroke-width`, Math.max(0.5, upd.numericValue));
      } else if (upd.propKind === AnimationPropKind.FILL_LEVEL) {
        cell.attr(`${upd.selector}/transform`, `scale(1, ${upd.normalized.toFixed(3)})`);
      }
    });
  }

  /** Creates a 3D / WebXR VR surface bridge bound directly to this graph's `CanvasPointerFSM`. */
  public createSpatialBridge(): SpatialSurfaceBridge {
    const bridge = new SpatialSurfaceBridge();
    bridge.bindFsm("primary", this.fsm);
    return bridge;
  }

  /**
   * Paints the entire visible scene (nodes, orthogonal wires, frozen 3D portal snapshots,
   * pinned plots, tables, KPI stickies) onto any Canvas2D context (for 50,000+ node mode,
   * headless thumbnails, or WebXR VR `CanvasTexture`).
   */
  public paintToCanvas2D(
    ctx: Canvas2DContextLike,
    options: { dark?: boolean | undefined } = {},
  ): {
    drawnNodes: number;
    drawnEdges: number;
    drawnWidgets: number;
    drawnFrozenPortals: number;
  } {
    const cam = this.camera.getState();
    const visibleRect = this.camera.getVisibleWorldBounds({ width: this.width, height: this.height }, 64);
    const visibleNodes = this.scene.queryVisibleNodes(visibleRect);

    ctx.save();
    ctx.translate(cam.tx, cam.ty);
    ctx.scale(cam.zoom, cam.zoom);

    let drawnEdges = 0;
    for (const edge of this.getEdges()) {
      const { d, stroke, strokeWidth } = this.computeEdgeRenderPath(edge);
      if (!d) continue;
      if (typeof Path2D !== "undefined") {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth / Math.max(0.25, cam.zoom);
        ctx.stroke(new Path2D(d));
      }
      drawnEdges++;
    }

    let drawnNodes = 0;
    const lodMinimal = cam.zoom < 0.35;
    for (const summary of visibleNodes) {
      const cell = this.cells.get(summary.id);
      const glyph = cell?.getCompiledGlyph();
      if (!cell || !glyph) continue;
      ctx.save();
      const cx = summary.x + summary.width / 2;
      const cy = summary.y + summary.height / 2;
      ctx.translate(cx, cy);
      if (summary.angleDeg !== 0) ctx.rotate((summary.angleDeg * Math.PI) / 180);
      if (summary.flipX || summary.flipY) {
        ctx.scale(summary.flipX ? -1 : 1, summary.flipY ? -1 : 1);
      }
      ctx.translate(-summary.width / 2, -summary.height / 2);
      paintGlyphToCanvas2D(ctx, glyph, summary.width, summary.height, {
        lodMinimal,
        scale: cam.zoom,
      });
      ctx.restore();
      drawnNodes++;
    }

    // Stamp offscreen-baked 3D LOD snapshots at 0 GPU cost for zoomed-out / idle portals
    const portalRects = this.portal3DManager.computeFrameScissorRects(this.camera, {
      width: this.width,
      height: this.height,
    });
    const drawnFrozenPortals = this.snapshotBaker.paintFrozenSnapshots(
      ctx,
      portalRects
        .filter((r) => !r.renderLive)
        .map((r) => {
          const cell = this.cells.get(r.portalId);
          return {
            portalId: r.portalId,
            x: cell?.x ?? r.cssX,
            y: cell?.y ?? r.cssY,
            width: cell?.width ?? r.cssWidth,
            height: cell?.height ?? r.cssHeight,
            snapshotFrozen: true,
            label: `${r.kind.toUpperCase()} (Frozen LOD)`,
          };
        }),
    );

    let drawnWidgets = 0;
    for (const w of this.widgets.values()) {
      if (w.kind === "plot" && w.plot) {
        paintCanvasPlot(
          ctx,
          { ...w.plot, tetherTarget: w.plot.tetherTarget ?? w.tetherTarget, dark: w.plot.dark ?? options.dark },
          w.bounds.x,
          w.bounds.y,
          w.bounds.width,
          w.bounds.height,
        );
        drawnWidgets++;
      } else if (w.kind === "table" && w.table) {
        paintCanvasTable(
          ctx,
          { ...w.table, dark: w.table.dark ?? options.dark },
          w.bounds.x,
          w.bounds.y,
          w.bounds.width,
          w.bounds.height,
        );
        drawnWidgets++;
      } else if (w.kind === "sticky" && w.sticky) {
        paintStickyBadge(
          ctx,
          { ...w.sticky, tetherTarget: w.sticky.tetherTarget ?? w.tetherTarget, dark: w.sticky.dark ?? options.dark },
          w.bounds.x,
          w.bounds.y,
          w.bounds.width,
          w.bounds.height,
        );
        drawnWidgets++;
      }
    }

    ctx.restore();
    return { drawnNodes, drawnEdges, drawnWidgets, drawnFrozenPortals };
  }

  // ── Internal DOM Synchronization (Browser Mode) ──

  private evaluateRenderMode(): void {
    const desired: "svg" | "canvas2d" =
      this.renderModePreference === "canvas2d"
        ? "canvas2d"
        : this.renderModePreference === "svg"
          ? "svg"
          : this.scene.nodeCount > this.highScaleThreshold
            ? "canvas2d"
            : "svg";
    if (desired === this.activeRenderMode) return;
    this.activeRenderMode = desired;
    if (desired === "canvas2d" && this.preferWebGpu && !this.webGpuInitAttempted) {
      void this.enableWebGpu();
    }
    if (this.canvas2DEl) {
      this.canvas2DEl.style.display = desired === "canvas2d" ? "block" : "none";
    }
    if (this.webGpuCanvasEl) {
      this.webGpuCanvasEl.style.display = desired === "canvas2d" && this.webGpuRenderer.isReady() ? "block" : "none";
    }
    if (this.nodesG && this.edgesG) {
      if (desired === "canvas2d") {
        // Clear heavy SVG DOM subtrees when entering high-scale Canvas2D/WebGPU mode
        this.nodesG.innerHTML = "";
        this.edgesG.innerHTML = "";
        this.scheduleCanvas2DRender();
      } else {
        for (const c of this.cells.values()) {
          this.rebuildCellDom(c);
        }
      }
    }
  }

  private scheduleCanvas2DRender(): void {
    if (this.activeRenderMode !== "canvas2d" || !this.canvas2DEl || this.disposed) return;
    if (this.canvas2DRafId !== null) return;
    const render = () => {
      this.canvas2DRafId = null;
      if (this.disposed || !this.canvas2DEl || this.activeRenderMode !== "canvas2d") return;
      const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
      const targetW = Math.max(1, Math.round(this.width * dpr));
      const targetH = Math.max(1, Math.round(this.height * dpr));

      // Attempt zero-overhead WebGPU instanced submission first when enabled & ready
      if (this.webGpuRenderer.isReady() && this.webGpuCanvasEl) {
        if (this.webGpuCanvasEl.width !== targetW || this.webGpuCanvasEl.height !== targetH) {
          this.webGpuCanvasEl.width = targetW;
          this.webGpuCanvasEl.height = targetH;
        }
        this.webGpuCanvasEl.style.display = "block";
        const gpuRes = this.webGpuRenderer.renderFrame(this.scene, this.camera, {
          width: this.width,
          height: this.height,
        });
        if (gpuRes.rendered) {
          this.canvas2DEl.style.display = "none";
          this.renderWidgetCanvasDom();
          return;
        }
      }

      this.canvas2DEl.style.display = "block";
      if (this.canvas2DEl.width !== targetW || this.canvas2DEl.height !== targetH) {
        this.canvas2DEl.width = targetW;
        this.canvas2DEl.height = targetH;
      }
      const ctx = this.canvas2DEl.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      const isDark = this.bgColor !== "#ffffff" && this.bgColor !== "#f8fafc";
      this.paintToCanvas2D(ctx as unknown as Canvas2DContextLike, { dark: isDark });
      ctx.restore();
    };
    if (typeof requestAnimationFrame === "function") {
      this.canvas2DRafId = requestAnimationFrame(render);
    } else {
      render();
    }
  }

  private renderWidgetCanvasDom(): void {
    if (!this.widgetCanvasEl || this.disposed) return;
    if (this.widgets.size === 0 || (this.activeRenderMode === "canvas2d" && !this.webGpuRenderer.isReady())) {
      this.widgetCanvasEl.style.display = "none";
      return;
    }
    this.widgetCanvasEl.style.display = "block";
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const targetW = Math.max(1, Math.round(this.width * dpr));
    const targetH = Math.max(1, Math.round(this.height * dpr));
    if (this.widgetCanvasEl.width !== targetW || this.widgetCanvasEl.height !== targetH) {
      this.widgetCanvasEl.width = targetW;
      this.widgetCanvasEl.height = targetH;
    }
    const ctx = this.widgetCanvasEl.getContext("2d");
    if (!ctx) return;
    const cam = this.camera.getState();
    const isDark = this.bgColor !== "#ffffff" && this.bgColor !== "#f8fafc";
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(cam.tx, cam.ty);
    ctx.scale(cam.zoom, cam.zoom);
    const ctxLike = ctx as unknown as Canvas2DContextLike;
    for (const w of this.widgets.values()) {
      if (w.kind === "plot" && w.plot) {
        paintCanvasPlot(
          ctxLike,
          { ...w.plot, tetherTarget: w.plot.tetherTarget ?? w.tetherTarget, dark: w.plot.dark ?? isDark },
          w.bounds.x,
          w.bounds.y,
          w.bounds.width,
          w.bounds.height,
        );
      } else if (w.kind === "table" && w.table) {
        paintCanvasTable(
          ctxLike,
          { ...w.table, dark: w.table.dark ?? isDark },
          w.bounds.x,
          w.bounds.y,
          w.bounds.width,
          w.bounds.height,
        );
      } else if (w.kind === "sticky" && w.sticky) {
        paintStickyBadge(
          ctxLike,
          { ...w.sticky, tetherTarget: w.sticky.tetherTarget ?? w.tetherTarget, dark: w.sticky.dark ?? isDark },
          w.bounds.x,
          w.bounds.y,
          w.bounds.width,
          w.bounds.height,
        );
      }
    }
    ctx.restore();
  }

  private applyViewportTransformDom(): void {
    const s = this.camera.getState();
    this.fsm.setPortSnapRadius(Math.max(4, Math.min(24, 14 / Math.max(0.05, s.zoom))));
    if (this.viewportG) {
      this.viewportG.setAttribute("transform", `matrix(${s.zoom},0,0,${s.zoom},${s.tx},${s.ty})`);
    }
    this.syncSelectionBoxesDom();
    this.scheduleCanvas2DRender();
    this.renderWidgetCanvasDom();
  }

  private ensureEdgeMarker(markerSpec: unknown, strokeColor: string): string | null {
    if (!markerSpec || !this.defsEl || typeof document === "undefined") return null;
    const name =
      typeof markerSpec === "string"
        ? markerSpec
        : typeof markerSpec === "object"
          ? ((markerSpec as { name?: string | undefined }).name ?? "block")
          : "";
    if (!name || name === "none") return null;

    const sizeW =
      typeof markerSpec === "object" && typeof (markerSpec as { width?: number }).width === "number"
        ? (markerSpec as { width: number }).width
        : 10;
    const sizeH =
      typeof markerSpec === "object" && typeof (markerSpec as { height?: number }).height === "number"
        ? (markerSpec as { height: number }).height
        : 8;
    const fill =
      typeof markerSpec === "object" && typeof (markerSpec as { fill?: string }).fill === "string"
        ? (markerSpec as { fill: string }).fill
        : strokeColor;

    const key = `${name}|${fill}|${strokeColor}|${sizeW}x${sizeH}`;
    const cached = this.markerCache.get(key);
    if (cached) return cached;

    const id = `ms-marker-${autoCellCounter++}`;
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", id);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", String(sizeW));
    marker.setAttribute("markerHeight", String(sizeH));
    marker.setAttribute("orient", "auto-start-reverse");

    const shape = document.createElementNS(SVG_NS, name === "circle" ? "circle" : "path");
    if (name === "circle") {
      shape.setAttribute("cx", "5");
      shape.setAttribute("cy", "5");
      shape.setAttribute("r", "3.5");
      shape.setAttribute("fill", fill);
      shape.setAttribute("stroke", strokeColor);
    } else if (name === "diamond") {
      shape.setAttribute("d", "M 0 5 L 5 1 L 10 5 L 5 9 Z");
      shape.setAttribute("fill", fill);
      shape.setAttribute("stroke", strokeColor);
    } else if (name === "classic" || name === "async") {
      shape.setAttribute("d", "M 0 1 L 10 5 L 0 9 L 2.5 5 Z");
      shape.setAttribute("fill", fill);
    } else {
      // Standard block / triangle arrowhead
      shape.setAttribute("d", "M 0 1 L 10 5 L 0 9 Z");
      shape.setAttribute("fill", fill);
    }
    marker.appendChild(shape);
    this.defsEl.appendChild(marker);
    this.markerCache.set(key, id);
    return id;
  }

  private computeEdgeRenderPath(edge: UnifiedCell): {
    d: string;
    sourcePt: WorldPoint;
    targetPt: WorldPoint;
    routePoints: WorldPoint[];
    stroke: string;
    strokeWidth: number;
    strokeDasharray?: string | undefined;
    sourceMarker?: unknown;
    targetMarker?: unknown;
  } {
    const view = this.findViewByCell(edge)!;
    const sourcePt = edge.getSourcePoint();
    const targetPt = edge.getTargetPoint();
    view.sourcePoint = sourcePt;
    view.targetPoint = targetPt;

    let routePoints = edge.getVertices();
    const routerSpec = edge.getRouter();
    const routerName =
      typeof routerSpec === "string"
        ? routerSpec
        : routerSpec && typeof routerSpec === "object"
          ? (routerSpec as { name?: string | undefined }).name
          : undefined;
    const routerArgs =
      routerSpec && typeof routerSpec === "object"
        ? ((routerSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
        : {};
    if (routerName) {
      const fn = UnifiedGraph.routerRegistry.get(routerName);
      if (fn) {
        try {
          const routed = fn(routePoints, routerArgs, view);
          if (Array.isArray(routed)) routePoints = routed;
        } catch {
          // Fallback to existing vertices
        }
      }
    }
    view.routePoints = routePoints;
    const edgeRec = this.scene.getEdge(edge.id);
    if (edgeRec) edgeRec.routePoints = routePoints;

    const connSpec = edge.getConnector();
    const connName =
      typeof connSpec === "string"
        ? connSpec
        : connSpec && typeof connSpec === "object"
          ? ((connSpec as { name?: string | undefined }).name ?? "rounded")
          : "rounded";
    const connArgs =
      connSpec && typeof connSpec === "object"
        ? ((connSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
        : {};

    let d = "";
    const connFn = UnifiedGraph.connectorRegistry.get(connName);
    if (connFn) {
      try {
        d = connFn(sourcePt, targetPt, routePoints, connArgs, view);
      } catch {
        d = defaultPolylinePath(sourcePt, targetPt, routePoints, connName);
      }
    } else {
      d = defaultPolylinePath(
        sourcePt,
        targetPt,
        routePoints,
        connName,
        typeof connArgs["radius"] === "number" ? connArgs["radius"] : 8,
      );
    }

    const lineAttrs = edge.getAttrs()["line"] ?? {};
    const stroke = typeof lineAttrs["stroke"] === "string" ? lineAttrs["stroke"] : "#38bdf8";
    const strokeWidth =
      typeof lineAttrs["strokeWidth"] === "number"
        ? lineAttrs["strokeWidth"]
        : typeof lineAttrs["stroke-width"] === "number"
          ? lineAttrs["stroke-width"]
          : 1.5;
    const strokeDasharray =
      typeof lineAttrs["strokeDasharray"] === "string"
        ? lineAttrs["strokeDasharray"]
        : typeof lineAttrs["stroke-dasharray"] === "string"
          ? lineAttrs["stroke-dasharray"]
          : undefined;

    return {
      d,
      sourcePt,
      targetPt,
      routePoints,
      stroke,
      strokeWidth,
      strokeDasharray,
      sourceMarker: lineAttrs["sourceMarker"],
      targetMarker: lineAttrs["targetMarker"],
    };
  }

  private samplePointAlongPolyline(pts: WorldPoint[], fraction: number): WorldPoint {
    if (pts.length === 0) return { x: 0, y: 0 };
    if (pts.length === 1) return pts[0]!;
    const segLengths: number[] = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
      segLengths.push(len);
      total += len;
    }
    if (total <= 1e-6) return pts[0]!;
    const targetDist = Math.max(0, Math.min(1, fraction)) * total;
    let acc = 0;
    for (let i = 0; i < segLengths.length; i++) {
      const seg = segLengths[i]!;
      if (acc + seg >= targetDist || i === segLengths.length - 1) {
        const localT = seg > 1e-6 ? (targetDist - acc) / seg : 0;
        const a = pts[i]!;
        const b = pts[i + 1]!;
        return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
      }
      acc += seg;
    }
    return pts[pts.length - 1]!;
  }

  private syncEdgeLabelsDom(edge: UnifiedCell, pts: WorldPoint[]): void {
    const container = edge.view?.container;
    if (!container || typeof document === "undefined") return;
    let labelsG = container.querySelector(".ms-edge-labels") as SVGGElement | null;
    if (!edge.labels || edge.labels.length === 0) {
      if (labelsG) labelsG.innerHTML = "";
      return;
    }
    if (!labelsG) {
      labelsG = document.createElementNS(SVG_NS, "g");
      labelsG.setAttribute("class", "ms-edge-labels");
      container.appendChild(labelsG);
    }
    labelsG.innerHTML = "";

    for (const rawLabel of edge.labels) {
      if (!rawLabel || typeof rawLabel !== "object") continue;
      const lbl = rawLabel as {
        attrs?:
          | {
              text?:
                { text?: string | undefined; fill?: string | undefined; fontSize?: number | undefined } | undefined;
              label?: { text?: string | undefined } | undefined;
              rect?: { fill?: string | undefined; stroke?: string | undefined } | undefined;
            }
          | undefined;
        position?: number | { distance?: number | undefined } | undefined;
      };
      const text = lbl.attrs?.text?.text ?? lbl.attrs?.label?.text;
      if (!text) continue;
      const frac =
        typeof lbl.position === "number"
          ? lbl.position <= 1 && lbl.position >= 0
            ? lbl.position
            : 0.5
          : typeof lbl.position?.distance === "number" && lbl.position.distance <= 1 && lbl.position.distance >= 0
            ? lbl.position.distance
            : 0.5;
      const pt = this.samplePointAlongPolyline(pts, frac);

      const lg = document.createElementNS(SVG_NS, "g");
      lg.setAttribute("class", "x6-edge-label");
      lg.setAttribute("transform", `translate(${pt.x}, ${pt.y})`);

      const fontSize = lbl.attrs?.text?.fontSize ?? 11;
      const padX = 5;
      const estW = Math.max(18, text.length * (fontSize * 0.62) + padX * 2);
      const estH = fontSize + 6;
      const pill = document.createElementNS(SVG_NS, "rect");
      pill.setAttribute("x", String(-estW / 2));
      pill.setAttribute("y", String(-estH / 2));
      pill.setAttribute("width", String(estW));
      pill.setAttribute("height", String(estH));
      pill.setAttribute("rx", "3");
      pill.setAttribute("fill", lbl.attrs?.rect?.fill ?? "rgba(15, 23, 42, 0.85)");
      if (lbl.attrs?.rect?.stroke) pill.setAttribute("stroke", lbl.attrs.rect.stroke);
      lg.appendChild(pill);

      const txt = document.createElementNS(SVG_NS, "text");
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("dominant-baseline", "central");
      txt.setAttribute("font-size", String(fontSize));
      txt.setAttribute("fill", lbl.attrs?.text?.fill ?? "#e2e8f0");
      txt.textContent = text;
      lg.appendChild(txt);
      labelsG.appendChild(lg);
    }
  }

  public rebuildCellDom(cell: UnifiedCell): void {
    if (typeof document === "undefined" || !this.nodesG || !this.edgesG) return;
    if (this.activeRenderMode === "canvas2d") {
      this.scheduleCanvas2DRender();
      return;
    }

    if (cell.view?.container && cell.view.container.parentNode) {
      cell.view.container.parentNode.removeChild(cell.view.container);
    }
    cell.selectorElements.clear();

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("data-cell-id", cell.id);
    g.setAttribute("class", cell.isNode() ? "x6-cell x6-node" : "x6-cell x6-edge");

    if (cell.isNode()) {
      const glyph = cell.getCompiledGlyph();
      if (glyph) {
        const inner = materializeGlyphToSvg(glyph, document, cell.width, cell.height, cell.selectorElements);
        g.appendChild(inner);
      }
      // Render ports
      for (const p of cell.getPorts()) {
        const pg = document.createElementNS(SVG_NS, "g");
        pg.setAttribute("class", "x6-port");
        pg.setAttribute("port", p.id);
        pg.setAttribute("port-id", p.id);
        pg.setAttribute("magnet", "true");
        const px = p.args?.x ?? 0;
        const py = p.args?.y ?? 0;
        pg.setAttribute("transform", `translate(${px}, ${py})`);
        if (p.markup) {
          const portGlyph = compileGlyphMarkup(p.markup, p.attrs, 8, 8);
          pg.appendChild(materializeGlyphToSvg(portGlyph, document, 8, 8));
        } else {
          const dot = document.createElementNS(SVG_NS, "circle");
          dot.setAttribute("r", "4");
          dot.setAttribute("fill", "#38bdf8");
          dot.setAttribute("stroke", "#0f172a");
          dot.setAttribute("stroke-width", "1");
          pg.appendChild(dot);
        }
        g.appendChild(pg);
      }
      this.nodesG.appendChild(g);
    } else {
      const pathEl = document.createElementNS(SVG_NS, "path");
      pathEl.setAttribute("fill", "none");
      pathEl.setAttribute("data-selector", "line");
      pathEl.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(pathEl);
      cell.selectorElements.set("line", [pathEl]);
      this.edgesG.appendChild(g);
    }

    const view = this.findViewByCell(cell)!;
    view.container = g;
    this.syncCellDom(cell);
  }

  public syncCellDom(cell: UnifiedCell): void {
    if (this.activeRenderMode === "canvas2d") {
      this.scheduleCanvas2DRender();
      return;
    }
    const el = cell.view?.container;
    if (!el) return;

    if (cell.isNode()) {
      const cx = cell.width / 2;
      const cy = cell.height / 2;
      const rot = cell.angle !== 0 ? ` rotate(${cell.angle}, ${cx}, ${cy})` : "";
      el.setAttribute("transform", `translate(${cell.x}, ${cell.y})${rot}`);
      if ("style" in el) {
        (el as HTMLElement).style.display = cell.visible ? "" : "none";
      }
    } else {
      const { d, sourcePt, targetPt, routePoints, stroke, strokeWidth, strokeDasharray, sourceMarker, targetMarker } =
        this.computeEdgeRenderPath(cell);
      const pathEl = cell.selectorElements.get("line")?.[0];
      if (pathEl) {
        pathEl.setAttribute("d", d);
        pathEl.setAttribute("stroke", stroke);
        pathEl.setAttribute("stroke-width", String(strokeWidth));
        if (strokeDasharray) pathEl.setAttribute("stroke-dasharray", strokeDasharray);
        else pathEl.removeAttribute("stroke-dasharray");

        const srcMarkerId = this.ensureEdgeMarker(sourceMarker, stroke);
        if (srcMarkerId) pathEl.setAttribute("marker-start", `url(#${srcMarkerId})`);
        else pathEl.removeAttribute("marker-start");

        const tgtMarkerId = this.ensureEdgeMarker(targetMarker, stroke);
        if (tgtMarkerId) pathEl.setAttribute("marker-end", `url(#${tgtMarkerId})`);
        else pathEl.removeAttribute("marker-end");
      }
      this.syncEdgeLabelsDom(cell, [sourcePt, ...routePoints, targetPt]);
      if (cell.getTools().length > 0) {
        this.syncEdgeToolsDom(cell);
      }
    }
  }

  public patchCellSelectorDom(cell: UnifiedCell, selector: string, key: string, val: unknown): void {
    if (this.activeRenderMode === "canvas2d") {
      this.scheduleCanvas2DRender();
      return;
    }
    const els = cell.selectorElements.get(selector);
    if (!els || els.length === 0) return;
    for (const el of els) {
      if (key === "text" || key === "textContent") {
        const str = val === null || val === undefined ? "" : String(val);
        if (el.tagName.toLowerCase() === "text" && typeof document !== "undefined") {
          setSvgTextContent(el, str, document);
        } else {
          el.textContent = str;
        }
      } else if (val === null || val === undefined) {
        el.removeAttribute(key);
      } else {
        el.setAttribute(key, String(val));
      }
    }
  }

  /**
   * Renders interactive native SVG edge editing handles (orthogonal segment midpoint bars,
   * vertex dots with drag & right-click delete, and remove pill) directly inside `edgeToolsG`.
   */
  public syncEdgeToolsDom(edge: UnifiedCell): void {
    if (!this.edgeToolsG || typeof document === "undefined") return;
    const existing = this.edgeToolsG.querySelector(`[data-edge-tools-id="${edge.id}"]`);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    const tools = edge.getTools();
    if (!tools || tools.length === 0 || !this.cells.has(edge.id)) return;

    const toolNames = new Set<string>();
    for (const t of tools) {
      if (typeof t === "string") toolNames.add(t);
      else if (t && typeof t === "object" && "name" in t) {
        toolNames.add(String((t as { name: string }).name));
      }
    }

    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("data-edge-tools-id", edge.id);
    group.setAttribute("class", "x6-edge-tools-group");

    const sourcePt = edge.getSourcePoint();
    const targetPt = edge.getTargetPoint();
    const verts = edge.getVertices();
    const fullPoly = [sourcePt, ...verts, targetPt];

    // 1. Orthogonal segment drag bars at each segment midpoint
    if (toolNames.has("segments")) {
      for (let i = 0; i < fullPoly.length - 1; i++) {
        const a = fullPoly[i]!;
        const b = fullPoly[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 16) continue;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const isHoriz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
        const bar = document.createElementNS(SVG_NS, "rect");
        bar.setAttribute("class", "ms-segment-handle");
        bar.setAttribute("x", String(mx - (isHoriz ? 7 : 3)));
        bar.setAttribute("y", String(my - (isHoriz ? 3 : 7)));
        bar.setAttribute("width", String(isHoriz ? 14 : 6));
        bar.setAttribute("height", String(isHoriz ? 6 : 14));
        bar.setAttribute("rx", "2");
        bar.setAttribute("fill", "#38bdf8");
        bar.setAttribute("stroke", "#0f172a");
        bar.setAttribute("stroke-width", "1");
        bar.style.cursor = isHoriz ? "ns-resize" : "ew-resize";
        bar.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          const pt = this.clientToLocal(e.clientX, e.clientY);
          this.fsm.startSegmentDrag(edge.id, i, pt.x, pt.y);
        });
        group.appendChild(bar);
      }
    }

    // 2. Vertex drag dots (right-click or double-click removes vertex)
    if (toolNames.has("vertices")) {
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i]!;
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "ms-vertex-handle");
        dot.setAttribute("cx", String(v.x));
        dot.setAttribute("cy", String(v.y));
        dot.setAttribute("r", "4.5");
        dot.setAttribute("fill", "#f8fafc");
        dot.setAttribute("stroke", "#0284c7");
        dot.setAttribute("stroke-width", "1.5");
        dot.style.cursor = "move";
        dot.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          const pt = this.clientToLocal(e.clientX, e.clientY);
          this.fsm.startVertexDrag(edge.id, i, pt.x, pt.y);
        });
        const removeVertex = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          const next = edge.getVertices();
          next.splice(i, 1);
          edge.setVertices(next);
          this.syncEdgeToolsDom(edge);
        };
        dot.addEventListener("contextmenu", removeVertex);
        dot.addEventListener("dblclick", removeVertex);
        group.appendChild(dot);
      }
    }

    // 3. Remove edge button
    if (toolNames.has("button-remove")) {
      const mid = this.samplePointAlongPolyline(fullPoly, 0.5);
      const btnG = document.createElementNS(SVG_NS, "g");
      btnG.setAttribute("class", "ms-edge-remove-btn");
      btnG.setAttribute("transform", `translate(${mid.x + 12}, ${mid.y - 12})`);
      btnG.style.cursor = "pointer";
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", "7");
      circle.setAttribute("fill", "#ef4444");
      circle.setAttribute("stroke", "#ffffff");
      circle.setAttribute("stroke-width", "1.2");
      const cross = document.createElementNS(SVG_NS, "path");
      cross.setAttribute("d", "M -2.5 -2.5 L 2.5 2.5 M 2.5 -2.5 L -2.5 2.5");
      cross.setAttribute("stroke", "#ffffff");
      cross.setAttribute("stroke-width", "1.4");
      btnG.appendChild(circle);
      btnG.appendChild(cross);
      btnG.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.removeCell(edge);
      });
      group.appendChild(btnG);
    }

    this.edgeToolsG.appendChild(group);
  }

  private syncMarqueeDom(rect: WorldBounds | null): void {
    if (!this.marqueeRectEl) return;
    if (!rect || (rect.width < 1 && rect.height < 1)) {
      this.marqueeRectEl.style.display = "none";
      return;
    }
    this.marqueeRectEl.style.display = "";
    this.marqueeRectEl.setAttribute("x", String(rect.x));
    this.marqueeRectEl.setAttribute("y", String(rect.y));
    this.marqueeRectEl.setAttribute("width", String(rect.width));
    this.marqueeRectEl.setAttribute("height", String(rect.height));
  }

  private syncAlignmentGuidesDom(guides: AlignmentGuideLine[]): void {
    if (!this.guidesG || typeof document === "undefined") return;
    this.guidesG.innerHTML = "";
    for (const g of guides) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "ms-alignment-guide");
      if (g.orientation === "vertical") {
        line.setAttribute("x1", String(g.position));
        line.setAttribute("x2", String(g.position));
        line.setAttribute("y1", String(g.start));
        line.setAttribute("y2", String(g.end));
      } else {
        line.setAttribute("x1", String(g.start));
        line.setAttribute("x2", String(g.end));
        line.setAttribute("y1", String(g.position));
        line.setAttribute("y2", String(g.position));
      }
      line.setAttribute("stroke", "#ec4899");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "4 3");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      this.guidesG.appendChild(line);
    }
  }

  private syncMagnetHighlightsDom(preview: WiringPreview | null): void {
    if (!this.nodesG) return;
    const ports = this.nodesG.querySelectorAll(".x6-port");
    ports.forEach((el) => {
      el.classList.remove("x6-magnet-available");
      el.classList.remove("x6-magnet-adsorbed");
      if (!preview) return;
      const cellId = el.closest?.("[data-cell-id]")?.getAttribute("data-cell-id");
      const portId = el.getAttribute("port") ?? el.getAttribute("port-id");
      if (preview.snappedTarget && preview.snappedTarget.nodeId === cellId && preview.snappedTarget.portId === portId) {
        el.classList.add("x6-magnet-adsorbed");
      } else if (cellId !== preview.sourceNodeId || portId !== preview.sourcePortId) {
        el.classList.add("x6-magnet-available");
      }
    });
  }

  private refreshConnectedEdges(node: UnifiedCell): void {
    for (const edge of this.getConnectedEdges(node)) {
      this.syncCellDom(edge);
    }
  }

  private syncSelectionBoxesDom(): void {
    if (!this.selectionOverlayEl || typeof document === "undefined") return;
    const mode = this.fsm.mode;
    if (mode === "resizing" || mode === "rotating") {
      for (const id of this.selectedIds) {
        const cell = this.cells.get(id);
        if (!cell || !cell.isNode()) continue;
        const existingBox = this.selectionOverlayEl.querySelector(
          `.x6-widget-selection-box[data-cell-id="${cell.id}"]`,
        ) as HTMLElement | null;
        if (existingBox) {
          const rect = this.coord.localToGraphRect(cell.getBBox());
          existingBox.style.left = `${rect.x}px`;
          existingBox.style.top = `${rect.y}px`;
          existingBox.style.width = `${rect.width}px`;
          existingBox.style.height = `${rect.height}px`;
          existingBox.style.transform = cell.angle !== 0 ? `rotate(${cell.angle}deg)` : "";
        }
      }
      return;
    }
    this.selectionOverlayEl.innerHTML = "";
    const handles: ResizeHandleKind[] = ["nw", "ne", "se", "sw", "rotate"];

    for (const id of this.selectedIds) {
      const cell = this.cells.get(id);
      if (!cell || !cell.isNode()) continue;
      const rect = this.coord.localToGraphRect(cell.getBBox());
      const box = document.createElement("div");
      box.className = "x6-widget-selection-box";
      box.setAttribute("data-cell-id", cell.id);
      box.style.position = "absolute";
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.style.border = "1.5px solid #38bdf8";
      box.style.boxSizing = "content-box";
      box.style.margin = "-5px 0 0 -5px";
      box.style.padding = "4px";
      box.style.pointerEvents = "none";
      if (cell.angle !== 0) {
        box.style.transform = `rotate(${cell.angle}deg)`;
        box.style.transformOrigin = "center center";
      }

      for (const h of handles) {
        const dot = document.createElement("div");
        dot.className = `ms-resize-handle ms-handle-${h}`;
        dot.style.position = "absolute";
        dot.style.width = "8px";
        dot.style.height = "8px";
        dot.style.borderRadius = h === "rotate" ? "999px" : "2px";
        dot.style.background = h === "rotate" ? "#10b981" : "#38bdf8";
        dot.style.border = "1px solid #0f172a";
        dot.style.pointerEvents = "auto";
        dot.style.cursor = h === "rotate" ? "grab" : "nwse-resize";
        if (h === "nw") {
          dot.style.left = "-4px";
          dot.style.top = "-4px";
        } else if (h === "ne") {
          dot.style.right = "-4px";
          dot.style.top = "-4px";
        } else if (h === "se") {
          dot.style.right = "-4px";
          dot.style.bottom = "-4px";
        } else if (h === "sw") {
          dot.style.left = "-4px";
          dot.style.bottom = "-4px";
        } else if (h === "rotate") {
          dot.style.left = "50%";
          dot.style.top = "-18px";
          dot.style.marginLeft = "-4px";
        }
        dot.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          (this.container as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(e.pointerId);
          const pt = this.clientToLocal(e.clientX, e.clientY);
          this.fsm.startResize(cell.id, h, pt.x, pt.y);
        });
        box.appendChild(dot);
      }

      this.selectionOverlayEl.appendChild(box);
    }
  }
}

export { UnifiedCell as UnifiedEdge, UnifiedCell as UnifiedNode };
