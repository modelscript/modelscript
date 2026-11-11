// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractEdgePruneOptions,
  healOrthogonalVertices,
  pruneIntermediateVertices,
  type PointLike,
} from "./port-router.js";

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeLike {
  id: string;
  isNode?(): boolean;
  getBBox?(): RectLike;
  getAngle?(): number;
}

export interface GraphLike {
  container?: HTMLElement | undefined;
  matrix?: (() => { a: number; d: number; e: number; f: number }) | undefined;
  coord?: { localToGraphRect?: (rect: RectLike) => RectLike } | undefined;
  getCellById?(id: string): unknown;
  zoom?: (() => number) | undefined;
}

/**
 * Synchronizes a node's selection box DOM element with its model position, size, and rotation angle.
 */
export function alignNodeSelectionBox(box: HTMLElement, node: NodeLike, graph: GraphLike): void {
  if (!box || !node) return;
  const bbox = typeof node.getBBox === "function" ? node.getBBox() : null;
  if (!bbox) return;

  let x: number;
  let y: number;
  let w: number;
  let h: number;

  if (graph.coord && typeof graph.coord.localToGraphRect === "function") {
    const rect = graph.coord.localToGraphRect(bbox);
    x = rect.x;
    y = rect.y;
    w = rect.width;
    h = rect.height;
  } else {
    const ctm = typeof graph.matrix === "function" ? graph.matrix() : { a: 1, d: 1, e: 0, f: 0 };
    x = bbox.x * ctm.a + ctm.e;
    y = bbox.y * ctm.d + ctm.f;
    w = bbox.width * ctm.a;
    h = bbox.height * ctm.d;
  }

  const rawAngle = typeof node.getAngle === "function" ? node.getAngle() : 0;
  const angle = ((rawAngle % 360) + 360) % 360;
  const transform = angle !== 0 ? `rotate(${angle}deg)` : "";

  box.style.position = "absolute";
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  box.style.margin = "-5px 0 0 -5px";
  box.style.padding = "4px";
  box.style.boxSizing = "content-box";
  box.style.transform = transform;
  box.style.transformOrigin = "center center";
}

/**
 * Iterates all active selection boxes and aligns any that belong to nodes.
 */
export function syncAllNodeSelectionBoxes(graph: GraphLike, selectionContainer?: HTMLElement | null): void {
  const container = selectionContainer || graph.container?.querySelector?.(".x6-widget-selection");
  if (!container) return;
  const boxes = container.querySelectorAll(".x6-widget-selection-box");
  boxes.forEach((elem) => {
    const el = elem as HTMLElement;
    const id = el.getAttribute("data-cell-id");
    if (!id) return;
    const cell = typeof graph.getCellById === "function" ? (graph.getCellById(id) as NodeLike | null) : null;
    if (cell && (typeof cell.isNode !== "function" || cell.isNode())) {
      alignNodeSelectionBox(el, cell, graph);
    }
  });
}

import type { EdgeSelectionStyle, ResolvedEdgeSelectionStyle } from "./protocol.js";

export type { EdgeSelectionStyle, ResolvedEdgeSelectionStyle };

/**
 * Resolves the appropriate edge selection strategy based on language domain conventions
 * or explicit user/diagram preference.
 */
export function resolveEdgeSelectionStyle(
  language?: string | null | undefined,
  userPreference?: EdgeSelectionStyle | string | null | undefined,
): ResolvedEdgeSelectionStyle {
  if (userPreference && userPreference !== "auto") {
    if (
      userPreference === "minimalist" ||
      userPreference === "hud" ||
      userPreference === "trace" ||
      userPreference === "halo"
    ) {
      return userPreference;
    }
  }

  const lang = (language ?? "").toLowerCase().trim();

  // 1. Physical circuits, electronics, EDA, and electrical power grids:
  // Strict 1.5px non-scaling stroke, zero raster blur, solder dot preservation
  if (/^(modelica|mo|spice|cir|verilog-a|pscad|pscx|psse|raw|opendss|dss|touchstone|s2p|ibis|ibs)$/i.test(lang)) {
    return "minimalist";
  }

  // 2. Systems engineering, control blocks, flight dynamics, and state machines:
  // Directional signals, bus routes, quick rerouting/disconnect micro-HUD
  if (
    /^(sysml|sysml2|simulink|slx|mdl|easy5|plcopen|autosar|arxml|aml|automationml|jsbsim|rocets|ccsds)$/i.test(lang)
  ) {
    return "hud";
  }

  // 3. Fluid networks, piping & instrumentation, chemical process, hydrology:
  // Line weight represents pipe diameter/flow capacity; flow trace animation
  if (/^(olga|genkey|lps|aspen|relap5|r5|swmm|inp|epanet|energyplus|idf|cantera|phreeqc|gproms)$/i.test(lang)) {
    return "trace";
  }

  // 4. Default for ontologies, concept graphs, and general diagrams
  return "halo";
}

/**
 * Returns refined edge tool configurations for vertices and segments.
 * Dynamically scales handle dimensions based on graph zoom to prevent unsightly oversized handles.
 * In "minimalist" mode (e.g. Modelica, SPICE), segment midpoint drag pills are omitted to avoid schematic clutter.
 */
export function getEdgeToolConfig(
  _edge: unknown,
  graph: GraphLike,
  dark: boolean,
  style?: ResolvedEdgeSelectionStyle,
): unknown[] {
  const curZoom = typeof graph.zoom === "function" ? graph.zoom() : 1;
  // Scale handles dynamically to maintain a crisp, refined size on screen (~5.5px radius, 11px diameter)
  // across both close-in zoom and wide-view diagram zoom levels.
  const vertexRadius = Math.max(0.6, Math.min(6.0, 5.5 / (curZoom || 1)));
  const segW = Math.max(4.0, Math.min(18.0, 16.0 / (curZoom || 1)));
  const segH = Math.max(1.5, Math.min(7.0, 6.0 / (curZoom || 1)));

  const tools: unknown[] = [
    {
      name: "vertices",
      args: {
        attrs: {
          fill: dark ? "#1e293b" : "#ffffff",
          stroke: dark ? "#38bdf8" : "#0284c7",
          strokeWidth: 1.5,
          r: vertexRadius,
        },
        snapRadius: 12,
        removeRedundancies: true,
        stopPropagation: true,
        modifiers: ["alt", "ctrl", "meta"],
        processHandle: (handle: {
          delegateEvents?: (events: Record<string, unknown>) => void;
          emit?: (evt: string, args: unknown) => void;
        }) => {
          if (handle && typeof handle.delegateEvents === "function") {
            handle.delegateEvents({
              mousedown: "onMouseDown",
              touchstart: "onMouseDown",
              dblclick: "onDoubleClick",
              contextmenu: (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                handle.emit?.("remove", { e, handle });
              },
            });
          }
        },
      },
    },
  ];

  // In minimalist mode, suppress segment pills entirely to maintain strict schematic drafting standards
  if (style !== "minimalist") {
    tools.push({
      name: "segments",
      args: {
        attrs: {
          fill: dark ? "#1e293b" : "#ffffff",
          stroke: dark ? "#38bdf8" : "#0284c7",
          strokeWidth: 1.5,
          width: segW,
          height: segH,
          rx: segH / 2,
          ry: segH / 2,
          x: -segW / 2,
          y: -segH / 2,
        },
        snapRadius: 10,
        removeRedundancies: true,
        stopPropagation: true,
      },
    });
  }

  return tools;
}

/**
 * Patches the AntV X6 Vertices edge tool to prevent interaction crashes and runaway handle proliferation:
 * 1. Checks if a click is close to an existing vertex (<= 8px) and reuses that handle instead of inserting duplicates.
 * 2. Safely verifies that the newly inserted handle exists before delegating mouse events.
 * 3. Guarantees that any exception in vertex insertion or handle delegation gracefully terminates
 *    the 'add-vertex' batch so the graph interaction never freezes.
 * 4. Adds contextmenu handling to vertex handles for one-click deletion.
 */
export function ensurePatchedVerticesTool(x6Instance?: unknown): void {
  const x6Mod =
    x6Instance ||
    (typeof globalThis !== "undefined" ? (globalThis as Record<string, unknown>)["x6"] : undefined) ||
    (typeof window !== "undefined" ? (window as unknown as Record<string, unknown>)["x6"] : undefined);
  if (!x6Mod || typeof x6Mod !== "object") return;

  const anyX6 = x6Mod as {
    Registry?: { EdgeTool?: { presets?: { vertices?: unknown }; registry?: { get?(name: string): unknown } } };
    edgeToolPresets?: { vertices?: unknown };
  };

  const VerticesClass = (anyX6.Registry?.EdgeTool?.presets?.vertices ||
    anyX6.Registry?.EdgeTool?.registry?.get?.("vertices") ||
    anyX6.edgeToolPresets?.vertices) as
    | {
        prototype: {
          onPathMouseDown?(evt: unknown): void;
          allowAddVertex?(evt: unknown): boolean;
        };
        defaults?: {
          createHandle?(options: unknown): unknown;
        };
        __modelscript_patched?: boolean;
      }
    | undefined;

  interface VerticesToolContext {
    cellView: {
      cell?: {
        getVertices?(): Array<{ x: number; y: number }>;
        startBatch?(name: string, options?: Record<string, unknown>): void;
        insertVertex?(vertex: { x: number; y: number }, index: number, options?: Record<string, unknown>): void;
        stopBatch?(name: string, options?: Record<string, unknown>): void;
      };
      getVertexIndex?(x: number, y: number): number;
    };
    cid?: string;
    graph?: {
      snapToGrid?(x: number, y: number): { toJSON?(): { x: number; y: number } };
    };
    options?: {
      modifiers?: unknown;
      addable?: boolean;
    };
    handles?: Array<{ onMouseDown?(evt: unknown): void } | undefined>;
    allowAddVertex?(evt: unknown): boolean;
    normalizeEvent?(evt: unknown): { clientX: number; clientY: number };
    snapVertex?(vertex: { x: number; y: number }, index: number): void;
    render?(): void;
    eventData?(evt: unknown, data: Record<string, unknown>): void;
  }

  if (!VerticesClass || VerticesClass.__modelscript_patched) return;

  VerticesClass.prototype.onPathMouseDown = function (this: VerticesToolContext, evt: unknown) {
    const edgeView = this.cellView;
    const e =
      typeof this.normalizeEvent === "function"
        ? this.normalizeEvent(evt)
        : (evt as { clientX: number; clientY: number });
    const vertex = this.graph?.snapToGrid?.(e.clientX, e.clientY)?.toJSON?.() || { x: e.clientX, y: e.clientY };

    // Prevent duplicate vertex proliferation if clicking near an existing vertex (<= 12px).
    // Dragging an existing vertex handle should never require holding a modifier key.
    const existingVertices = edgeView.cell?.getVertices?.() || [];
    let nearbyIndex = -1;
    for (let i = 0; i < existingVertices.length; i++) {
      const v = existingVertices[i];
      if (v && Math.hypot(v.x - vertex.x, v.y - vertex.y) <= 12) {
        nearbyIndex = i;
        break;
      }
    }

    if (nearbyIndex >= 0) {
      const evtObj = evt as { stopPropagation?: () => void; preventDefault?: () => void } | null;
      if (evtObj && typeof evtObj.stopPropagation === "function") evtObj.stopPropagation();
      if (evtObj && typeof evtObj.preventDefault === "function") evtObj.preventDefault();
      const existingHandle = this.handles?.[nearbyIndex];
      if (existingHandle && typeof existingHandle.onMouseDown === "function") {
        existingHandle.onMouseDown(e);
        return;
      }
    }

    // Adding a new vertex requires passing allowAddVertex (e.g. holding Alt/Ctrl modifier)
    if (typeof this.allowAddVertex === "function") {
      if (!this.allowAddVertex(evt)) return;
    } else if (this.options?.modifiers) {
      const evtAny = evt as { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
      const hasMod = Boolean(evtAny.altKey || evtAny.ctrlKey || evtAny.metaKey);
      if (!hasMod) return;
    }

    const evtObj = evt as { stopPropagation?: () => void; preventDefault?: () => void } | null;
    if (evtObj && typeof evtObj.stopPropagation === "function") evtObj.stopPropagation();
    if (evtObj && typeof evtObj.preventDefault === "function") evtObj.preventDefault();

    try {
      edgeView.cell?.startBatch?.("add-vertex", { ui: true, toolId: this.cid });
      const index = typeof edgeView.getVertexIndex === "function" ? edgeView.getVertexIndex(vertex.x, vertex.y) : 0;
      if (typeof this.snapVertex === "function") {
        this.snapVertex(vertex, index);
      }
      edgeView.cell?.insertVertex?.(vertex, index, { ui: true, toolId: this.cid });
      if (typeof this.render === "function") {
        this.render();
      }
      const handle = this.handles?.[index] ?? this.handles?.[this.handles.length - 1];
      if (typeof this.eventData === "function") {
        this.eventData(e, { vertexAdded: true });
      }
      if (handle && typeof handle.onMouseDown === "function") {
        handle.onMouseDown(e);
      } else {
        edgeView.cell?.stopBatch?.("add-vertex", { ui: true, toolId: this.cid });
      }
    } catch {
      try {
        edgeView.cell?.stopBatch?.("add-vertex", { ui: true, toolId: this.cid });
      } catch {}
    }
  };

  const origCreateHandle = VerticesClass.defaults?.createHandle;
  if (typeof origCreateHandle === "function") {
    VerticesClass.defaults = VerticesClass.defaults || {};
    VerticesClass.defaults.createHandle = function (options: unknown) {
      const handle = origCreateHandle(options) as {
        delegateEvents?(events: Record<string, unknown>): void;
        emit?(name: string, args: unknown): void;
      } | null;
      if (handle && typeof handle.delegateEvents === "function") {
        handle.delegateEvents({
          mousedown: "onMouseDown",
          touchstart: "onMouseDown",
          dblclick: "onDoubleClick",
          contextmenu: (e: MouseEvent) => {
            if (e) {
              if (typeof e.preventDefault === "function") e.preventDefault();
              if (typeof e.stopPropagation === "function") e.stopPropagation();
            }
            handle.emit?.("remove", { e, handle });
          },
        });
      }
      return handle;
    };
  }

  VerticesClass.__modelscript_patched = true;
}

/**
 * Patches the AntV X6 Segments edge tool for schematic orthogonal drafting:
 * 1. Prevents ripping port anchors off component nodes when dragging terminal wire segments.
 * 2. Maintains strict orthogonal 90-degree corners and heals any micro-slants after dragging.
 */
export function ensurePatchedSegmentsTool(x6Instance?: unknown): void {
  const x6Mod =
    x6Instance ||
    (typeof globalThis !== "undefined" ? (globalThis as Record<string, unknown>)["x6"] : undefined) ||
    (typeof window !== "undefined" ? (window as unknown as Record<string, unknown>)["x6"] : undefined);
  if (!x6Mod || typeof x6Mod !== "object") return;

  const anyX6 = x6Mod as {
    Registry?: { EdgeTool?: { presets?: { segments?: unknown }; registry?: { get?(name: string): unknown } } };
    edgeToolPresets?: { segments?: unknown };
  };

  const SegmentsClass = (anyX6.Registry?.EdgeTool?.presets?.segments ||
    anyX6.Registry?.EdgeTool?.registry?.get?.("segments") ||
    anyX6.edgeToolPresets?.segments) as
    | {
        prototype: {
          onHandleChanging?(args: { handle: unknown; e: unknown }): void;
          onHandleChanged?(args: { e: unknown }): void;
        };
        __modelscript_patched?: boolean;
      }
    | undefined;

  if (!SegmentsClass || SegmentsClass.__modelscript_patched) return;

  const origOnHandleChanging = SegmentsClass.prototype.onHandleChanging;
  if (typeof origOnHandleChanging === "function") {
    SegmentsClass.prototype.onHandleChanging = function (args: { handle: unknown; e: unknown }) {
      origOnHandleChanging.call(this, args);

      const cell = (this as any).cellView?.cell;
      if (cell) {
        const rawSrc = typeof cell.getSource === "function" ? cell.getSource() : cell.source;
        const rawTgt = typeof cell.getTarget === "function" ? cell.getTarget() : cell.target;
        if (rawSrc?.port && typeof cell.prop === "function") {
          const currentAnchor = cell.prop(["source", "anchor"]);
          if (currentAnchor) {
            cell.removeProp?.(["source", "anchor"]);
          }
        }
        if (rawTgt?.port && typeof cell.prop === "function") {
          const currentAnchor = cell.prop(["target", "anchor"]);
          if (currentAnchor) {
            cell.removeProp?.(["target", "anchor"]);
          }
        }
      }
    };
  }

  const origOnHandleChanged = SegmentsClass.prototype.onHandleChanged;
  if (typeof origOnHandleChanged === "function") {
    SegmentsClass.prototype.onHandleChanged = function (args: { e: unknown }) {
      origOnHandleChanged.call(this, args);

      const edge = (this as any).cellView?.cell;
      const edgeView = (this as any).cellView;
      if (edge && edgeView) {
        const srcPt = typeof edge.getSourcePoint === "function" ? edge.getSourcePoint() : edgeView.sourceAnchor;
        const tgtPt = typeof edge.getTargetPoint === "function" ? edge.getTargetPoint() : edgeView.targetAnchor;
        const verts: PointLike[] = typeof edge.getVertices === "function" ? edge.getVertices() || [] : [];
        if (srcPt && tgtPt && verts.length > 0) {
          const healed = healOrthogonalVertices(srcPt, tgtPt, verts);
          const pruneOpts = extractEdgePruneOptions(edgeView.graph, edge, srcPt, tgtPt);
          const prunedVerts = pruneIntermediateVertices(srcPt, tgtPt, healed, pruneOpts);
          edge.setVertices?.(prunedVerts, { ignoreSnap: true, ui: true });
        }
      }
    };
  }

  SegmentsClass.__modelscript_patched = true;
}

/**
 * Scales and updates a node's visual SVG elements, viewBox boundaries, background/hitbox rects,
 * and connection ports in real-time when the node is resized by the user or layout engine.
 */
export function updateNodeVisualOnResize(
  node: unknown,
  graph: unknown,
  newWidth: number,
  newHeight: number,
  prevWidth?: number,
  prevHeight?: number,
): void {
  if (!node || !graph || newWidth <= 0 || newHeight <= 0) return;
  const anyNode = node as any;
  const anyGraph = graph as any;

  if (typeof anyNode.isNode === "function" && !anyNode.isNode()) return;

  const view = typeof anyGraph.findViewByCell === "function" ? anyGraph.findViewByCell(anyNode) : null;
  const container: HTMLElement | SVGElement | null | undefined = view?.container;

  // Find the root SVG element inside the node's DOM container
  let rootSvg: SVGSVGElement | null = null;
  if (container) {
    rootSvg =
      container.tagName?.toLowerCase() === "svg"
        ? (container as SVGSVGElement)
        : (container.querySelector("svg") as SVGSVGElement | null);
  }

  // Update ports proportionally
  const ports = typeof anyNode.getPorts === "function" ? anyNode.getPorts() : [];
  if (Array.isArray(ports) && ports.length > 0) {
    const data = typeof anyNode.getData === "function" ? anyNode.getData() || {} : {};
    let portRatios = data.__portRatios as Record<string, { rx: number; ry: number }> | undefined;

    if (!portRatios) {
      portRatios = {};
      let baseW = prevWidth && prevWidth > 0 ? prevWidth : 0;
      let baseH = prevHeight && prevHeight > 0 ? prevHeight : 0;

      if (baseW <= 0 && rootSvg) {
        const svgW = parseFloat(rootSvg.getAttribute("width") || "");
        if (!isNaN(svgW) && svgW > 0) baseW = svgW;
      }
      if (baseH <= 0 && rootSvg) {
        const svgH = parseFloat(rootSvg.getAttribute("height") || "");
        if (!isNaN(svgH) && svgH > 0) baseH = svgH;
      }
      if (baseW <= 0) {
        baseW =
          (typeof data.origWidth === "number" ? data.origWidth : 0) ||
          (typeof anyNode.getSize === "function" ? anyNode.getSize()?.width : 0) ||
          newWidth;
      }
      if (baseH <= 0) {
        baseH =
          (typeof data.origHeight === "number" ? data.origHeight : 0) ||
          (typeof anyNode.getSize === "function" ? anyNode.getSize()?.height : 0) ||
          newHeight;
      }

      for (const p of ports) {
        if (!p?.id) continue;
        const curArgs = p.args || {};
        const px = typeof curArgs.x === "number" ? curArgs.x : 0;
        const py = typeof curArgs.y === "number" ? curArgs.y : 0;
        portRatios[p.id] = {
          rx: baseW > 0 ? px / baseW : 0.5,
          ry: baseH > 0 ? py / baseH : 0.5,
        };
      }

      if (typeof anyNode.setData === "function") {
        anyNode.setData({ ...data, __portRatios: portRatios }, { silent: true });
      }
    }

    for (const p of ports) {
      if (!p?.id) continue;
      const ratio = portRatios[p.id];
      if (ratio && typeof anyNode.setPortProp === "function") {
        const portX = Math.round(ratio.rx * newWidth * 10) / 10;
        const portY = Math.round(ratio.ry * newHeight * 10) / 10;
        anyNode.setPortProp(p.id, "args", {
          ...(p.args || {}),
          x: portX,
          y: portY,
        });
      }
    }
  }

  // Update root SVG and structural DOM elements
  if (rootSvg) {
    rootSvg.setAttribute("width", String(newWidth));
    rootSvg.setAttribute("height", String(newHeight));

    const updateSvgSubtree = (parent: Element, w: number, h: number) => {
      for (const child of Array.from(parent.children) as (HTMLElement | SVGElement)[]) {
        const tag = child.tagName?.toLowerCase();
        if (tag === "rect") {
          child.setAttribute("width", String(w));
          child.setAttribute("height", String(h));
        } else if (tag === "g") {
          const transform = child.getAttribute("transform") || "";
          const scaleMatch = transform.match(/scale\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
          if (scaleMatch) {
            const sx = parseFloat(scaleMatch[1]!);
            const sy = parseFloat(scaleMatch[2]!);
            const tx = sx < 0 ? w : 0;
            const ty = sy < 0 ? h : 0;
            child.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
          }
          // Recurse into nested <g> (stops if child is <svg> so inner icon graphics are preserved)
          updateSvgSubtree(child, w, h);
        } else if (tag === "text") {
          if (child.getAttribute("text-anchor") === "middle") {
            child.setAttribute("x", String(w / 2));
            child.setAttribute("y", String(h / 2 + 3));
          }
        }
      }
    };

    updateSvgSubtree(rootSvg, newWidth, newHeight);
  }

  // Keep stored markup attributes in sync if markup is attached
  const curMarkup = typeof anyNode.getMarkup === "function" ? anyNode.getMarkup() : null;
  if (curMarkup && typeof curMarkup === "object" && (curMarkup as any).attrs) {
    const m = curMarkup as any;
    m.attrs.width = newWidth;
    m.attrs.height = newHeight;
    const updateMarkupSubtree = (item: any) => {
      if (!item) return;
      if (item.tagName === "rect" && item.attrs) {
        item.attrs.width = newWidth;
        item.attrs.height = newHeight;
      } else if (item.tagName === "g") {
        if (item.attrs?.transform) {
          const scaleMatch = String(item.attrs.transform).match(/scale\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
          if (scaleMatch) {
            const sx = parseFloat(scaleMatch[1]!);
            const sy = parseFloat(scaleMatch[2]!);
            const tx = sx < 0 ? newWidth : 0;
            const ty = sy < 0 ? newHeight : 0;
            item.attrs.transform = `translate(${tx}, ${ty}) scale(${sx}, ${sy})`;
          }
        }
        if (Array.isArray(item.children)) {
          for (const c of item.children) updateMarkupSubtree(c);
        }
      }
    };
    if (Array.isArray(m.children)) {
      for (const child of m.children) {
        updateMarkupSubtree(child);
      }
    }
  }
}
