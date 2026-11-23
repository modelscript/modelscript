// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  SpatialSurfaceBridge,
  UnifiedGraph,
  paintCanvasPlot,
  paintCanvasTable,
  type Canvas2DContextLike,
  type CanvasDocument,
  type CanvasTile,
  type DiagramMarkupNode,
  type PlotSeriesData,
  type SurfacePresentationMode,
  type TileAnchorSpec,
  type UnifiedPortItem,
  type WorldBounds,
} from "@modelscript/canvas";
import { VtkRenderer } from "@modelscript/editor/workbench/cad-viewer/VtkRenderer";
import { Grid, Line, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EmbeddedPhysicsMesh } from "./SharedScissor3DHost";

const spatialXrStore = createXRStore();

const BOARD_CANVAS_WIDTH = 1600;
const BOARD_CANVAS_HEIGHT = 1000;
const BOARD_TEX_SCALE = 0.65;
const BOARD_TEX_OFFSET_X = 60;
const BOARD_TEX_OFFSET_Y = 60;

export interface SpatialVrSurfaceProps {
  document: CanvasDocument;
  mode: SurfacePresentationMode;
  simulationTime?: number | undefined;
  onExitTo2D?: (() => void) | undefined;
  onTileSelect?: ((tileId: string) => void) | undefined;
  onMoveTile?: ((tileId: string, x: number, y: number) => void) | undefined;
  onCreateSpatialWire?: ((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => void) | undefined;
}

interface DragPreviewState {
  tileId: string;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}

interface ActiveSpatialWireDrag {
  sourceTileId: string;
  sourceTitle: string;
  sourceAnchor: string;
  from3D: [number, number, number];
}

interface VrDiagramNodeLike {
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

interface VrDiagramEdgeLike {
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

interface VrDiagramDataLike {
  nodes: VrDiagramNodeLike[];
  edges: VrDiagramEdgeLike[];
}

function planeUvToBoard(u: number, v: number): { x: number; y: number } {
  return {
    x: (u - BOARD_TEX_OFFSET_X) / BOARD_TEX_SCALE,
    y: (v - BOARD_TEX_OFFSET_Y) / BOARD_TEX_SCALE,
  };
}

function boardBoundsToPlaneBounds(bounds: WorldBounds): WorldBounds {
  return {
    x: BOARD_TEX_OFFSET_X + bounds.x * BOARD_TEX_SCALE,
    y: BOARD_TEX_OFFSET_Y + bounds.y * BOARD_TEX_SCALE,
    width: bounds.width * BOARD_TEX_SCALE,
    height: bounds.height * BOARD_TEX_SCALE,
  };
}

function resolveEffectiveBounds(tile: CanvasTile, dragPreview: DragPreviewState | null): WorldBounds {
  if (dragPreview && dragPreview.tileId === tile.id) {
    return {
      ...tile.bounds,
      x: dragPreview.x,
      y: dragPreview.y,
    };
  }
  return tile.bounds;
}

function extractVtkBuffer(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array && raw.byteLength > 0) return raw;
  if (ArrayBuffer.isView(raw) && raw.byteLength > 0) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}

function isLoadableGltfUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith("http")) {
    return false;
  }
  const pathOnly = (trimmed.split(/[?#]/)[0] ?? "").toLowerCase();
  return pathOnly.endsWith(".glb") || pathOnly.endsWith(".gltf");
}

function extractVrDiagramData(raw: unknown): VrDiagramDataLike | null {
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

function extractVrSimulationSeries(raw: unknown): PlotSeriesData[] {
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

/**
 * Paints the entire `.mscanvas` board (tiles, wires, UnifiedGraph schematics,
 * Canvas2D plots & ReqIF tables) onto a persistent offscreen HTMLCanvasElement so it
 * projects crisply as a zero-allocation `THREE.CanvasTexture` inside 3D Spatial & WebXR VR.
 */
function paintBoardToTextureCanvas(
  canvas: HTMLCanvasElement,
  doc: CanvasDocument,
  simulationTime: number,
  dragPreview: DragPreviewState | null = null,
  hoverTargetTileId: string | null = null,
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

  ctx.save();
  ctx.translate(BOARD_TEX_OFFSET_X, BOARD_TEX_OFFSET_Y);
  ctx.scale(BOARD_TEX_SCALE, BOARD_TEX_SCALE);

  // Draw wires using live effective tile bounds (so wires stretch smoothly during 3D ray drags)
  for (const wire of Object.values(doc.wires)) {
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

interface PopoutErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface PopoutErrorBoundaryState {
  hasError: boolean;
}

class SpatialPopoutErrorBoundary extends React.Component<PopoutErrorBoundaryProps, PopoutErrorBoundaryState> {
  override state: PopoutErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PopoutErrorBoundaryState {
    return { hasError: true };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function SpatialGltfAssetMesh({
  url,
  simulationTime = 0,
  animate = true,
}: {
  url: string;
  simulationTime?: number | undefined;
  animate?: boolean | undefined;
}): React.ReactElement {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group | null>(null);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useFrame((_, delta) => {
    if (groupRef.current && animate) {
      groupRef.current.rotation.y += delta * 0.45;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, simulationTime * 0.12, 0]}>
      <primitive object={clonedScene} />
    </group>
  );
}

function VolumetricPopoutAsset({
  tile,
  simulationTime,
}: {
  tile: CanvasTile;
  simulationTime: number;
}): React.ReactElement {
  const kind =
    tile.languageId === "fea"
      ? "fea"
      : tile.languageId === "cfd"
        ? "cfd"
        : tile.languageId === "step"
          ? "step"
          : tile.languageId === "vtk"
            ? "vtk"
            : tile.languageId === "urdf"
              ? "urdf"
              : tile.languageId === "usd"
                ? "usd"
                : "cad";
  const vtkBuffer = extractVtkBuffer(tile.viewState?.["vtkBuffer"]);
  const gltfUri = !vtkBuffer && isLoadableGltfUri(tile.artifactUri) ? tile.artifactUri.trim() : null;
  const fallbackMesh = <EmbeddedPhysicsMesh kind={kind} simulationTime={simulationTime} animate={true} />;

  if (vtkBuffer) {
    return (
      <SpatialPopoutErrorBoundary fallback={fallbackMesh}>
        <VtkRenderer vtkBuffer={vtkBuffer} showStreamlines={kind === "cfd"} />
      </SpatialPopoutErrorBoundary>
    );
  }
  if (gltfUri) {
    return (
      <SpatialPopoutErrorBoundary key={gltfUri} fallback={fallbackMesh}>
        <Suspense fallback={fallbackMesh}>
          <SpatialGltfAssetMesh url={gltfUri} simulationTime={simulationTime} animate={true} />
        </Suspense>
      </SpatialPopoutErrorBoundary>
    );
  }
  return fallbackMesh;
}

function SpatialSceneContents({
  doc,
  bridge,
  simulationTime,
  onTileSelect,
  onMoveTile,
  onCreateSpatialWire,
  onHudStatusChange,
}: {
  doc: CanvasDocument;
  bridge: SpatialSurfaceBridge;
  simulationTime: number;
  onTileSelect?: ((tileId: string) => void) | undefined;
  onMoveTile?: ((tileId: string, x: number, y: number) => void) | undefined;
  onCreateSpatialWire?: ((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => void) | undefined;
  onHudStatusChange?: ((status: string | null) => void) | undefined;
}): React.ReactElement {
  const [reticlePos, setReticlePos] = useState<[number, number, number] | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [activeWireDrag, setActiveWireDrag] = useState<ActiveSpatialWireDrag | null>(null);
  const [hoverTargetTileId, setHoverTargetTileId] = useState<string | null>(null);

  // Zero-allocation persistent offscreen canvas & THREE.CanvasTexture created once in useEffect
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const c = document.createElement("canvas");
    c.width = BOARD_CANVAS_WIDTH;
    c.height = BOARD_CANVAS_HEIGHT;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    canvasRef.current = c;
    textureRef.current = tex;
    setTexture(tex);

    return () => {
      canvasRef.current = null;
      textureRef.current = null;
      setTexture(null);
      tex.dispose();
    };
  }, []);

  // Repaint onto the exact same canvas & upload via needsUpdate = true when inputs change
  useEffect(() => {
    const c = canvasRef.current;
    const tex = textureRef.current;
    if (!c || !tex) return;
    paintBoardToTextureCanvas(c, doc, simulationTime, dragPreview, hoverTargetTileId);
    tex.needsUpdate = true;
  }, [doc, simulationTime, dragPreview, hoverTargetTileId, texture]);

  // Publish live VR HUD status hint when dragging a tile or wiring a 3D CADPort
  useEffect(() => {
    if (!onHudStatusChange) return;
    if (activeWireDrag) {
      const targetTile = hoverTargetTileId ? doc.tiles[hoverTargetTileId] : undefined;
      onHudStatusChange(
        targetTile
          ? `Wiring 3D CADPort (${activeWireDrag.sourceTitle}) → Release to connect to "${targetTile.title}"`
          : `Wiring 3D CADPort (${activeWireDrag.sourceTitle}) → Aim & release on any 2D schematic tile`,
      );
    } else if (dragPreview) {
      const tile = doc.tiles[dragPreview.tileId];
      onHudStatusChange(
        `Dragging "${tile?.title ?? dragPreview.tileId}" → (${Math.round(dragPreview.x)}, ${Math.round(dragPreview.y)})`,
      );
    } else {
      onHudStatusChange(null);
    }
  }, [activeWireDrag, dragPreview, hoverTargetTileId, doc.tiles, onHudStatusChange]);

  // Compute volumetric 3D pop-outs for all cad3d tiles floating above their painted board card
  const popouts = useMemo(() => {
    return Object.values(doc.tiles)
      .filter((t) => t.archetype === "cad3d")
      .map((t) => {
        const effBounds = resolveEffectiveBounds(t, dragPreview);
        const planeBounds = boardBoundsToPlaneBounds(effBounds);
        const popout = bridge.computeVolumetricPopout("primary", t.id, planeBounds, 0.55);
        return { tile: t, popout };
      })
      .filter(
        (entry): entry is { tile: CanvasTile; popout: NonNullable<typeof entry.popout> } => entry.popout !== null,
      );
  }, [doc.tiles, bridge, dragPreview]);

  // Synthesize 3D-to-2D glowing wires from floating 3D CAD assemblies down to connected 2D tiles
  const spatialWires = useMemo(() => {
    const out: { id: string; points: [number, number, number][]; color: string }[] = [];
    for (const entry of popouts) {
      const p = entry.popout;
      for (const wire of Object.values(doc.wires)) {
        const otherId =
          wire.source.tileId === entry.tile.id
            ? wire.target.tileId
            : wire.target.tileId === entry.tile.id
              ? wire.source.tileId
              : null;
        if (!otherId) continue;
        const other = doc.tiles[otherId];
        if (!other) continue;
        const otherPlaneBounds = boardBoundsToPlaneBounds(resolveEffectiveBounds(other, dragPreview));
        const w3d = bridge.upsert3DTo2DWire(wire.id, p.position, "primary", {
          u: otherPlaneBounds.x + otherPlaneBounds.width / 2,
          v: otherPlaneBounds.y + otherPlaneBounds.height / 2,
        });
        if (w3d) {
          out.push({
            id: wire.id,
            points: [w3d.from3D, w3d.controlPoint3D, w3d.to3D],
            color: wire.kind === "fmi-signal" ? "#10b981" : "#38bdf8",
          });
        }
      }
    }
    return out;
  }, [popouts, doc.wires, doc.tiles, bridge, dragPreview]);

  const findTileAtBoardPoint = useCallback(
    (bx: number, by: number): CanvasTile | undefined => {
      const sorted = Object.values(doc.tiles).sort((a, b) => b.zIndex - a.zIndex);
      return sorted.find((t) => {
        const b = resolveEffectiveBounds(t, dragPreview);
        return bx >= b.x && bx <= b.x + b.width && by >= b.y && by <= b.y + b.height;
      });
    },
    [doc.tiles, dragPreview],
  );

  const handlePlanePointer = (phase: "down" | "move" | "up", e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const hit = bridge.dispatchRayPointer(
      [e.ray.origin.x, e.ray.origin.y, e.ray.origin.z],
      [e.ray.direction.x, e.ray.direction.y, e.ray.direction.z],
      phase,
    );
    if (!hit) {
      if (phase === "up") {
        setDragPreview(null);
        setActiveWireDrag(null);
        setHoverTargetTileId(null);
      }
      return;
    }

    setReticlePos(hit.worldPoint);
    const boardPt = planeUvToBoard(hit.u, hit.v);

    if (phase === "down") {
      const hitTile = findTileAtBoardPoint(boardPt.x, boardPt.y);
      if (activeWireDrag) {
        if (hitTile && hitTile.id !== activeWireDrag.sourceTileId) {
          onCreateSpatialWire?.(activeWireDrag.sourceTileId, hitTile.id, activeWireDrag.sourceAnchor);
        }
        setActiveWireDrag(null);
        setHoverTargetTileId(null);
        return;
      }
      if (hitTile) {
        onTileSelect?.(hitTile.id);
        if (!hitTile.locked) {
          setDragPreview({
            tileId: hitTile.id,
            offsetX: boardPt.x - hitTile.bounds.x,
            offsetY: boardPt.y - hitTile.bounds.y,
            x: hitTile.bounds.x,
            y: hitTile.bounds.y,
          });
        }
      }
      return;
    }

    if (phase === "move") {
      if (activeWireDrag) {
        const candidate = findTileAtBoardPoint(boardPt.x, boardPt.y);
        setHoverTargetTileId(candidate && candidate.id !== activeWireDrag.sourceTileId ? candidate.id : null);
        return;
      }
      if (dragPreview) {
        const newX = Math.round(boardPt.x - dragPreview.offsetX);
        const newY = Math.round(boardPt.y - dragPreview.offsetY);
        if (newX !== dragPreview.x || newY !== dragPreview.y) {
          setDragPreview({ ...dragPreview, x: newX, y: newY });
          onMoveTile?.(dragPreview.tileId, newX, newY);
        }
      }
      return;
    }

    if (phase === "up") {
      if (activeWireDrag) {
        const targetTile = findTileAtBoardPoint(boardPt.x, boardPt.y);
        if (targetTile && targetTile.id !== activeWireDrag.sourceTileId) {
          onCreateSpatialWire?.(activeWireDrag.sourceTileId, targetTile.id, activeWireDrag.sourceAnchor);
        }
        setActiveWireDrag(null);
        setHoverTargetTileId(null);
        return;
      }
      if (dragPreview) {
        const finalX = Math.round(boardPt.x - dragPreview.offsetX);
        const finalY = Math.round(boardPt.y - dragPreview.offsetY);
        onMoveTile?.(dragPreview.tileId, finalX, finalY);
        setDragPreview(null);
      }
    }
  };

  const liveWirePreviewPoints = useMemo<[number, number, number][] | null>(() => {
    if (!activeWireDrag || !reticlePos) return null;
    const from = activeWireDrag.from3D;
    const to = reticlePos;
    const mid: [number, number, number] = [
      (from[0] + to[0]) * 0.5,
      (from[1] + to[1]) * 0.5 + 0.1,
      (from[2] + to[2]) * 0.5 + 0.14,
    ];
    return [from, mid, to];
  }, [activeWireDrag, reticlePos]);

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 7, 5]} intensity={1.3} />
      <pointLight position={[-3, 2, 2]} intensity={0.6} color="#38bdf8" />
      <Grid position={[0, 0, -1.6]} args={[14, 14]} cellColor="#1e293b" sectionColor="#334155" />

      {/* Main Schematic & Polyglot Board Plane (Zero-Allocation Persistent CanvasTexture) */}
      <mesh
        position={[0.4, 0.8, -1.6]}
        onPointerDown={(e) => handlePlanePointer("down", e)}
        onPointerMove={(e) => handlePlanePointer("move", e)}
        onPointerUp={(e) => handlePlanePointer("up", e)}
      >
        <planeGeometry args={[3.2, 2.0]} />
        {texture ? <meshStandardMaterial map={texture} roughness={0.6} /> : <meshStandardMaterial color="#0f172a" />}
      </mesh>

      {/* Volumetric 3D CAD / FEA / CFD Pop-Outs floating in front of their schematic blocks */}
      {popouts.map(({ tile, popout }) => {
        const isWiringThis = activeWireDrag?.sourceTileId === tile.id;
        const handleOffset: [number, number, number] = [0, -0.22, 0.12];
        const handleWorldPos: [number, number, number] = [
          popout.position[0] + handleOffset[0],
          popout.position[1] + handleOffset[1],
          popout.position[2] + handleOffset[2],
        ];
        return (
          <group key={tile.id} position={popout.position}>
            <group scale={0.28}>
              <VolumetricPopoutAsset tile={tile} simulationTime={simulationTime} />
            </group>
            {/* Interactive glowing CADPort handle sphere for 3D-to-2D wiring */}
            <mesh
              position={handleOffset}
              onPointerDown={(e) => {
                e.stopPropagation();
                setDragPreview(null);
                setActiveWireDrag({
                  sourceTileId: tile.id,
                  sourceTitle: tile.title,
                  sourceAnchor: "CADPort",
                  from3D: handleWorldPos,
                });
                onTileSelect?.(tile.id);
              }}
            >
              <sphereGeometry args={[0.055, 20, 20]} />
              <meshStandardMaterial
                color={isWiringThis ? "#fbbf24" : "#38bdf8"}
                emissive={isWiringThis ? "#f59e0b" : "#0ea5e9"}
                emissiveIntensity={isWiringThis ? 1.5 : 0.9}
                roughness={0.2}
                metalness={0.3}
              />
            </mesh>
          </group>
        );
      })}

      {/* 3D-to-2D Cross-Domain Wires */}
      {spatialWires.map((w) => (
        <Line key={w.id} points={w.points} color={w.color} lineWidth={2} />
      ))}

      {/* Live 3D CADPort-to-2D Wire Drag Preview */}
      {liveWirePreviewPoints && <Line points={liveWirePreviewPoints} color="#f59e0b" lineWidth={2.5} />}

      {/* Live 3D / VR Ray Laser Reticle */}
      {reticlePos && (
        <mesh position={reticlePos}>
          <sphereGeometry args={[0.025, 16, 16]} />
          <meshBasicMaterial color={activeWireDrag ? "#f59e0b" : "#10b981"} />
        </mesh>
      )}

      <OrbitControls
        makeDefault
        enabled={!dragPreview && !activeWireDrag}
        target={[0.4, 0.8, -1.6]}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

function detectWebGlSupport(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    return gl !== null && typeof (gl as Partial<WebGLRenderingContext>).getShaderPrecisionFormat === "function";
  } catch {
    return false;
  }
}

/**
 * Headless / WebGL-unavailable Canvas2D preview surface used in JSDOM tests or
 * environments without WebGL context support. Uses the exact same board painter.
 */
function SpatialFallbackBoardCanvas({
  doc,
  simulationTime,
}: {
  doc: CanvasDocument;
  simulationTime: number;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = BOARD_CANVAS_WIDTH;
    canvas.height = BOARD_CANVAS_HEIGHT;
    paintBoardToTextureCanvas(canvas, doc, simulationTime);
  }, [doc, simulationTime]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="spatial-vr-fallback-canvas"
      style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
    />
  );
}

/**
 * Unified 3D Spatial & WebXR VR Editing Surface (`@react-three/fiber` + `@react-three/xr`).
 * Renders the exact same diagram/board with zero-allocation persistent `CanvasTexture`,
 * headless `UnifiedGraph` schematics, volumetric VTK/GLTF/procedural CAD pop-outs,
 * ray drag tile write-back, and interactive 3D CADPort-to-2D cross-domain wiring.
 */
export function SpatialVrSurface({
  document: doc,
  mode,
  simulationTime = 0,
  onExitTo2D,
  onTileSelect,
  onMoveTile,
  onCreateSpatialWire,
}: SpatialVrSurfaceProps): React.ReactElement {
  const bridge = useMemo(() => {
    const b = new SpatialSurfaceBridge({
      id: "primary",
      origin: [-1.2, 1.8, -1.6],
      right: [1, 0, 0],
      down: [0, -1, 0],
      normal: [0, 0, 1],
      unitsPerMeter: 500,
    });
    b.setMode(mode);
    return b;
  }, [mode]);

  const [webglSupported] = useState<boolean>(detectWebGlSupport);
  const [xrSupported, setXrSupported] = useState(false);
  const [hudStatus, setHudStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "xr" in navigator) {
      navigator.xr
        ?.isSessionSupported("immersive-vr")
        .then((ok) => setXrSupported(Boolean(ok)))
        .catch(() => setXrSupported(false));
    }
  }, []);

  const fallbackView = <SpatialFallbackBoardCanvas doc={doc} simulationTime={simulationTime} />;

  return (
    <div
      data-testid="spatial-vr-surface"
      data-surface-mode={mode}
      style={{ position: "relative", width: "100%", height: "100%", background: "#060b16" }}
    >
      {typeof window !== "undefined" ? (
        webglSupported ? (
          <SpatialPopoutErrorBoundary fallback={fallbackView}>
            <Canvas camera={{ position: [0.4, 1.4, 1.8], fov: 45 }} gl={{ antialias: true }}>
              <XR store={spatialXrStore}>
                <SpatialSceneContents
                  doc={doc}
                  bridge={bridge}
                  simulationTime={simulationTime}
                  onTileSelect={onTileSelect}
                  onMoveTile={onMoveTile}
                  onCreateSpatialWire={onCreateSpatialWire}
                  onHudStatusChange={setHudStatus}
                />
              </XR>
            </Canvas>
          </SpatialPopoutErrorBoundary>
        ) : (
          fallbackView
        )
      ) : (
        <div style={{ padding: 24, color: "#cbd5e1" }}>3D Spatial / WebXR VR Surface ({mode})</div>
      )}

      {/* Subtle VR HUD interaction status hint */}
      <div
        data-testid="spatial-vr-hud-status"
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          padding: "6px 12px",
          borderRadius: 8,
          border: hudStatus ? "1px solid #38bdf8" : "1px solid #1e293b",
          background: "rgba(15, 23, 42, 0.88)",
          color: hudStatus ? "#f8fafc" : "#94a3b8",
          fontSize: 11,
          pointerEvents: "none",
          zIndex: 20,
        }}
      >
        {hudStatus ?? "3D/VR Interactive Mode · Drag tiles on board · Pull glowing CADPort sphere to wire 3D → 2D"}
      </div>

      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          gap: 8,
          zIndex: 20,
        }}
      >
        {xrSupported && (
          <button
            type="button"
            onClick={() => void spatialXrStore.enterVR()}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Enter WebXR VR Headset
          </button>
        )}
        {onExitTo2D && (
          <button
            type="button"
            onClick={onExitTo2D}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#f8fafc",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Return to 2D Canvas
          </button>
        )}
      </div>
    </div>
  );
}
