// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorldBounds, WorldPoint } from "../../schema/canvas-document.js";
import {
  applyAttrsToGlyph,
  compileGlyphMarkup,
  patchGlyphAttrPath,
  readGlyphAttrPath,
  type CompiledGlyph,
  type DiagramMarkupNode,
} from "../glyph-compiler.js";
import { SceneNodeFlags } from "../soa-scene.js";
import { escapeSelectorAttr, nextAutoCellId, resolvePortsWithGroups } from "./geometry.js";
import type {
  UnifiedCellHost,
  UnifiedCellViewBase,
  UnifiedEdgeTerminal,
  UnifiedGraphOptionsBase,
  UnifiedPortItem,
  UnifiedSelectionOptionsBase,
  UnifiedTransformOptionsBase,
} from "./types.js";

export type UnifiedSelectionOptions = UnifiedSelectionOptionsBase<UnifiedCell>;
export type UnifiedTransformOptions = UnifiedTransformOptionsBase<UnifiedCell>;
export type UnifiedGraphOptions = UnifiedGraphOptionsBase<UnifiedCell>;

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

  private graph: UnifiedCellHost<UnifiedCell> | null = null;
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
  public view: UnifiedCellViewBase<UnifiedCell, UnifiedCellHost<UnifiedCell>> | null = null;
  public selectorElements = new Map<string, Element[]>();

  constructor(kind: "node" | "edge", metadata: Record<string, unknown>, graph?: UnifiedCellHost<UnifiedCell> | null) {
    this.kind = kind;
    this.graph = graph ?? null;
    this.id =
      typeof metadata["id"] === "string" && metadata["id"].length > 0 ? metadata["id"] : nextAutoCellId(`${kind}_`);
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

  public attachGraph(graph: UnifiedCellHost<UnifiedCell> | null): void {
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
      const moveChildren = (parent: UnifiedCell) => {
        for (const child of parent.children) {
          child.x += dx;
          child.y += dy;
          this.graph?.syncCellDom(child);
          moveChildren(child);
        }
      };
      moveChildren(this);
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
    this.graph?.resizeCellVisualDom(this, prev.width, prev.height);
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
    if (this.kind === "node") {
      this.graph?.scene.setNodeZIndex(this.id, z);
    } else {
      const rec = this.graph?.scene.getEdge(this.id);
      if (rec) rec.zIndex = z;
    }
    this.graph?.reorderCellDomByZIndex(this);
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
    const escPort = escapeSelectorAttr(portId);
    const existingPortEl =
      (key === "args" || key.startsWith("args/")) && containerEl
        ? containerEl.querySelector(`.ms-port[port-id="${escPort}"], .ms-port[port="${escPort}"]`)
        : null;
    if (existingPortEl && updatedPort) {
      const flipX = Boolean(this.data["flipX"]);
      const flipY = Boolean(this.data["flipY"]);
      const px = flipX ? this.width - (updatedPort.args?.x ?? 0) : (updatedPort.args?.x ?? 0);
      const py = flipY ? this.height - (updatedPort.args?.y ?? 0) : (updatedPort.args?.y ?? 0);
      existingPortEl.setAttribute("transform", `translate(${px}, ${py})`);
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

  public setVertices(
    vertices: WorldPoint[],
    options?: { ignoreSnap?: boolean | undefined; ui?: boolean | undefined; toolId?: string | undefined },
  ): void {
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

  public findView(
    graph?: UnifiedCellHost<UnifiedCell>,
  ): UnifiedCellViewBase<UnifiedCell, UnifiedCellHost<UnifiedCell>> | null {
    const g = graph ?? this.graph;
    return g ? g.findViewByCell(this) : this.view;
  }
}
