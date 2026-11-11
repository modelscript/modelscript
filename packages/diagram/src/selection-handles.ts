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
  // Scale handles dynamically to maintain a crisp, refined size on screen (~3px radius, 6px diameter)
  // across both close-in zoom and wide-view diagram zoom levels.
  const vertexRadius = Math.max(0.3, Math.min(3.5, 3.5 / (curZoom || 1)));
  const segW = Math.max(1.5, Math.min(10, 8 / (curZoom || 1)));
  const segH = Math.max(0.6, Math.min(3, 2.5 / (curZoom || 1)));

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
        snapRadius: 10,
        removeRedundancies: true,
        stopPropagation: true,
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
    if (typeof this.allowAddVertex === "function" && !this.allowAddVertex(evt)) return;
    const evtObj = evt as { stopPropagation?: () => void; preventDefault?: () => void } | null;
    if (evtObj && typeof evtObj.stopPropagation === "function") evtObj.stopPropagation();
    if (evtObj && typeof evtObj.preventDefault === "function") evtObj.preventDefault();
    const e =
      typeof this.normalizeEvent === "function"
        ? this.normalizeEvent(evt)
        : (evt as { clientX: number; clientY: number });
    const vertex = this.graph?.snapToGrid?.(e.clientX, e.clientY)?.toJSON?.() || { x: e.clientX, y: e.clientY };

    // Prevent duplicate vertex proliferation if clicking near an existing vertex (<= 8px)
    const existingVertices = edgeView.cell?.getVertices?.() || [];
    let nearbyIndex = -1;
    for (let i = 0; i < existingVertices.length; i++) {
      const v = existingVertices[i];
      if (v && Math.hypot(v.x - vertex.x, v.y - vertex.y) <= 8) {
        nearbyIndex = i;
        break;
      }
    }

    if (nearbyIndex >= 0) {
      const existingHandle = this.handles?.[nearbyIndex];
      if (existingHandle && typeof existingHandle.onMouseDown === "function") {
        existingHandle.onMouseDown(e);
        return;
      }
    }

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
