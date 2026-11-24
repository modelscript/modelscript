// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  paintCanvasPlot,
  paintCanvasTable,
  UnifiedGraph,
  type Canvas2DContextLike,
  type CanvasDocument,
  type CanvasTile,
  type DiagramMarkupNode,
  type PlotSeriesData,
  type TileAnchorSpec,
  type UnifiedPortItem,
  type WorldBounds,
} from "@modelscript/canvas";
import {
  getTileMaximizeButtonRect,
  PODIUM_BACK_BTN_RECT,
  PODIUM_HEADER_HEIGHT,
  PODIUM_NEXT_TILE_BTN_RECT,
  PODIUM_PREV_TILE_BTN_RECT,
  PODIUM_RESET_PAN_BTN_RECT,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  ROTUNDA_BOARD_TEX_OFFSET_X,
  ROTUNDA_BOARD_TEX_OFFSET_Y,
  ROTUNDA_BOARD_TEX_SCALE,
  type PodiumUiRect,
} from "./types.js";

/** Transient drag preview state for live 3D ray/controller tile dragging on the board plane. */
export interface DragPreviewState {
  tileId: string;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}

/** Optional interactive presentation options for `paintBoardToTextureCanvas`. */
export interface BoardPaintOptions {
  /** When non-null, zooms that single tile full-screen across the entire 45° desk surface. */
  focusedTileId?: string | null | undefined;
  /** Optional board viewport pan offset (in logical 1600×1000 UV pixels). */
  boardPan?: { x: number; y: number } | undefined;
  /** Tile ID whose top-right `[⤢]` full-screen zoom button is currently hovered. */
  hoveredMaximizeTileId?: string | null | undefined;
  /** Hovered header button ID (`"back" | "prev" | "next" | "reset-pan"`). */
  hoveredHeaderBtn?: "back" | "prev" | "next" | "reset-pan" | null | undefined;
}

export interface VrDiagramNodeLike {
  id?: string | undefined;
  shape?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  opacity?: number | undefined;
  zIndex?: number | undefined;
  label?: string | undefined;
  markup?: DiagramMarkupNode | DiagramMarkupNode[] | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  ports?:
    | { items?: UnifiedPortItem[] | undefined; groups?: Record<string, unknown> | undefined }
    | UnifiedPortItem[]
    | undefined;
  data?: Record<string, unknown> | undefined;
  properties?: { name?: string | undefined; className?: string | undefined } | undefined;
}

export interface VrDiagramEdgeLike {
  id?: string | undefined;
  source?:
    | string
    | { cell?: string | undefined; port?: string | undefined; x?: number | undefined; y?: number | undefined }
    | undefined;
  target?:
    | string
    | { cell?: string | undefined; port?: string | undefined; x?: number | undefined; y?: number | undefined }
    | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  connector?: unknown;
  router?: unknown;
  zIndex?: number | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
}

export interface VrDiagramDataLike {
  nodes: VrDiagramNodeLike[];
  edges: VrDiagramEdgeLike[];
}

/**
 * Resolves live tile bounds, substituting transient drag coordinates when the tile
 * is currently being dragged across the 3D Drafting Podium.
 */
export function resolveEffectiveBounds(
  tile: CanvasTile,
  dragPreview: DragPreviewState | null | undefined,
): WorldBounds {
  if (dragPreview && dragPreview.tileId === tile.id) {
    return {
      ...tile.bounds,
      x: dragPreview.x,
      y: dragPreview.y,
    };
  }
  return tile.bounds;
}

/**
 * Extracts and validates serialized schematic diagram nodes & edges from a tile's `viewState`.
 */
export function extractVrDiagramData(raw: unknown): VrDiagramDataLike | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec["nodes"]) || rec["nodes"].length === 0) return null;
  const nodes: VrDiagramNodeLike[] = [];
  for (const item of rec["nodes"]) {
    if (item && typeof item === "object") {
      nodes.push(item as VrDiagramNodeLike);
    }
  }
  if (nodes.length === 0) return null;
  const edges: VrDiagramEdgeLike[] = [];
  if (Array.isArray(rec["edges"])) {
    for (const item of rec["edges"]) {
      if (item && typeof item === "object") {
        edges.push(item as VrDiagramEdgeLike);
      }
    }
  }
  return { nodes, edges };
}

/**
 * Extracts validated `PlotSeriesData` trajectories from a tile's `viewState.simulationSeries`.
 */
export function extractVrSimulationSeries(raw: unknown): PlotSeriesData[] {
  if (!Array.isArray(raw)) return [];
  const out: PlotSeriesData[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec["id"] === "string" && rec["id"].length > 0 ? rec["id"] : `series_${i}`;
    const label = typeof rec["label"] === "string" && rec["label"].length > 0 ? rec["label"] : id;
    const color = typeof rec["color"] === "string" && rec["color"].length > 0 ? rec["color"] : "#0284c7";
    const unit = typeof rec["unit"] === "string" ? rec["unit"] : undefined;
    const rawX = rec["x"];
    const rawY = rec["y"];
    const validX = rawX instanceof Float64Array || (Array.isArray(rawX) && rawX.every((v) => typeof v === "number"));
    const validY = rawY instanceof Float64Array || (Array.isArray(rawY) && rawY.every((v) => typeof v === "number"));
    if (!validX || !validY) continue;
    const x = rawX as Float64Array | number[];
    const y = rawY as Float64Array | number[];
    if (Math.min(x.length, y.length) === 0) continue;
    out.push({ id, label, color, unit, x, y });
  }
  return out;
}

function truncateVrLabel(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLen - 1))}…`;
}

function getCanvasImageSourceSize(img: CanvasImageSource): { width: number; height: number } {
  const rec = img as unknown as {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number | SVGAnimatedLength;
    height?: number | SVGAnimatedLength;
  };
  const nw = typeof rec.naturalWidth === "number" && rec.naturalWidth > 0 ? rec.naturalWidth : 0;
  const nh = typeof rec.naturalHeight === "number" && rec.naturalHeight > 0 ? rec.naturalHeight : 0;
  if (nw > 0 && nh > 0) {
    return { width: nw, height: nh };
  }
  const vw = typeof rec.videoWidth === "number" && rec.videoWidth > 0 ? rec.videoWidth : 0;
  const vh = typeof rec.videoHeight === "number" && rec.videoHeight > 0 ? rec.videoHeight : 0;
  if (vw > 0 && vh > 0) {
    return { width: vw, height: vh };
  }
  const w = typeof rec.width === "number" && rec.width > 0 ? rec.width : 0;
  const h = typeof rec.height === "number" && rec.height > 0 ? rec.height : 0;
  return { width: w, height: h };
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (typeof ctx.quadraticCurveTo === "function" && r > 0) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  } else {
    ctx.rect(x, y, width, height);
  }
}

function paintStudioTileCard(
  ctx: CanvasRenderingContext2D,
  b: WorldBounds,
  accentColor: string,
  title: string,
  subtitle: string,
  headerH: number,
): void {
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.09)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = "#ffffff";
  traceRoundedRect(ctx, b.x, b.y, b.width, b.height, 10);
  ctx.fill();
  ctx.restore();

  // Crisp colored top accent strip clipped to card radius
  ctx.save();
  traceRoundedRect(ctx, b.x, b.y, b.width, b.height, 10);
  if (typeof ctx.clip === "function") {
    ctx.clip();
  }
  ctx.fillStyle = accentColor;
  ctx.fillRect(b.x, b.y, b.width, 5);
  ctx.restore();

  // Subtle card perimeter border & header hairline separator
  ctx.save();
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1.5;
  traceRoundedRect(ctx, b.x, b.y, b.width, b.height, 10);
  ctx.stroke();

  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(b.x + 1, b.y + headerH, b.width - 2, 1);

  // Crisp dark studio card typography
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 17px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(truncateVrLabel(title, 44), b.x + 14, b.y + 27);

  ctx.fillStyle = "#475569";
  ctx.font = "12px monospace";
  ctx.fillText(truncateVrLabel(subtitle, 54), b.x + 14, b.y + 46);
  ctx.restore();
}

function createVrSchematicBlockMarkup(
  width: number,
  height: number,
  strokeColor: string,
  title: string,
  subtitle: string | undefined,
  ports: { x: number; y: number; color: string }[],
): DiagramMarkupNode[] {
  const nodes: DiagramMarkupNode[] = [
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        x: 0,
        y: 0,
        width,
        height,
        rx: 6,
        ry: 6,
        fill: "#f8fafc",
        stroke: strokeColor,
        "stroke-width": 2,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        x: width / 2,
        y: subtitle ? height * 0.42 : height * 0.54,
        "text-anchor": "middle",
        fill: "#0f172a",
        "font-size": 11,
        "font-weight": "700",
        "font-family": "sans-serif",
      },
      textContent: title,
    },
  ];
  if (subtitle) {
    nodes.push({
      tagName: "text",
      selector: "sublabel",
      attrs: {
        x: width / 2,
        y: height * 0.76,
        "text-anchor": "middle",
        fill: "#475569",
        "font-size": 9,
        "font-weight": "600",
        "font-family": "monospace",
      },
      textContent: subtitle,
    });
  }
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    if (!p) continue;
    nodes.push({
      tagName: "circle",
      selector: `port_${i}`,
      attrs: {
        cx: p.x,
        cy: p.y,
        r: 3.8,
        fill: p.color,
        stroke: "#ffffff",
        "stroke-width": 1.4,
      },
    });
  }
  return nodes;
}

function populateVrSchematicGraph(
  graph: UnifiedGraph,
  tile: CanvasTile,
  accentColor: string,
  simulationTime: number,
): void {
  const diagramData = extractVrDiagramData(tile.viewState?.["diagramData"]);
  if (diagramData) {
    for (let i = 0; i < diagramData.nodes.length; i++) {
      const n = diagramData.nodes[i];
      if (!n) continue;
      const id = n.id ?? `vr_node_${i}`;
      const width = typeof n.width === "number" && n.width > 0 ? n.width : 96;
      const height = typeof n.height === "number" && n.height > 0 ? n.height : 50;
      const x = typeof n.x === "number" ? n.x : 20 + (i % 3) * 130;
      const y = typeof n.y === "number" ? n.y : 24 + Math.floor(i / 3) * 84;
      const label = truncateVrLabel(n.label ?? n.properties?.name ?? id, 16);
      graph.addNode({
        id,
        shape: n.shape ?? "rect",
        x,
        y,
        width,
        height,
        angle: n.angle ?? 0,
        opacity: n.opacity ?? 1,
        zIndex: n.zIndex ?? 1,
        markup: n.markup,
        attrs: n.attrs ?? {
          body: { fill: "#f8fafc", stroke: accentColor, strokeWidth: 2, rx: 6, ry: 6 },
          label: { text: label, fill: "#0f172a", fontSize: 10 },
        },
        ports: n.ports,
        data: n.data,
      });
    }
    for (let i = 0; i < diagramData.edges.length; i++) {
      const e = diagramData.edges[i];
      if (!e) continue;
      graph.addEdge({
        id: e.id ?? `vr_edge_${i}`,
        source: e.source,
        target: e.target,
        vertices: e.vertices,
        connector: e.connector ?? { name: "rounded", args: { radius: 6 } },
        router: e.router,
        zIndex: e.zIndex ?? 0,
        attrs: e.attrs ?? { line: { stroke: accentColor, strokeWidth: 2 } },
      });
    }
    return;
  }

  const anchors = tile.pinnedAnchors ?? [];
  const coreTitle = truncateVrLabel(tile.targetSymbol ?? tile.title.replace(/\s*\([^)]*\)\s*$/, ""), 16);
  const coreSubtitle =
    simulationTime > 0
      ? `t=${simulationTime.toFixed(2)}s`
      : tile.archetype === "fmu"
        ? "FMU 3.0"
        : tile.languageId.toUpperCase();

  if (anchors.length === 0) {
    graph.addNode({
      id: "in_stage",
      x: 16,
      y: 62,
      width: 78,
      height: 46,
      markup: createVrSchematicBlockMarkup(78, 46, "#0284c7", "Input", undefined, [{ x: 78, y: 23, color: "#0284c7" }]),
      ports: { items: [{ id: "out", args: { x: 78, y: 23 } }] },
    });
    graph.addNode({
      id: "core_stage",
      x: 126,
      y: 48,
      width: 112,
      height: 74,
      markup: createVrSchematicBlockMarkup(112, 74, accentColor, coreTitle, coreSubtitle, [
        { x: 0, y: 37, color: "#0284c7" },
        { x: 112, y: 37, color: "#059669" },
      ]),
      ports: {
        items: [
          { id: "in", args: { x: 0, y: 37 } },
          { id: "out", args: { x: 112, y: 37 } },
        ],
      },
    });
    graph.addNode({
      id: "out_stage",
      x: 270,
      y: 62,
      width: 78,
      height: 46,
      markup: createVrSchematicBlockMarkup(78, 46, "#059669", "Output", undefined, [{ x: 0, y: 23, color: "#059669" }]),
      ports: { items: [{ id: "in", args: { x: 0, y: 23 } }] },
    });
    graph.addEdge({
      id: "vr_e_in",
      source: { cell: "in_stage", port: "out" },
      target: { cell: "core_stage", port: "in" },
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: "#0284c7", strokeWidth: 2 } },
    });
    graph.addEdge({
      id: "vr_e_out",
      source: { cell: "core_stage", port: "out" },
      target: { cell: "out_stage", port: "in" },
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: "#059669", strokeWidth: 2 } },
    });
    return;
  }

  const inputs: TileAnchorSpec[] = [];
  const outputs: TileAnchorSpec[] = [];
  const params: TileAnchorSpec[] = [];
  for (const anchor of anchors) {
    if (anchor.kind === "fmi-input" || anchor.side === "left") {
      inputs.push(anchor);
    } else if (anchor.kind === "fmi-output" || anchor.side === "right") {
      outputs.push(anchor);
    } else {
      params.push(anchor);
    }
  }

  const sideSlots = Math.max(1, inputs.length, outputs.length);
  const coreX = 122;
  const coreY = 18;
  const coreW = 114;
  const coreH = Math.max(76, sideSlots * 38 + 16);
  const corePorts: UnifiedPortItem[] = [];
  const corePortMarkers: { x: number; y: number; color: string }[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const py = ((i + 1) / (inputs.length + 1)) * coreH;
    corePorts.push({ id: `in_${i}`, args: { x: 0, y: py } });
    corePortMarkers.push({ x: 0, y: py, color: "#0284c7" });
  }
  for (let i = 0; i < outputs.length; i++) {
    const py = ((i + 1) / (outputs.length + 1)) * coreH;
    corePorts.push({ id: `out_${i}`, args: { x: coreW, y: py } });
    corePortMarkers.push({ x: coreW, y: py, color: "#059669" });
  }
  for (let i = 0; i < params.length; i++) {
    const px = ((i + 1) / (params.length + 1)) * coreW;
    corePorts.push({ id: `param_${i}`, args: { x: px, y: coreH } });
    corePortMarkers.push({ x: px, y: coreH, color: "#d97706" });
  }

  graph.addNode({
    id: "core",
    x: coreX,
    y: coreY,
    width: coreW,
    height: coreH,
    markup: createVrSchematicBlockMarkup(coreW, coreH, accentColor, coreTitle, coreSubtitle, corePortMarkers),
    ports: { items: corePorts },
  });

  const sideNodeW = 86;
  const sideNodeH = 34;

  for (let i = 0; i < inputs.length; i++) {
    const a = inputs[i];
    if (!a) continue;
    const targetY = coreY + ((i + 1) / (inputs.length + 1)) * coreH;
    const ny = Math.max(8, targetY - sideNodeH / 2);
    const nodeId = `vr_in_${i}`;
    graph.addNode({
      id: nodeId,
      x: 6,
      y: ny,
      width: sideNodeW,
      height: sideNodeH,
      markup: createVrSchematicBlockMarkup(
        sideNodeW,
        sideNodeH,
        "#0284c7",
        truncateVrLabel(a.label, 12),
        a.currentValue ? truncateVrLabel(a.currentValue, 12) : a.unit,
        [{ x: sideNodeW, y: sideNodeH / 2, color: "#0284c7" }],
      ),
      ports: { items: [{ id: "out", args: { x: sideNodeW, y: sideNodeH / 2 } }] },
    });
    graph.addEdge({
      id: `vr_edge_in_${i}`,
      source: { cell: nodeId, port: "out" },
      target: { cell: "core", port: `in_${i}` },
      connector: { name: "rounded", args: { radius: 5 } },
      attrs: { line: { stroke: "#0284c7", strokeWidth: 2 } },
    });
  }

  for (let i = 0; i < outputs.length; i++) {
    const a = outputs[i];
    if (!a) continue;
    const srcY = coreY + ((i + 1) / (outputs.length + 1)) * coreH;
    const ny = Math.max(8, srcY - sideNodeH / 2);
    const nx = coreX + coreW + 30;
    const nodeId = `vr_out_${i}`;
    graph.addNode({
      id: nodeId,
      x: nx,
      y: ny,
      width: sideNodeW,
      height: sideNodeH,
      markup: createVrSchematicBlockMarkup(
        sideNodeW,
        sideNodeH,
        "#059669",
        truncateVrLabel(a.label, 12),
        a.currentValue ? truncateVrLabel(a.currentValue, 12) : a.unit,
        [{ x: 0, y: sideNodeH / 2, color: "#059669" }],
      ),
      ports: { items: [{ id: "in", args: { x: 0, y: sideNodeH / 2 } }] },
    });
    graph.addEdge({
      id: `vr_edge_out_${i}`,
      source: { cell: "core", port: `out_${i}` },
      target: { cell: nodeId, port: "in" },
      connector: { name: "rounded", args: { radius: 5 } },
      attrs: { line: { stroke: "#059669", strokeWidth: 2 } },
    });
  }

  const paramW = 104;
  const paramH = 30;
  const paramRowY = coreY + coreH + 24;
  const totalParamsWidth = params.length * paramW + Math.max(0, params.length - 1) * 14;
  const paramStartX = coreX + coreW / 2 - totalParamsWidth / 2;

  for (let i = 0; i < params.length; i++) {
    const a = params[i];
    if (!a) continue;
    const px = paramStartX + i * (paramW + 14);
    const nodeId = `vr_param_${i}`;
    graph.addNode({
      id: nodeId,
      x: px,
      y: paramRowY,
      width: paramW,
      height: paramH,
      markup: createVrSchematicBlockMarkup(
        paramW,
        paramH,
        "#d97706",
        truncateVrLabel(a.label, 14),
        a.currentValue ? truncateVrLabel(a.currentValue, 14) : a.unit,
        [{ x: paramW / 2, y: 0, color: "#d97706" }],
      ),
      ports: { items: [{ id: "top", args: { x: paramW / 2, y: 0 } }] },
    });
    graph.addEdge({
      id: `vr_edge_param_${i}`,
      source: { cell: nodeId, port: "top" },
      target: { cell: "core", port: `param_${i}` },
      connector: { name: "rounded", args: { radius: 4 } },
      attrs: { line: { stroke: "#d97706", strokeWidth: 1.8 } },
    });
  }
}

function paintHeaderPillButton(
  ctx: CanvasRenderingContext2D,
  rect: PodiumUiRect,
  label: string,
  hovered: boolean,
  primary = false,
): void {
  ctx.save();
  ctx.fillStyle = primary ? (hovered ? "#0369a1" : "#0284c7") : hovered ? "#e0f2fe" : "#f1f5f9";
  ctx.strokeStyle = primary ? "#0369a1" : hovered ? "#0284c7" : "#cbd5e1";
  ctx.lineWidth = 1.5;
  traceRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = primary ? "#ffffff" : hovered ? "#0369a1" : "#0f172a";
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.width * 0.5, rect.y + rect.height * 0.5 + 0.5);
  ctx.restore();
}

function paintTileMaximizeButton(ctx: CanvasRenderingContext2D, rect: PodiumUiRect, hovered: boolean): void {
  ctx.save();
  ctx.fillStyle = hovered ? "#0284c7" : "#e0f2fe";
  ctx.strokeStyle = hovered ? "#0369a1" : "#38bdf8";
  ctx.lineWidth = 1.8;
  traceRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 7);
  ctx.fill();
  ctx.stroke();

  // Crisp 4-corner expand arrows icon (⤢) — guaranteed crisp across all fonts & headless canvases
  const cx = rect.x + rect.width * 0.5;
  const cy = rect.y + rect.height * 0.5;
  const d = 7.5;
  const head = 4.6;
  ctx.strokeStyle = hovered ? "#ffffff" : "#0369a1";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  // Top-right arrow
  ctx.moveTo(cx + 1.5, cy - 1.5);
  ctx.lineTo(cx + d, cy - d);
  ctx.moveTo(cx + d - head, cy - d);
  ctx.lineTo(cx + d, cy - d);
  ctx.lineTo(cx + d, cy - d + head);
  // Bottom-left arrow
  ctx.moveTo(cx - 1.5, cy + 1.5);
  ctx.lineTo(cx - d, cy + d);
  ctx.moveTo(cx - d + head, cy + d);
  ctx.lineTo(cx - d, cy + d);
  ctx.lineTo(cx - d, cy + d - head);
  ctx.stroke();
  ctx.restore();
}

function paintSimClockPill(
  ctx: CanvasRenderingContext2D,
  width: number,
  headerH: number,
  simulationTime: number,
): number {
  const safeTime = Number.isFinite(simulationTime) ? simulationTime : 0;
  const timeText = `t = ${safeTime.toFixed(2)}s`;
  const pillW = 152;
  const pillH = 28;
  const pillX = width - pillW - 16;
  const pillY = (headerH - pillH) / 2;

  ctx.fillStyle = "#e0f2fe";
  ctx.strokeStyle = "#0284c7";
  ctx.lineWidth = 1.5;
  traceRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = safeTime > 0 ? "#059669" : "#0284c7";
  ctx.beginPath();
  ctx.arc(pillX + 14, headerH / 2, 3.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0369a1";
  ctx.font = "700 13px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(timeText, pillX + pillW - 14, headerH / 2);
  return pillX;
}

function paintBoardHeaderStrip(
  ctx: CanvasRenderingContext2D,
  width: number,
  docTitle: string,
  tileCount: number,
  wireCount: number,
  simulationTime: number,
  isPanned: boolean,
  hoveredHeaderBtn: BoardPaintOptions["hoveredHeaderBtn"],
): void {
  const headerH = PODIUM_HEADER_HEIGHT;
  const displayTitle = truncateVrLabel(docTitle || "Engineering Canvas", 58);

  ctx.save();
  // Luminous pure-white studio top header bar
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, headerH);

  // Crisp studio blue left accent bar and clean bottom border
  ctx.fillStyle = "#0284c7";
  ctx.fillRect(0, 0, 5, headerH);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, headerH - 1.5, width, 1.5);

  // Status indicator dot + bold dark document title
  ctx.fillStyle = "#0284c7";
  ctx.beginPath();
  ctx.arc(22, headerH / 2, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(displayTitle, 36, headerH / 2);

  // Clock badge on far right
  const pillX = paintSimClockPill(ctx, width, headerH, simulationTime);

  // Optional Reset Pan button when user has panned the board background
  let metaRightX = pillX - 18;
  if (isPanned) {
    paintHeaderPillButton(ctx, PODIUM_RESET_PAN_BTN_RECT, "↺ Center Board", hoveredHeaderBtn === "reset-pan", false);
    metaRightX = PODIUM_RESET_PAN_BTN_RECT.x - 16;
  }

  // Crisp slate metadata + quick hint
  const metaText = `${tileCount} tiles · ${wireCount} wires · Drag tiles or click ⤢ to zoom`;
  ctx.fillStyle = "#64748b";
  ctx.font = "600 12px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(metaText, metaRightX, headerH / 2);

  ctx.restore();
}

function paintFocusedBlockHeaderStrip(
  ctx: CanvasRenderingContext2D,
  width: number,
  tile: CanvasTile,
  tileIndex: number,
  tileCount: number,
  simulationTime: number,
  hoveredHeaderBtn: BoardPaintOptions["hoveredHeaderBtn"],
): void {
  const headerH = PODIUM_HEADER_HEIGHT;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = "#0284c7";
  ctx.fillRect(0, 0, 5, headerH);
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(0, headerH - 1.5, width, 1.5);

  // Primary "← All Blocks" exit button
  paintHeaderPillButton(ctx, PODIUM_BACK_BTN_RECT, "← All Blocks", hoveredHeaderBtn === "back", true);

  // Archetype badge + focused tile title
  const badgeText = tile.archetype.toUpperCase();
  const badgeX = PODIUM_BACK_BTN_RECT.x + PODIUM_BACK_BTN_RECT.width + 16;
  const badgeW = Math.max(74, badgeText.length * 9 + 18);
  ctx.fillStyle = "#e0f2fe";
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 1.25;
  traceRoundedRect(ctx, badgeX, 12, badgeW, 24, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0369a1";
  ctx.font = "700 11px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, badgeX + badgeW * 0.5, headerH * 0.5 + 0.5);

  const titleX = badgeX + badgeW + 14;
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 17px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(truncateVrLabel(tile.title, 48), titleX, headerH * 0.5);

  // Counter + Prev/Next full-screen block stepper buttons
  if (tileCount > 1) {
    ctx.fillStyle = "#64748b";
    ctx.font = "600 12px monospace";
    ctx.textAlign = "right";
    ctx.fillText(
      `Block ${tileIndex + 1}/${tileCount} · Esc / Double-click to exit`,
      PODIUM_PREV_TILE_BTN_RECT.x - 14,
      headerH * 0.5,
    );
    paintHeaderPillButton(ctx, PODIUM_PREV_TILE_BTN_RECT, "◀", hoveredHeaderBtn === "prev", false);
    paintHeaderPillButton(ctx, PODIUM_NEXT_TILE_BTN_RECT, "▶", hoveredHeaderBtn === "next", false);
  }

  paintSimClockPill(ctx, width, headerH, simulationTime);
  ctx.restore();
}

function paintActiveHeroPlinthOverlay(ctx: CanvasRenderingContext2D, b: WorldBounds): void {
  ctx.save();

  // Crisp glowing sky-blue outer hero ring legible on light studio cards
  ctx.shadowColor = "rgba(2, 132, 199, 0.45)";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = "#0284c7";
  ctx.lineWidth = 4;
  traceRoundedRect(ctx, b.x - 3, b.y - 3, b.width + 6, b.height + 6, 12);
  ctx.stroke();

  // Secondary crisp inner highlight border
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.72)";
  ctx.lineWidth = 1.5;
  traceRoundedRect(ctx, b.x + 1, b.y + 1, b.width - 2, b.height - 2, 9);
  ctx.stroke();

  // High-contrast "ACTIVE ON PLINTH" pill badge in top-right corner of the tile
  const badgeText = "ACTIVE ON PLINTH";
  const pillH = 24;
  const pillW = Math.min(Math.max(142, b.width - 20), 168);
  const pillX = Math.max(b.x + 8, b.x + b.width - pillW - 10);
  const pillY = b.y + 10;

  ctx.fillStyle = "#0284c7";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  traceRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.stroke();

  // Crisp luminous status dot inside pill
  ctx.fillStyle = "#e0f2fe";
  ctx.beginPath();
  ctx.arc(pillX + 12, pillY + pillH / 2, 3.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, pillX + 21, pillY + pillH / 2 + 0.5);

  ctx.restore();
}

function paintTileVisualBody(
  ctx: CanvasRenderingContext2D,
  ctxLike: Canvas2DContextLike,
  tile: CanvasTile,
  b: WorldBounds,
  simulationTime: number,
  capturedImages: ReadonlyMap<string, CanvasImageSource> | undefined,
  isFullscreen: boolean,
): void {
  if (tile.archetype === "analytics") {
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.09)";
    ctx.shadowBlur = isFullscreen ? 22 : 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#ffffff";
    traceRoundedRect(ctx, b.x, b.y, b.width, b.height, isFullscreen ? 12 : 8);
    ctx.fill();
    ctx.restore();

    const realSeries = extractVrSimulationSeries(tile.viewState?.["simulationSeries"]);
    const xs = Array.from({ length: 60 }, (_, i) => i * 0.18);
    const ys = xs.map((t) => 340 + 18 * Math.sin(t * 0.9 + 0.4));
    paintCanvasPlot(
      ctxLike,
      {
        id: tile.id,
        title: tile.title,
        kind: "timeseries",
        series: realSeries.length > 0 ? realSeries : [{ id: "T", label: "T_max", color: "#0284c7", x: xs, y: ys }],
        thresholds:
          realSeries.length > 0 ? undefined : [{ label: "360 K", axis: "y", value: 360, direction: "above-fail" }],
        crosshairX: simulationTime,
        dark: false,
      },
      b.x,
      b.y,
      b.width,
      b.height,
    );
    return;
  }

  if (tile.archetype === "table") {
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.09)";
    ctx.shadowBlur = isFullscreen ? 22 : 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#ffffff";
    traceRoundedRect(ctx, b.x, b.y, b.width, b.height, isFullscreen ? 12 : 8);
    ctx.fill();
    ctx.restore();

    paintCanvasTable(
      ctxLike,
      {
        title: tile.title,
        columns: [
          { key: "id", label: "ID", widthRatio: 0.35 },
          { key: "val", label: "Status", widthRatio: 0.65, align: "right" },
        ],
        rows: (tile.pinnedAnchors ?? []).map((a) => ({
          id: a.path,
          cells: { id: a.path, val: a.currentValue ?? a.label },
          status: (a.currentValue ?? "").toUpperCase().includes("FAIL") ? "fail" : "pass",
        })),
        dark: false,
      },
      b.x,
      b.y,
      b.width,
      b.height,
    );
    return;
  }

  if (tile.archetype === "schematic" || tile.archetype === "fmu") {
    const accent = tile.archetype === "fmu" ? "#059669" : "#0284c7";
    const headerH = isFullscreen ? 0 : 56;
    const pad = isFullscreen ? 14 : 10;
    const innerX = b.x + pad;
    const innerY = b.y + headerH + (isFullscreen ? pad : 6);
    const innerW = Math.max(80, b.width - pad * 2);
    const innerH = Math.max(60, b.height - headerH - pad * (isFullscreen ? 2 : 1) - (isFullscreen ? 0 : 6));

    if (!isFullscreen) {
      paintStudioTileCard(ctx, b, accent, tile.title, tile.artifactUri, headerH);
    } else {
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1.5;
      traceRoundedRect(ctx, b.x, b.y, b.width, b.height, 12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const capturedImg = capturedImages?.get(tile.id);
    const imgSize = capturedImg ? getCanvasImageSourceSize(capturedImg) : null;

    if (capturedImg && imgSize && imgSize.width > 0 && imgSize.height > 0 && typeof ctx.drawImage === "function") {
      ctx.save();
      ctx.translate(innerX, innerY);
      ctx.fillStyle = "#ffffff";
      traceRoundedRect(ctx, 0, 0, innerW, innerH, 6);
      ctx.fill();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (typeof ctx.clip === "function") {
        ctx.beginPath();
        ctx.rect(1, 1, Math.max(1, innerW - 2), Math.max(1, innerH - 2));
        ctx.clip();
      }

      const imgPad = isFullscreen ? 16 : 8;
      const availW = Math.max(16, innerW - imgPad * 2);
      const availH = Math.max(16, innerH - imgPad * 2);
      const fitScale = Math.min(availW / imgSize.width, availH / imgSize.height);
      const drawW = imgSize.width * fitScale;
      const drawH = imgSize.height * fitScale;
      const drawX = (innerW - drawW) * 0.5;
      const drawY = (innerH - drawH) * 0.5;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(capturedImg, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else {
      const graph = new UnifiedGraph({
        width: innerW,
        height: innerH,
        renderMode: "canvas2d",
        background: { color: "#ffffff" },
      });
      populateVrSchematicGraph(graph, tile, accent, simulationTime);
      graph.zoomToFit({ padding: isFullscreen ? 28 : 12, maxScale: isFullscreen ? 2.6 : 1.35 });

      ctx.save();
      ctx.translate(innerX, innerY);
      ctx.fillStyle = "#ffffff";
      traceRoundedRect(ctx, 0, 0, innerW, innerH, 6);
      ctx.fill();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (typeof ctx.clip === "function") {
        ctx.beginPath();
        ctx.rect(1, 1, Math.max(1, innerW - 2), Math.max(1, innerH - 2));
        ctx.clip();
      }
      graph.paintToCanvas2D(ctxLike, { dark: false });
      ctx.restore();
      graph.dispose();
    }
    return;
  }

  // Other archetypes: ecad, cad3d, code, generic
  const accent =
    tile.archetype === "cad3d"
      ? "#0284c7"
      : tile.archetype === "ecad"
        ? "#d97706"
        : tile.archetype === "code"
          ? "#7c3aed"
          : "#0284c7";
  const headerH = isFullscreen ? 0 : 58;
  if (!isFullscreen) {
    paintStudioTileCard(ctx, b, accent, tile.title, tile.artifactUri, headerH);
  } else {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.5;
    traceRoundedRect(ctx, b.x, b.y, b.width, b.height, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  const pad = isFullscreen ? 18 : 12;
  const innerX = b.x + pad;
  const innerY = b.y + headerH + (isFullscreen ? pad : 8);
  const innerW = Math.max(60, b.width - pad * 2);
  const innerH = Math.max(50, b.height - headerH - pad * (isFullscreen ? 2 : 1) - (isFullscreen ? 0 : 8));

  if (tile.archetype === "ecad") {
    ctx.save();
    ctx.fillStyle = "#f0fdf4";
    ctx.strokeStyle = "#bbf7d0";
    ctx.lineWidth = 1.25;
    traceRoundedRect(ctx, innerX, innerY, innerW, innerH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = isFullscreen ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(innerX + 24, innerY + innerH * 0.34);
    ctx.lineTo(innerX + innerW * 0.32, innerY + innerH * 0.34);
    ctx.lineTo(innerX + innerW * 0.4, innerY + innerH * 0.48);
    ctx.lineTo(innerX + innerW - 30, innerY + innerH * 0.48);
    ctx.stroke();

    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = isFullscreen ? 4 : 2.5;
    ctx.beginPath();
    ctx.moveTo(innerX + 24, innerY + innerH * 0.68);
    ctx.lineTo(innerX + innerW * 0.28, innerY + innerH * 0.68);
    ctx.lineTo(innerX + innerW * 0.38, innerY + innerH * 0.8);
    ctx.lineTo(innerX + innerW - 36, innerY + innerH * 0.8);
    ctx.stroke();

    const icW = Math.min(isFullscreen ? 280 : 120, innerW * 0.32);
    const icH = Math.min(isFullscreen ? 220 : 96, innerH * 0.48);
    const icX = innerX + (innerW - icW) * 0.5;
    const icY = innerY + (innerH - icH) * 0.5;
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = "#d97706";
    ctx.lineWidth = 2.5;
    ctx.fillRect(icX, icY, icW, icH);
    ctx.strokeRect(icX, icY, icW, icH);
    ctx.restore();
  } else if (tile.archetype === "cad3d") {
    ctx.save();
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1.25;
    traceRoundedRect(ctx, innerX, innerY, innerW, innerH, 6);
    ctx.fill();
    ctx.stroke();

    const cx = innerX + innerW * 0.5;
    const cy = innerY + innerH * 0.47;
    const r = Math.min(innerW, innerH) * (isFullscreen ? 0.3 : 0.28);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerX + 16, cy);
    ctx.lineTo(innerX + innerW - 16, cy);
    ctx.moveTo(cx, innerY + 14);
    ctx.lineTo(cx, innerY + innerH - 36);
    ctx.stroke();

    const dx = r * 0.86;
    const dy = r * 0.48;
    ctx.fillStyle = "rgba(2, 132, 199, 0.1)";
    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = isFullscreen ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - dx, cy + dy);
    ctx.lineTo(cx - dx, cy - dy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx, cy - dy);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    ctx.fillStyle = "#334155";
    ctx.font = isFullscreen ? "700 18px monospace" : "600 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      isFullscreen
        ? `3D ASSEMBLY · ${tile.artifactUri || tile.title} · LINKED TO CENTRAL PLINTH`
        : "3D ASSEMBLY · LINKED TO PLINTH",
      cx,
      innerY + innerH - (isFullscreen ? 26 : 16),
    );
    ctx.restore();
  } else {
    // Code / source text / notes card
    const rawCode =
      typeof tile.viewState?.["sourceCode"] === "string"
        ? (tile.viewState["sourceCode"] as string)
        : typeof tile.viewState?.["code"] === "string"
          ? (tile.viewState["code"] as string)
          : (tile.pinnedAnchors ?? []).map((a) => `${a.label}: ${a.currentValue ?? a.path}`).join("\n");
    const lines = rawCode ? rawCode.split(/\r?\n/) : [`// ${tile.artifactUri || tile.title}`];

    ctx.save();
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1.25;
    traceRoundedRect(ctx, innerX, innerY, innerW, innerH, 6);
    ctx.fill();
    ctx.stroke();
    if (typeof ctx.clip === "function") {
      ctx.beginPath();
      ctx.rect(innerX + 2, innerY + 2, Math.max(1, innerW - 4), Math.max(1, innerH - 4));
      ctx.clip();
    }

    const lineH = isFullscreen ? 24 : 16;
    const fontSize = isFullscreen ? 15 : 11;
    const maxLines = Math.max(1, Math.floor((innerH - 16) / lineH));
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      const yPos = innerY + 10 + i * lineH;
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(String(i + 1).padStart(3, " "), innerX + 10, yPos);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(truncateVrLabel(lines[i] ?? "", isFullscreen ? 120 : 54), innerX + (isFullscreen ? 56 : 40), yPos);
    }
    ctx.restore();
  }
}

/**
 * Paints the entire `.mscanvas` board (bright studio header bar, architectural drafting grid,
 * wires, live captured browser SVG diagrams or UnifiedGraph schematics, light-mode Canvas2D
 * plots & ReqIF tables, ECAD/CAD/code previews, active plinth badge, `[⤢]` full-screen zoom
 * button per tile, or a single zoomed full-screen block) onto a persistent offscreen
 * HTMLCanvasElement so it projects crisply as a zero-allocation `THREE.CanvasTexture`.
 */
export function paintBoardToTextureCanvas(
  canvas: HTMLCanvasElement,
  doc: CanvasDocument,
  simulationTime: number,
  dragPreview: DragPreviewState | null | undefined = null,
  hoverTargetTileId: string | null | undefined = null,
  activeHeroTileId: string | null | undefined = null,
  capturedImages?: ReadonlyMap<string, CanvasImageSource> | undefined,
  options?: BoardPaintOptions | undefined,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Respect Retina DPR scaling applied via ctx.setTransform(scale, 0, 0, scale, 0, 0)
  // so logical 1600×1000 UV coordinates remain 100% identical across 1× and Retina backing canvases.
  const transform = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const scaleX = transform && Number.isFinite(transform.a) && transform.a > 0 ? transform.a : 1;
  const scaleY = transform && Number.isFinite(transform.d) && transform.d > 0 ? transform.d : 1;
  const w = canvas.width > 0 ? canvas.width / scaleX : ROTUNDA_BOARD_CANVAS_WIDTH;
  const h = canvas.height > 0 ? canvas.height / scaleY : ROTUNDA_BOARD_CANVAS_HEIGHT;

  const panX = options?.boardPan?.x ?? 0;
  const panY = options?.boardPan?.y ?? 0;
  const focusedTileId = options?.focusedTileId ?? null;
  const hoveredMaximizeTileId = options?.hoveredMaximizeTileId ?? null;
  const hoveredHeaderBtn = options?.hoveredHeaderBtn ?? null;

  // Bright publication-grade architectural studio drafting surface
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);

  const tiles = Object.values(doc.tiles).sort((a, b) => a.zIndex - b.zIndex);
  const wires = Object.values(doc.wires);
  const ctxLike = ctx as unknown as Canvas2DContextLike;

  // ── Full-Screen Single-Block Zoom Mode ──
  const focusedTile = focusedTileId ? doc.tiles[focusedTileId] : undefined;
  if (focusedTile) {
    const focusedIndex = Math.max(
      0,
      tiles.findIndex((t) => t.id === focusedTile.id),
    );
    paintFocusedBlockHeaderStrip(ctx, w, focusedTile, focusedIndex, tiles.length, simulationTime, hoveredHeaderBtn);

    const pad = 16;
    const fullBounds: WorldBounds = {
      x: pad,
      y: PODIUM_HEADER_HEIGHT + pad,
      width: Math.max(200, w - pad * 2),
      height: Math.max(200, h - PODIUM_HEADER_HEIGHT - pad * 2),
    };
    paintTileVisualBody(ctx, ctxLike, focusedTile, fullBounds, simulationTime, capturedImages, true);
    return;
  }

  // ── Multi-Block Drafting Board Mode (with smooth pan-shifted architectural grid) ──
  const gridStep = 48;
  const gridOffX = ((panX % gridStep) + gridStep) % gridStep;
  const gridOffY = ((panY % gridStep) + gridStep) % gridStep;

  ctx.strokeStyle = "rgba(203, 213, 225, 0.42)";
  ctx.lineWidth = 1;
  for (let gx = gridOffX; gx < w; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = gridOffY; gy < h; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  ctx.fillStyle = "#cbd5e1";
  for (let gx = gridOffX; gx < w; gx += gridStep) {
    for (let gy = gridOffY; gy < h; gy += gridStep) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const maybeTitle = (doc as unknown as { title?: unknown }).title;
  const docTitle =
    typeof maybeTitle === "string" && maybeTitle.trim().length > 0
      ? maybeTitle
      : doc.name || doc.id || "Engineering Canvas";

  // Clip board content strictly below header strip so panned/dragged tiles never paint over the header
  ctx.save();
  if (typeof ctx.clip === "function") {
    ctx.beginPath();
    ctx.rect(0, PODIUM_HEADER_HEIGHT, w, Math.max(1, h - PODIUM_HEADER_HEIGHT));
    ctx.clip();
  }

  ctx.translate(ROTUNDA_BOARD_TEX_OFFSET_X + panX, ROTUNDA_BOARD_TEX_OFFSET_Y + panY);
  ctx.scale(ROTUNDA_BOARD_TEX_SCALE, ROTUNDA_BOARD_TEX_SCALE);

  // Draw wires using live effective tile bounds (so wires stretch smoothly during 3D ray drags)
  for (const wire of wires) {
    const sTile = doc.tiles[wire.source.tileId];
    const tTile = doc.tiles[wire.target.tileId];
    if (!sTile || !tTile) continue;
    const s = resolveEffectiveBounds(sTile, dragPreview);
    const t = resolveEffectiveBounds(tTile, dragPreview);
    const wireColor =
      wire.kind === "fmi-signal" ? "#059669" : wire.kind === "requirement-trace" ? "#7c3aed" : "#0284c7";
    const sx = s.x + s.width;
    const sy = s.y + s.height / 2;
    const tx = t.x;
    const ty = t.y + t.height / 2;

    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Crisp terminal port dots on wire endpoints
    ctx.fillStyle = wireColor;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Draw tiles + plinth badge + `[⤢]` full-screen zoom button
  for (const tile of tiles) {
    const b = resolveEffectiveBounds(tile, dragPreview);
    const isDragging = dragPreview?.tileId === tile.id;
    const isWireTarget = hoverTargetTileId === tile.id;
    const isHeroOnPlinth = Boolean(activeHeroTileId && activeHeroTileId === tile.id);

    paintTileVisualBody(ctx, ctxLike, tile, b, simulationTime, capturedImages, false);

    if (isHeroOnPlinth) {
      paintActiveHeroPlinthOverlay(ctx, b);
    }

    // Always draw crisp `[⤢]` full-screen zoom button in top-right of every tile header
    const maxBtnRect = getTileMaximizeButtonRect(b, isHeroOnPlinth);
    paintTileMaximizeButton(ctx, maxBtnRect, hoveredMaximizeTileId === tile.id);

    // Live drag or 3D-to-2D wire target highlight ring
    if (isDragging || isWireTarget) {
      ctx.save();
      ctx.strokeStyle = isDragging ? "#059669" : "#d97706";
      ctx.lineWidth = 4;
      ctx.setLineDash?.([10, 6]);
      traceRoundedRect(ctx, b.x - 4, b.y - 4, b.width + 8, b.height + 8, 12);
      ctx.stroke();
      ctx.setLineDash?.([]);
      ctx.restore();
    }
  }

  ctx.restore();

  // Paint luminous studio header strip on top of board content
  const isPanned = Math.hypot(panX, panY) > 2;
  paintBoardHeaderStrip(ctx, w, docTitle, tiles.length, wires.length, simulationTime, isPanned, hoveredHeaderBtn);
}
