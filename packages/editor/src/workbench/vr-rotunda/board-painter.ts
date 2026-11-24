// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  UnifiedGraph,
  paintCanvasPlot,
  paintCanvasTable,
  type Canvas2DContextLike,
  type CanvasDocument,
  type CanvasTile,
  type DiagramMarkupNode,
  type PlotSeriesData,
  type TileAnchorSpec,
  type UnifiedPortItem,
  type WorldBounds,
} from "@modelscript/canvas";
import { ROTUNDA_BOARD_TEX_OFFSET_X, ROTUNDA_BOARD_TEX_OFFSET_Y, ROTUNDA_BOARD_TEX_SCALE } from "./types.js";

/** Transient drag preview state for live 3D ray/controller tile dragging on the board plane. */
export interface DragPreviewState {
  tileId: string;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
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
    const color = typeof rec["color"] === "string" && rec["color"].length > 0 ? rec["color"] : "#14b8a6";
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
        fill: "#132038",
        stroke: strokeColor,
        "stroke-width": 1.6,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        x: width / 2,
        y: subtitle ? height * 0.42 : height * 0.54,
        "text-anchor": "middle",
        fill: "#f8fafc",
        "font-size": 11,
        "font-weight": "600",
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
        y: height * 0.75,
        "text-anchor": "middle",
        fill: "#94a3b8",
        "font-size": 9,
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
        r: 3.5,
        fill: p.color,
        stroke: "#090f1d",
        "stroke-width": 1.2,
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
          body: { fill: "#132038", stroke: accentColor, strokeWidth: 1.6, rx: 6, ry: 6 },
          label: { text: label, fill: "#f8fafc", fontSize: 10 },
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
        attrs: e.attrs ?? { line: { stroke: accentColor, strokeWidth: 1.8 } },
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
      markup: createVrSchematicBlockMarkup(78, 46, "#38bdf8", "Input", undefined, [{ x: 78, y: 23, color: "#38bdf8" }]),
      ports: { items: [{ id: "out", args: { x: 78, y: 23 } }] },
    });
    graph.addNode({
      id: "core_stage",
      x: 126,
      y: 48,
      width: 112,
      height: 74,
      markup: createVrSchematicBlockMarkup(112, 74, accentColor, coreTitle, coreSubtitle, [
        { x: 0, y: 37, color: "#38bdf8" },
        { x: 112, y: 37, color: "#10b981" },
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
      markup: createVrSchematicBlockMarkup(78, 46, "#10b981", "Output", undefined, [{ x: 0, y: 23, color: "#10b981" }]),
      ports: { items: [{ id: "in", args: { x: 0, y: 23 } }] },
    });
    graph.addEdge({
      id: "vr_e_in",
      source: { cell: "in_stage", port: "out" },
      target: { cell: "core_stage", port: "in" },
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: "#38bdf8", strokeWidth: 1.8 } },
    });
    graph.addEdge({
      id: "vr_e_out",
      source: { cell: "core_stage", port: "out" },
      target: { cell: "out_stage", port: "in" },
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: "#10b981", strokeWidth: 1.8 } },
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
    corePortMarkers.push({ x: 0, y: py, color: "#38bdf8" });
  }
  for (let i = 0; i < outputs.length; i++) {
    const py = ((i + 1) / (outputs.length + 1)) * coreH;
    corePorts.push({ id: `out_${i}`, args: { x: coreW, y: py } });
    corePortMarkers.push({ x: coreW, y: py, color: "#10b981" });
  }
  for (let i = 0; i < params.length; i++) {
    const px = ((i + 1) / (params.length + 1)) * coreW;
    corePorts.push({ id: `param_${i}`, args: { x: px, y: coreH } });
    corePortMarkers.push({ x: px, y: coreH, color: "#f59e0b" });
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
        "#38bdf8",
        truncateVrLabel(a.label, 12),
        a.currentValue ? truncateVrLabel(a.currentValue, 12) : a.unit,
        [{ x: sideNodeW, y: sideNodeH / 2, color: "#38bdf8" }],
      ),
      ports: { items: [{ id: "out", args: { x: sideNodeW, y: sideNodeH / 2 } }] },
    });
    graph.addEdge({
      id: `vr_edge_in_${i}`,
      source: { cell: nodeId, port: "out" },
      target: { cell: "core", port: `in_${i}` },
      connector: { name: "rounded", args: { radius: 5 } },
      attrs: { line: { stroke: "#38bdf8", strokeWidth: 1.8 } },
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
        "#10b981",
        truncateVrLabel(a.label, 12),
        a.currentValue ? truncateVrLabel(a.currentValue, 12) : a.unit,
        [{ x: 0, y: sideNodeH / 2, color: "#10b981" }],
      ),
      ports: { items: [{ id: "in", args: { x: 0, y: sideNodeH / 2 } }] },
    });
    graph.addEdge({
      id: `vr_edge_out_${i}`,
      source: { cell: "core", port: `out_${i}` },
      target: { cell: nodeId, port: "in" },
      connector: { name: "rounded", args: { radius: 5 } },
      attrs: { line: { stroke: "#10b981", strokeWidth: 1.8 } },
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
        "#f59e0b",
        truncateVrLabel(a.label, 14),
        a.currentValue ? truncateVrLabel(a.currentValue, 14) : a.unit,
        [{ x: paramW / 2, y: 0, color: "#f59e0b" }],
      ),
      ports: { items: [{ id: "top", args: { x: paramW / 2, y: 0 } }] },
    });
    graph.addEdge({
      id: `vr_edge_param_${i}`,
      source: { cell: nodeId, port: "top" },
      target: { cell: "core", port: `param_${i}` },
      connector: { name: "rounded", args: { radius: 4 } },
      attrs: { line: { stroke: "#f59e0b", strokeWidth: 1.5 } },
    });
  }
}

function paintBoardHeaderStrip(
  ctx: CanvasRenderingContext2D,
  width: number,
  docTitle: string,
  tileCount: number,
  wireCount: number,
  simulationTime: number,
): void {
  const headerH = 44;
  const safeTime = Number.isFinite(simulationTime) ? simulationTime : 0;
  const displayTitle = truncateVrLabel(docTitle || "Engineering Canvas", 68);

  ctx.save();
  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.fillRect(0, 0, width, headerH);

  // Subtle cyan left accent bar and crisp bottom hairline separator
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(0, 0, 4, headerH);
  ctx.fillStyle = "rgba(56, 189, 248, 0.28)";
  ctx.fillRect(0, headerH - 1, width, 1);

  // Status indicator dot + document title
  ctx.fillStyle = "#22d3ee";
  ctx.beginPath();
  ctx.arc(22, headerH / 2, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f1f5f9";
  ctx.font = "700 16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(displayTitle, 36, headerH / 2);

  // Telemetry clock pill on the right: t = X.XXs
  const timeText = `t = ${safeTime.toFixed(2)}s`;
  const pillW = 148;
  const pillH = 26;
  const pillX = width - pillW - 18;
  const pillY = (headerH - pillH) / 2;

  ctx.fillStyle = "rgba(8, 47, 73, 0.85)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
  ctx.lineWidth = 1.25;
  traceRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = safeTime > 0 ? "#10b981" : "#38bdf8";
  ctx.beginPath();
  ctx.arc(pillX + 14, headerH / 2, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e0f2fe";
  ctx.font = "600 13px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(timeText, pillX + pillW - 14, headerH / 2);

  // Subtle board metadata summary to the left of the simulation clock pill
  const metaText = `${tileCount} tiles · ${wireCount} wires`;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px monospace";
  ctx.textAlign = "right";
  ctx.fillText(metaText, pillX - 18, headerH / 2);

  ctx.restore();
}

function paintActiveHeroPlinthOverlay(ctx: CanvasRenderingContext2D, b: WorldBounds): void {
  ctx.save();

  // Soft glowing cyan outer frame
  ctx.shadowColor = "rgba(34, 211, 238, 0.72)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 4;
  traceRoundedRect(ctx, b.x - 3, b.y - 3, b.width + 6, b.height + 6, 8);
  ctx.stroke();

  // Crisp secondary inner cyan accent border (remains distinct even without canvas shadow support)
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(103, 232, 249, 0.65)";
  ctx.lineWidth = 1.5;
  traceRoundedRect(ctx, b.x + 1, b.y + 1, b.width - 2, b.height - 2, 5);
  ctx.stroke();

  // "ACTIVE ON PLINTH" pill badge in top-right corner of the tile
  const badgeText = "ACTIVE ON PLINTH";
  const pillH = 24;
  const pillW = Math.min(Math.max(138, b.width - 20), 166);
  const pillX = Math.max(b.x + 8, b.x + b.width - pillW - 10);
  const pillY = b.y + 8;

  ctx.fillStyle = "rgba(8, 47, 73, 0.95)";
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 1.6;
  traceRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.stroke();

  // Glowing cyan status dot inside pill
  ctx.fillStyle = "#22d3ee";
  ctx.beginPath();
  ctx.arc(pillX + 12, pillY + pillH / 2, 3.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ecfeff";
  ctx.font = "700 11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, pillX + 21, pillY + pillH / 2 + 0.5);

  ctx.restore();
}

/**
 * Paints the entire `.mscanvas` board (header bar, grid, wires, UnifiedGraph schematics,
 * Canvas2D plots & ReqIF tables, ECAD traces, active plinth badge, and drag/wire rings)
 * onto a persistent offscreen HTMLCanvasElement so it projects crisply as a zero-allocation
 * `THREE.CanvasTexture` inside 3D Spatial & WebXR VR.
 */
export function paintBoardToTextureCanvas(
  canvas: HTMLCanvasElement,
  doc: CanvasDocument,
  simulationTime: number,
  dragPreview: DragPreviewState | null | undefined = null,
  hoverTargetTileId: string | null | undefined = null,
  activeHeroTileId: string | null | undefined = null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#0b1120";
  ctx.fillRect(0, 0, w, h);

  // Subtle world grid
  ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx < w; gx += 48) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = 0; gy < h; gy += 48) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  const tiles = Object.values(doc.tiles).sort((a, b) => a.zIndex - b.zIndex);
  const wires = Object.values(doc.wires);

  const maybeTitle = (doc as unknown as { title?: unknown }).title;
  const docTitle =
    typeof maybeTitle === "string" && maybeTitle.trim().length > 0
      ? maybeTitle
      : doc.name || doc.id || "Engineering Canvas";

  // Subtle board header strip showing document title & active simulation time
  paintBoardHeaderStrip(ctx, w, docTitle, tiles.length, wires.length, simulationTime);

  ctx.save();
  ctx.translate(ROTUNDA_BOARD_TEX_OFFSET_X, ROTUNDA_BOARD_TEX_OFFSET_Y);
  ctx.scale(ROTUNDA_BOARD_TEX_SCALE, ROTUNDA_BOARD_TEX_SCALE);

  // Draw wires using live effective tile bounds (so wires stretch smoothly during 3D ray drags)
  for (const wire of wires) {
    const sTile = doc.tiles[wire.source.tileId];
    const tTile = doc.tiles[wire.target.tileId];
    if (!sTile || !tTile) continue;
    const s = resolveEffectiveBounds(sTile, dragPreview);
    const t = resolveEffectiveBounds(tTile, dragPreview);
    ctx.strokeStyle =
      wire.kind === "fmi-signal" ? "#10b981" : wire.kind === "requirement-trace" ? "#a855f7" : "#38bdf8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s.x + s.width, s.y + s.height / 2);
    ctx.lineTo(t.x, t.y + t.height / 2);
    ctx.stroke();
  }

  // Draw tiles (using UnifiedGraph, CanvasPlot & CanvasTable for zero-DOM VR fidelity!)
  const ctxLike = ctx as unknown as Canvas2DContextLike;
  for (const tile of tiles) {
    const b = resolveEffectiveBounds(tile, dragPreview);
    const isDragging = dragPreview?.tileId === tile.id;
    const isWireTarget = hoverTargetTileId === tile.id;
    const isHeroOnPlinth = Boolean(activeHeroTileId && activeHeroTileId === tile.id);

    if (tile.archetype === "analytics") {
      const realSeries = extractVrSimulationSeries(tile.viewState?.["simulationSeries"]);
      const xs = Array.from({ length: 60 }, (_, i) => i * 0.18);
      const ys = xs.map((t) => 340 + 18 * Math.sin(t * 0.9 + 0.4));
      paintCanvasPlot(
        ctxLike,
        {
          id: tile.id,
          title: tile.title,
          kind: "timeseries",
          series: realSeries.length > 0 ? realSeries : [{ id: "T", label: "T_max", color: "#14b8a6", x: xs, y: ys }],
          thresholds:
            realSeries.length > 0 ? undefined : [{ label: "360 K", axis: "y", value: 360, direction: "above-fail" }],
          crosshairX: simulationTime,
          dark: true,
        },
        b.x,
        b.y,
        b.width,
        b.height,
      );
    } else if (tile.archetype === "table") {
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
          dark: true,
        },
        b.x,
        b.y,
        b.width,
        b.height,
      );
    } else if (tile.archetype === "schematic" || tile.archetype === "fmu") {
      const accent = tile.archetype === "fmu" ? "#10b981" : "#38bdf8";
      const headerH = 54;
      const pad = 10;
      const innerW = Math.max(80, b.width - pad * 2);
      const innerH = Math.max(60, b.height - headerH - pad);

      ctx.fillStyle = "#0f172a";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.strokeRect(b.x, b.y, b.width, b.height);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 17px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(tile.title, b.x + 12, b.y + 24);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px monospace";
      ctx.fillText(tile.artifactUri, b.x + 12, b.y + 44);

      const graph = new UnifiedGraph({
        width: innerW,
        height: innerH,
        renderMode: "canvas2d",
        background: { color: "#090f1d" },
      });
      populateVrSchematicGraph(graph, tile, accent, simulationTime);
      graph.zoomToFit({ padding: 12, maxScale: 1.3 });

      ctx.save();
      ctx.translate(b.x + pad, b.y + headerH);
      ctx.fillStyle = "#090f1d";
      ctx.fillRect(0, 0, innerW, innerH);
      if (typeof ctx.clip === "function") {
        ctx.beginPath();
        ctx.rect(0, 0, innerW, innerH);
        ctx.clip();
      }
      graph.paintToCanvas2D(ctxLike, { dark: true });
      ctx.restore();
      graph.dispose();
    } else {
      ctx.fillStyle = tile.archetype === "ecad" ? "#071a12" : "#0f172a";
      ctx.strokeStyle = tile.archetype === "cad3d" ? "#ec4899" : tile.archetype === "ecad" ? "#f59e0b" : "#38bdf8";
      ctx.lineWidth = 2;
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.strokeRect(b.x, b.y, b.width, b.height);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 18px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(tile.title, b.x + 14, b.y + 30);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px monospace";
      ctx.fillText(tile.artifactUri, b.x + 14, b.y + 54);

      if (tile.archetype === "ecad") {
        // Lightweight PCB trace preview on VR board plane
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.x + 36, b.y + 130);
        ctx.lineTo(b.x + 140, b.y + 130);
        ctx.lineTo(b.x + 170, b.y + 165);
        ctx.lineTo(b.x + b.width - 50, b.y + 165);
        ctx.stroke();

        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(b.x + 36, b.y + 210);
        ctx.lineTo(b.x + 120, b.y + 210);
        ctx.lineTo(b.x + 165, b.y + 250);
        ctx.lineTo(b.x + b.width - 60, b.y + 250);
        ctx.stroke();

        ctx.fillStyle = "#1e293b";
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1.5;
        ctx.fillRect(b.x + b.width * 0.36, b.y + 120, 120, 110);
        ctx.strokeRect(b.x + b.width * 0.36, b.y + 120, 120, 110);
      }
    }

    // Active-on-plinth glowing cyan accent frame & pill badge
    if (isHeroOnPlinth) {
      paintActiveHeroPlinthOverlay(ctx, b);
    }

    // Live drag or 3D-to-2D wire target highlight ring
    if (isDragging || isWireTarget) {
      ctx.save();
      ctx.strokeStyle = isDragging ? "#10b981" : "#f59e0b";
      ctx.lineWidth = 4;
      ctx.setLineDash?.([10, 6]);
      ctx.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
      ctx.setLineDash?.([]);
      ctx.restore();
    }
  }

  ctx.restore();
}
