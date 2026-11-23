// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  paintCanvasPlot,
  renderPolyglotTileContent,
  TileAdapterRegistry,
  UnifiedGraph,
  type Canvas2DContextLike,
  type CanvasTile,
  type DiagramMarkupNode,
  type PlotSeriesData,
  type TileAnchorSpec,
  type TileLodTier,
  type UnifiedPortItem,
} from "@modelscript/canvas";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Scissor3DViewport } from "./SharedScissor3DHost";

const sharedRegistry = new TileAdapterRegistry();

interface DiagramDataNodeLike {
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

interface DiagramDataEdgeLike {
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

interface DiagramDataLike {
  nodes: DiagramDataNodeLike[];
  edges: DiagramDataEdgeLike[];
}

function extractVtkBuffer(raw: unknown): Uint8Array | undefined {
  if (raw instanceof Uint8Array) return raw;
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return undefined;
}

function extractDiagramData(raw: unknown): DiagramDataLike | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec["nodes"]) || rec["nodes"].length === 0) return null;
  const nodes: DiagramDataNodeLike[] = [];
  for (const item of rec["nodes"]) {
    if (item && typeof item === "object") {
      nodes.push(item as DiagramDataNodeLike);
    }
  }
  if (nodes.length === 0) return null;
  const edges: DiagramDataEdgeLike[] = [];
  if (Array.isArray(rec["edges"])) {
    for (const item of rec["edges"]) {
      if (item && typeof item === "object") {
        edges.push(item as DiagramDataEdgeLike);
      }
    }
  }
  return { nodes, edges };
}

function extractSimulationSeries(raw: unknown): PlotSeriesData[] {
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

function computeSeriesXRange(series: PlotSeriesData[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    const n = Math.min(s.x.length, s.y.length);
    for (let i = 0; i < n; i++) {
      const xv = s.x[i];
      if (xv !== undefined && Number.isFinite(xv)) {
        if (xv < lo) lo = xv;
        if (xv > hi) hi = xv;
      }
    }
  }
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
    return [lo, hi];
  }
  return [0, 10];
}

function truncateLabel(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLen - 1))}…`;
}

function createSchematicBlockMarkup(
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
      tagName: "rect",
      selector: "headerBg",
      attrs: {
        x: 1,
        y: 1,
        width: Math.max(2, width - 2),
        height: Math.min(16, Math.max(10, height * 0.34)),
        rx: 5,
        ry: 5,
        fill: strokeColor,
        opacity: 0.2,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        x: width / 2,
        y: subtitle ? height * 0.42 : height * 0.52,
        "text-anchor": "middle",
        fill: "#f8fafc",
        "font-size": 10,
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
        y: height * 0.74,
        "text-anchor": "middle",
        fill: "#94a3b8",
        "font-size": 8.5,
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
      selector: `port_dot_${i}`,
      attrs: {
        cx: p.x,
        cy: p.y,
        r: 3.4,
        fill: p.color,
        stroke: "#090f1d",
        "stroke-width": 1.2,
      },
    });
  }

  return nodes;
}

function populateSchematicGraph(
  graph: UnifiedGraph,
  tile: CanvasTile,
  accentColor: string,
  simulationTime: number,
  diagramData: DiagramDataLike | null,
): void {
  if (diagramData) {
    for (let i = 0; i < diagramData.nodes.length; i++) {
      const n = diagramData.nodes[i];
      if (!n) continue;
      const id = n.id ?? `node_${i}`;
      const width = typeof n.width === "number" && n.width > 0 ? n.width : 96;
      const height = typeof n.height === "number" && n.height > 0 ? n.height : 50;
      const x = typeof n.x === "number" ? n.x : 20 + (i % 3) * 130;
      const y = typeof n.y === "number" ? n.y : 24 + Math.floor(i / 3) * 84;
      const fallbackLabel = truncateLabel(n.label ?? n.properties?.name ?? id, 16);
      const attrs = n.attrs ?? {
        body: { fill: "#132038", stroke: accentColor, strokeWidth: 1.6, rx: 6, ry: 6 },
        label: { text: fallbackLabel, fill: "#f8fafc", fontSize: 10 },
      };
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
        attrs,
        ports: n.ports,
        data: n.data,
      });
    }

    for (let i = 0; i < diagramData.edges.length; i++) {
      const e = diagramData.edges[i];
      if (!e) continue;
      graph.addEdge({
        id: e.id ?? `edge_${i}`,
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
  const coreTitle = truncateLabel(tile.targetSymbol ?? tile.title.replace(/\s*\([^)]*\)\s*$/, ""), 16);
  const coreSubtitle =
    simulationTime > 0
      ? `t=${simulationTime.toFixed(2)}s`
      : tile.archetype === "fmu"
        ? "FMU 3.0"
        : tile.languageId.toUpperCase();

  if (anchors.length === 0) {
    const leftTitle = tile.archetype === "fmu" ? "FMU In" : tile.languageId === "simulink" ? "PID Gain" : "Source";
    const rightTitle = tile.archetype === "fmu" ? "FMU Out" : tile.languageId === "simulink" ? "Clamp" : "Monitor";

    graph.addNode({
      id: "stage_in",
      x: 16,
      y: 62,
      width: 76,
      height: 46,
      markup: createSchematicBlockMarkup(76, 46, "#38bdf8", leftTitle, undefined, [{ x: 76, y: 23, color: "#38bdf8" }]),
      ports: { items: [{ id: "out", args: { x: 76, y: 23 } }] },
    });
    graph.addNode({
      id: "stage_core",
      x: 126,
      y: 48,
      width: 108,
      height: 74,
      markup: createSchematicBlockMarkup(108, 74, accentColor, coreTitle, coreSubtitle, [
        { x: 0, y: 37, color: "#38bdf8" },
        { x: 108, y: 37, color: "#10b981" },
      ]),
      ports: {
        items: [
          { id: "in", args: { x: 0, y: 37 } },
          { id: "out", args: { x: 108, y: 37 } },
        ],
      },
    });
    graph.addNode({
      id: "stage_out",
      x: 268,
      y: 62,
      width: 76,
      height: 46,
      markup: createSchematicBlockMarkup(76, 46, "#10b981", rightTitle, undefined, [{ x: 0, y: 23, color: "#10b981" }]),
      ports: { items: [{ id: "in", args: { x: 0, y: 23 } }] },
    });
    graph.addEdge({
      id: "e_in_core",
      source: { cell: "stage_in", port: "out" },
      target: { cell: "stage_core", port: "in" },
      vertices: [
        { x: 109, y: 85 },
        { x: 109, y: 85 },
      ],
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: "#38bdf8", strokeWidth: 1.8 } },
    });
    graph.addEdge({
      id: "e_core_out",
      source: { cell: "stage_core", port: "out" },
      target: { cell: "stage_out", port: "in" },
      vertices: [
        { x: 251, y: 85 },
        { x: 251, y: 85 },
      ],
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: "#10b981", strokeWidth: 1.8 } },
    });
    return;
  }

  const inputs: TileAnchorSpec[] = [];
  const outputs: TileAnchorSpec[] = [];
  const params: TileAnchorSpec[] = [];
  for (const anchor of anchors) {
    if (anchor.kind === "fmi-input") {
      inputs.push(anchor);
    } else if (anchor.kind === "fmi-output") {
      outputs.push(anchor);
    } else if (anchor.kind === "parameter") {
      params.push(anchor);
    } else if (anchor.side === "left") {
      inputs.push(anchor);
    } else if (anchor.side === "right") {
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
    corePorts.push({ id: `in_${i}`, group: "in", args: { x: 0, y: py } });
    corePortMarkers.push({ x: 0, y: py, color: "#38bdf8" });
  }
  for (let i = 0; i < outputs.length; i++) {
    const py = ((i + 1) / (outputs.length + 1)) * coreH;
    corePorts.push({ id: `out_${i}`, group: "out", args: { x: coreW, y: py } });
    corePortMarkers.push({ x: coreW, y: py, color: "#10b981" });
  }
  for (let i = 0; i < params.length; i++) {
    const px = ((i + 1) / (params.length + 1)) * coreW;
    corePorts.push({ id: `param_${i}`, group: "param", args: { x: px, y: coreH } });
    corePortMarkers.push({ x: px, y: coreH, color: "#f59e0b" });
  }

  graph.addNode({
    id: "core",
    x: coreX,
    y: coreY,
    width: coreW,
    height: coreH,
    markup: createSchematicBlockMarkup(coreW, coreH, accentColor, coreTitle, coreSubtitle, corePortMarkers),
    ports: { items: corePorts },
  });

  const sideNodeW = 86;
  const sideNodeH = 34;

  for (let i = 0; i < inputs.length; i++) {
    const a = inputs[i];
    if (!a) continue;
    const targetY = coreY + ((i + 1) / (inputs.length + 1)) * coreH;
    const ny = Math.max(8, targetY - sideNodeH / 2 + (inputs.length > 1 ? (i - (inputs.length - 1) / 2) * 8 : 0));
    const nx = 6;
    const nodeId = `in_node_${i}`;
    graph.addNode({
      id: nodeId,
      x: nx,
      y: ny,
      width: sideNodeW,
      height: sideNodeH,
      markup: createSchematicBlockMarkup(
        sideNodeW,
        sideNodeH,
        "#38bdf8",
        truncateLabel(a.label, 12),
        a.currentValue ? truncateLabel(a.currentValue, 12) : a.unit,
        [{ x: sideNodeW, y: sideNodeH / 2, color: "#38bdf8" }],
      ),
      ports: { items: [{ id: "out", args: { x: sideNodeW, y: sideNodeH / 2 } }] },
    });
    const srcX = nx + sideNodeW;
    const srcY = ny + sideNodeH / 2;
    const midX = (srcX + coreX) / 2;
    graph.addEdge({
      id: `edge_in_${i}`,
      source: { cell: nodeId, port: "out" },
      target: { cell: "core", port: `in_${i}` },
      vertices: [
        { x: midX, y: srcY },
        { x: midX, y: targetY },
      ],
      connector: { name: "rounded", args: { radius: 5 } },
      attrs: { line: { stroke: "#38bdf8", strokeWidth: 1.8 } },
    });
  }

  for (let i = 0; i < outputs.length; i++) {
    const a = outputs[i];
    if (!a) continue;
    const srcY = coreY + ((i + 1) / (outputs.length + 1)) * coreH;
    const ny = Math.max(8, srcY - sideNodeH / 2 + (outputs.length > 1 ? (i - (outputs.length - 1) / 2) * 8 : 0));
    const nx = coreX + coreW + 30;
    const nodeId = `out_node_${i}`;
    graph.addNode({
      id: nodeId,
      x: nx,
      y: ny,
      width: sideNodeW,
      height: sideNodeH,
      markup: createSchematicBlockMarkup(
        sideNodeW,
        sideNodeH,
        "#10b981",
        truncateLabel(a.label, 12),
        a.currentValue ? truncateLabel(a.currentValue, 12) : a.unit,
        [{ x: 0, y: sideNodeH / 2, color: "#10b981" }],
      ),
      ports: { items: [{ id: "in", args: { x: 0, y: sideNodeH / 2 } }] },
    });
    const tgtY = ny + sideNodeH / 2;
    const midX = (coreX + coreW + nx) / 2;
    graph.addEdge({
      id: `edge_out_${i}`,
      source: { cell: "core", port: `out_${i}` },
      target: { cell: nodeId, port: "in" },
      vertices: [
        { x: midX, y: srcY },
        { x: midX, y: tgtY },
      ],
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
    const nodeId = `param_node_${i}`;
    graph.addNode({
      id: nodeId,
      x: px,
      y: paramRowY,
      width: paramW,
      height: paramH,
      markup: createSchematicBlockMarkup(
        paramW,
        paramH,
        "#f59e0b",
        truncateLabel(a.label, 14),
        a.currentValue ? truncateLabel(a.currentValue, 14) : a.unit,
        [{ x: paramW / 2, y: 0, color: "#f59e0b" }],
      ),
      ports: { items: [{ id: "top", args: { x: paramW / 2, y: 0 } }] },
    });
    const srcX = px + paramW / 2;
    const tgtX = coreX + ((i + 1) / (params.length + 1)) * coreW;
    const midY = (paramRowY + coreY + coreH) / 2;
    graph.addEdge({
      id: `edge_param_${i}`,
      source: { cell: nodeId, port: "top" },
      target: { cell: "core", port: `param_${i}` },
      vertices: [
        { x: srcX, y: midY },
        { x: tgtX, y: midY },
      ],
      connector: { name: "rounded", args: { radius: 4 } },
      attrs: { line: { stroke: "#f59e0b", strokeWidth: 1.5 } },
    });
  }
}

function isFetchableVtkUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith("http")) {
    return false;
  }
  const pathOnly = (trimmed.split(/[?#]/)[0] ?? "").toLowerCase();
  return pathOnly.endsWith(".vtk") || pathOnly.endsWith(".vtu");
}

/**
 * Single-WebGL-context scissor-rendered 3D CAD / FEA / CFD tile.
 * All visible 3D tiles share ONE WebGL context hosted by `<SharedScissor3DHost>`.
 * Lazily fetches binary `.vtk`/`.vtu` payloads when `tile.artifactUri` points to a
 * VTK asset and `tile.viewState.vtkBuffer` is not already populated.
 */
function LiveCad3DTile({
  tile,
  simulationTime = 0,
}: {
  tile: CanvasTile;
  simulationTime?: number | undefined;
}): React.ReactElement {
  const massVal = tile.pinnedAnchors?.find((a) => a.path === "body.mass")?.currentValue ?? "2.14 kg";
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
  const inlineVtkBuffer = extractVtkBuffer(tile.viewState?.["vtkBuffer"]);
  const fetchableVtkUri = !inlineVtkBuffer && isFetchableVtkUri(tile.artifactUri) ? tile.artifactUri.trim() : null;
  const [fetchedVtk, setFetchedVtk] = useState<{ uri: string; buffer: Uint8Array } | null>(null);

  useEffect(() => {
    if (!fetchableVtkUri || typeof fetch !== "function") return;
    const controller = new AbortController();
    void fetch(fetchableVtkUri, { signal: controller.signal })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((ab) => {
        if (!controller.signal.aborted && ab && ab.byteLength > 0) {
          setFetchedVtk({ uri: fetchableVtkUri, buffer: new Uint8Array(ab) });
        }
      })
      .catch(() => {
        // Silent fallback to procedural mesh when offline or aborted
      });
    return () => {
      controller.abort();
    };
  }, [fetchableVtkUri]);

  const vtkBuffer =
    inlineVtkBuffer ?? (fetchedVtk && fetchedVtk.uri === fetchableVtkUri ? fetchedVtk.buffer : undefined);

  return (
    <Scissor3DViewport
      kind={kind}
      artifactUri={tile.artifactUri}
      vtkBuffer={vtkBuffer}
      interactive={true}
      simulationTime={simulationTime}
      animate={simulationTime > 0}
      height={175}
      badgeLabel={`Shared-Scissor 3D (${kind.toUpperCase()}) · Mass: ${massVal}`}
    />
  );
}

/**
 * Headless `UnifiedGraph` Canvas2D schematic renderer for `schematic` and `fmu` tiles
 * at `interactive` and `focus` LOD tiers.
 */
export function LiveUnifiedSchematicTile({
  tile,
  accentColor = "#38bdf8",
  simulationTime = 0,
}: {
  tile: CanvasTile;
  accentColor?: string | undefined;
  simulationTime?: number | undefined;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const diagramData = useMemo(() => extractDiagramData(tile.viewState?.["diagramData"]), [tile.viewState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const cssW = 356;
    const cssH = 175;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const graph = new UnifiedGraph({
      width: cssW,
      height: cssH,
      renderMode: "canvas2d",
      background: { color: "#090f1d" },
    });
    populateSchematicGraph(graph, tile, accentColor, simulationTime, diagramData);
    graph.zoomToFit({ padding: 14, maxScale: 1.25 });

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#090f1d";
    ctx.fillRect(0, 0, cssW, cssH);

    // Subtle schematic grid backdrop
    ctx.strokeStyle = "rgba(148, 163, 184, 0.1)";
    ctx.lineWidth = 1;
    for (let gx = 20; gx < cssW; gx += 20) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, cssH);
      ctx.stroke();
    }
    for (let gy = 20; gy < cssH; gy += 20) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(cssW, gy);
      ctx.stroke();
    }

    graph.paintToCanvas2D(ctx as unknown as Canvas2DContextLike, { dark: true });
    ctx.restore();
    graph.dispose();
  }, [tile, accentColor, simulationTime, diagramData]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={`live-unified-schematic-${tile.id}`}
      data-schematic-source={diagramData ? "diagram-data" : "synthesized"}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        height: 175,
        display: "block",
        borderRadius: 6,
        background: "#090f1d",
      }}
    />
  );
}

interface EcadLayerVisibility {
  fCu: boolean;
  bCu: boolean;
  silk: boolean;
  edge: boolean;
}

function resolveInitialEcadLayers(viewState: Record<string, unknown> | undefined): EcadLayerVisibility {
  const raw = viewState?.["layers"];
  if (!Array.isArray(raw)) {
    return { fCu: true, bCu: true, silk: true, edge: true };
  }
  const names = new Set(raw.filter((v): v is string => typeof v === "string"));
  return {
    fCu: names.size === 0 || names.has("F.Cu"),
    bCu: names.size === 0 || names.has("B.Cu"),
    silk: names.size === 0 || names.has("F.SilkS"),
    edge: names.size === 0 || names.has("Edge.Cuts"),
  };
}

/**
 * High-DPI Canvas2D multi-layer PCB renderer for `ecad` tiles at `interactive`/`focus` LOD.
 * Paints `Edge.Cuts` substrate outline, corner mounting-hole anchors, `B.Cu` & `F.Cu` copper
 * traces, SMD footprints with gold pads, and `F.SilkS` silkscreen designators.
 */
export function LiveEcadCanvasTile({ tile }: { tile: CanvasTile }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layers, setLayers] = useState<EcadLayerVisibility>(() => resolveInitialEcadLayers(tile.viewState));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const cssW = 356;
    const cssH = 152;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Outer viewport backdrop
    ctx.fillStyle = "#06130d";
    ctx.fillRect(0, 0, cssW, cssH);

    // PCB substrate
    const bx = 14;
    const by = 8;
    const bw = cssW - 28;
    const bh = cssH - 16;
    ctx.fillStyle = "#0b2b1d";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(bx, by, bw, bh, 8);
    } else {
      ctx.rect(bx, by, bw, bh);
    }
    ctx.fill();

    if (layers.edge) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Subtle PCB fabrication grid dots
    ctx.fillStyle = "rgba(148, 163, 184, 0.14)";
    for (let gx = bx + 16; gx < bx + bw - 8; gx += 16) {
      for (let gy = by + 16; gy < by + bh - 8; gy += 16) {
        ctx.fillRect(gx, gy, 1.2, 1.2);
      }
    }

    // Corner mounting-hole anchors (gold plated annular ring + dark drill hole + crosshair)
    const mountingHoles: [number, number][] = [
      [bx + 14, by + 14],
      [bx + bw - 14, by + 14],
      [bx + 14, by + bh - 14],
      [bx + bw - 14, by + bh - 14],
    ];
    for (const [mx, my] of mountingHoles) {
      ctx.beginPath();
      ctx.arc(mx, my, 6.2, 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx, my, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = "#06130d";
      ctx.fill();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.55)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(mx - 8, my);
      ctx.lineTo(mx + 8, my);
      ctx.moveTo(mx, my - 8);
      ctx.lineTo(mx, my + 8);
      ctx.stroke();
    }

    // B.Cu bottom copper layer traces & thermal vias
    if (layers.bCu) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2.4;
      const bTraces: [number, number][][] = [
        [
          [56, 100],
          [104, 100],
          [124, 114],
          [222, 114],
          [242, 98],
          [286, 98],
        ],
        [
          [56, 116],
          [92, 116],
          [110, 128],
          [268, 128],
        ],
      ];
      for (const poly of bTraces) {
        const first = poly[0];
        if (!first) continue;
        ctx.beginPath();
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < poly.length; i++) {
          const pt = poly[i];
          if (pt) ctx.lineTo(pt[0], pt[1]);
        }
        ctx.stroke();
      }
      const bVias: [number, number][] = [
        [104, 100],
        [222, 114],
        [268, 128],
      ];
      for (const [vx, vy] of bVias) {
        ctx.beginPath();
        ctx.arc(vx, vy, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#60a5fa";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(vx, vy, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = "#06130d";
        ctx.fill();
      }
    }

    // F.Cu top copper layer high-current & signal traces
    if (layers.fCu) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      const fTraces: [number, number][][] = [
        [
          [56, 48],
          [112, 48],
          [130, 64],
          [148, 64],
        ],
        [
          [56, 66],
          [102, 66],
          [122, 78],
          [148, 78],
        ],
        [
          [214, 58],
          [244, 58],
          [258, 44],
          [272, 44],
        ],
        [
          [214, 76],
          [248, 76],
          [262, 62],
          [272, 62],
        ],
        [
          [214, 92],
          [252, 92],
          [272, 92],
        ],
      ];
      for (const poly of fTraces) {
        const first = poly[0];
        if (!first) continue;
        ctx.beginPath();
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < poly.length; i++) {
          const pt = poly[i];
          if (pt) ctx.lineTo(pt[0], pt[1]);
        }
        ctx.stroke();
      }
    }

    // SMD Component Footprint: J1 power/signal header (left)
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(36, 38, 22, 84);
    for (let p = 0; p < 5; p++) {
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(52, 43 + p * 16, 8, 7);
    }

    // SMD Component Footprint: U1 QFN Gate Driver IC (center)
    const icX = 148;
    const icY = 44;
    const icW = 66;
    const icH = 62;
    ctx.fillStyle = "#fbbf24";
    for (let p = 0; p < 5; p++) {
      // Left & right QFN gull-wing pads
      ctx.fillRect(icX - 5, icY + 8 + p * 11, 5, 5);
      ctx.fillRect(icX + icW, icY + 8 + p * 11, 5, 5);
      // Top & bottom QFN pads
      ctx.fillRect(icX + 9 + p * 11, icY - 5, 5, 5);
      ctx.fillRect(icX + 9 + p * 11, icY + icH, 5, 5);
    }
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(icX, icY, icW, icH);
    ctx.strokeStyle = layers.silk ? "#e2e8f0" : "#334155";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(icX, icY, icW, icH);
    // Pin-1 orientation dot
    ctx.beginPath();
    ctx.arc(icX + 8, icY + 8, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();

    // SMD Component Footprint: Q1-Q6 MOSFET Half-Bridge Bank (right)
    const fetX = 272;
    const fetY = 32;
    const fetW = 48;
    const fetH = 38;
    ctx.fillStyle = "#fbbf24";
    for (let p = 0; p < 3; p++) {
      ctx.fillRect(fetX - 4, fetY + 6 + p * 11, 4, 6);
      ctx.fillRect(fetX + fetW, fetY + 6 + p * 11, 4, 6);
    }
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(fetX, fetY, fetW, fetH);
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(fetX, fetY, fetW, fetH);

    // SMD Passives: R1 current-sense shunt & C1 decoupling cap
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(272, 84, 6, 16);
    ctx.fillRect(306, 84, 6, 16);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(278, 85, 28, 14);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(92, 22, 5, 10);
    ctx.fillRect(113, 22, 5, 10);
    ctx.fillStyle = "#b45309";
    ctx.fillRect(97, 23, 16, 8);

    // F.SilkS silkscreen labels & pinned net callouts
    if (layers.silk) {
      ctx.font = "600 9.5px sans-serif";
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const mainIcLabel = truncateLabel(tile.targetSymbol ?? "U1 DRV8353", 12);
      ctx.fillText(mainIcLabel, icX + icW / 2, icY + icH / 2);

      ctx.font = "600 8.5px monospace";
      ctx.fillStyle = "#fbbf24";
      ctx.fillText("Q1-Q6", fetX + fetW / 2, fetY + fetH / 2);

      ctx.fillStyle = "#e2e8f0";
      ctx.fillText("J1", 46, 30);
      ctx.fillText("C1", 105, 17);
      ctx.fillText("R1", 292, 92);

      const primaryNet = tile.pinnedAnchors?.[0]?.label ?? "VBUS_24V";
      ctx.textAlign = "left";
      ctx.fillStyle = "#fca5a5";
      ctx.font = "600 8.5px monospace";
      ctx.fillText(truncateLabel(primaryNet, 16), 66, 40);
    }

    ctx.restore();
  }, [tile, layers]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(
            [
              ["fCu", "F.Cu", "#ef4444"],
              ["bCu", "B.Cu", "#3b82f6"],
              ["silk", "F.SilkS", "#e2e8f0"],
              ["edge", "Edge.Cuts", "#f59e0b"],
            ] as const
          ).map(([key, label, color]) => (
            <button
              key={key}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
              }}
              style={{
                padding: "1px 6px",
                borderRadius: 4,
                border: `1px solid ${color}66`,
                backgroundColor: layers[key] ? `${color}33` : "#0f172a",
                color: layers[key] ? color : "#64748b",
                fontSize: 9,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>4-Layer PCB</span>
      </div>
      <canvas
        ref={canvasRef}
        data-testid={`live-ecad-canvas-${tile.id}`}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: 152,
          display: "block",
          borderRadius: 6,
          background: "#06130d",
        }}
      />
    </div>
  );
}

const CODE_KEYWORDS = new Set([
  "model",
  "end",
  "parameter",
  "constant",
  "equation",
  "algorithm",
  "Real",
  "Integer",
  "Boolean",
  "String",
  "connect",
  "der",
  "import",
  "package",
  "block",
  "connector",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "const",
  "let",
  "var",
  "struct",
  "param",
  "set",
  "minimize",
  "maximize",
  "subject",
]);

function buildDefaultCodeForTile(tile: CanvasTile): string {
  const fromViewState = tile.viewState?.["code"] ?? tile.viewState?.["sourceCode"];
  if (typeof fromViewState === "string" && fromViewState.trim().length > 0) {
    return fromViewState;
  }
  const symbol = tile.targetSymbol ?? "SystemComponent";
  const anchorLines: string[] = [];
  for (const anchor of tile.pinnedAnchors ?? []) {
    const match = /-?\d+(?:\.\d+)?/.exec(anchor.currentValue ?? "");
    const val = match ? match[0] : "1.0";
    const varName = anchor.path.split(".").pop() ?? anchor.path;
    anchorLines.push(`  parameter Real ${varName} = ${val}; // ${anchor.label}`);
  }
  if (anchorLines.length === 0) {
    anchorLines.push("  parameter Real mass = 2.14;", "  parameter Real R_th = 1.4;");
  }
  return [
    `// ${tile.artifactUri}`,
    `model ${symbol}`,
    ...anchorLines,
    "equation",
    "  // Live ModelScript / Polyglot workspace projection",
    `end ${symbol};`,
  ].join("\n");
}

function renderSyntaxHighlightedLine(line: string, lineIdx: number): React.ReactNode {
  const commentMatch = /(\/\/.*$|--.*$|#.*$)/.exec(line);
  const codePart = commentMatch ? line.slice(0, commentMatch.index) : line;
  const commentPart = commentMatch ? commentMatch[0] : "";

  const tokens: React.ReactNode[] = [];
  const tokenRe =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null = tokenRe.exec(codePart);
  let tokIdx = 0;

  while (match !== null) {
    if (match.index > lastIdx) {
      tokens.push(codePart.slice(lastIdx, match.index));
    }
    const text = match[0];
    let color: string | undefined;
    if (text.startsWith('"') || text.startsWith("'")) {
      color = "#34d399";
    } else if (/^\d/.test(text)) {
      color = "#fbbf24";
    } else if (CODE_KEYWORDS.has(text)) {
      color = "#c084fc";
    }
    tokens.push(
      color ? (
        <span key={`t_${lineIdx}_${tokIdx}`} style={{ color }}>
          {text}
        </span>
      ) : (
        <span key={`t_${lineIdx}_${tokIdx}`} style={{ color: "#e2e8f0" }}>
          {text}
        </span>
      ),
    );
    lastIdx = match.index + text.length;
    tokIdx += 1;
    match = tokenRe.exec(codePart);
  }
  if (lastIdx < codePart.length) {
    tokens.push(codePart.slice(lastIdx));
  }
  if (commentPart) {
    tokens.push(
      <span key={`c_${lineIdx}`} style={{ color: "#64748b", fontStyle: "italic" }}>
        {commentPart}
      </span>,
    );
  }
  return tokens;
}

export interface LiveCodeTileProps {
  tile: CanvasTile;
  lod: TileLodTier;
  onCodeChange?: ((tileId: string, code: string) => void) | undefined;
  onParameterEdit?: ((tileId: string, anchorPath: string, numericValue: number) => void) | undefined;
  onExitFocus?: (() => void) | undefined;
}

/**
 * Interactive polyglot `code` tile renderer.
 * - At `interactive` LOD: renders syntax-highlighted, line-numbered code preview.
 * - At `focus` LOD: switches to an editable `<textarea data-testid="live-code-editor-...">`
 *   supporting `Esc` to exit focus and emitting `onCodeChange` + live numeric parameter sync.
 */
export function LiveCodeTile({
  tile,
  lod,
  onCodeChange,
  onParameterEdit,
  onExitFocus,
}: LiveCodeTileProps): React.ReactElement {
  const defaultCode = useMemo(() => buildDefaultCodeForTile(tile), [tile]);
  const [draft, setDraft] = useState<{ tileId: string; code: string } | null>(null);
  const code = draft && draft.tileId === tile.id ? draft.code : defaultCode;

  const syncParametersFromCode = (nextCode: string): void => {
    if (!onParameterEdit || !tile.pinnedAnchors || tile.pinnedAnchors.length === 0) return;
    for (const anchor of tile.pinnedAnchors) {
      const leaf = anchor.path.split(".").pop() ?? anchor.path;
      const escapedLeaf = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedPath = anchor.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:${escapedPath}|\\b${escapedLeaf})\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`);
      const m = re.exec(nextCode);
      if (m && m[1] !== undefined) {
        const parsed = Number(m[1]);
        const prevMatch = /-?\d+(?:\.\d+)?/.exec(anchor.currentValue ?? "");
        const prevVal = prevMatch ? Number(prevMatch[0]) : Number.NaN;
        if (Number.isFinite(parsed) && parsed !== prevVal) {
          onParameterEdit(tile.id, anchor.path, parsed);
        }
      }
    }
  };

  if (lod === "focus") {
    const lineCount = code.split("\n").length;
    return (
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          height: 175,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 9,
            color: "#38bdf8",
            fontFamily: "monospace",
          }}
        >
          <span>FOCUS EDIT · {tile.languageId.toUpperCase()}</span>
          <span style={{ color: "#94a3b8" }}>{lineCount} lines · Esc to exit</span>
        </div>
        <textarea
          data-testid={`live-code-editor-${tile.id}`}
          aria-label={`Code editor for ${tile.title}`}
          spellCheck={false}
          value={code}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const nextCode = e.target.value;
            setDraft({ tileId: tile.id, code: nextCode });
            onCodeChange?.(tile.id, nextCode);
            syncParametersFromCode(nextCode);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              e.currentTarget.blur();
              onExitFocus?.();
            }
          }}
          style={{
            flex: 1,
            width: "100%",
            boxSizing: "border-box",
            padding: 8,
            background: "#090f1d",
            color: "#f8fafc",
            border: "1px solid #38bdf8",
            borderRadius: 6,
            fontFamily: "monospace",
            fontSize: 11,
            lineHeight: 1.45,
            resize: "none",
            outline: "none",
          }}
        />
      </div>
    );
  }

  const lines = code.split("\n");
  return (
    <div
      data-testid={`live-code-preview-${tile.id}`}
      style={{
        height: 175,
        background: "#090f1d",
        border: "1px solid #1e293b",
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: 1,
          padding: "6px 8px",
          fontFamily: "monospace",
          fontSize: 10.5,
          lineHeight: 1.45,
          overflow: "hidden",
        }}
      >
        {lines.slice(0, 9).map((line, idx) => (
          <div key={idx} style={{ display: "flex", gap: 8, whiteSpace: "pre" }}>
            <span style={{ color: "#475569", userSelect: "none", minWidth: 16, textAlign: "right" }}>{idx + 1}</span>
            <span>{renderSyntaxHighlightedLine(line, idx)}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: "3px 8px",
          borderTop: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "#64748b",
          fontFamily: "monospace",
        }}
      >
        <span>{tile.languageId}</span>
        <span>Double-click to focus edit</span>
      </div>
    </div>
  );
}

/**
 * Interactive ReqIF / specification table tile with scatter brush-linked row highlighting.
 * Matching requirement rows receive `data-brushed="true"` and luminous visual accents.
 */
export function LiveTableTile({
  tile,
  highlightedRowIds,
}: {
  tile: CanvasTile;
  highlightedRowIds?: string[] | undefined;
}): React.ReactElement {
  const rows = tile.pinnedAnchors ?? [];
  const highlightSet = useMemo(() => new Set(highlightedRowIds ?? []), [highlightedRowIds]);
  const brushedCount = rows.reduce((acc, r) => acc + (highlightSet.has(r.path) ? 1 : 0), 0);

  return (
    <div
      data-testid={`live-table-tile-${tile.id}`}
      data-brushed-count={String(brushedCount)}
      style={{ background: "#090f1d", borderRadius: 6, overflow: "hidden", border: "1px solid #1e293b" }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "82px 1fr 112px",
          padding: "5px 8px",
          background: "#1e293b",
          fontSize: 10,
          fontWeight: 600,
          color: "#cbd5e1",
          alignItems: "center",
        }}
      >
        <span>ID</span>
        <span>Specification</span>
        <span style={{ textAlign: "right" }}>{brushedCount > 0 ? `Brushed (${brushedCount})` : "Verification"}</span>
      </div>
      {rows.map((r) => {
        const upper = (r.currentValue ?? "").toUpperCase();
        const isPass = upper.includes("PASS");
        const isFail = upper.includes("FAIL");
        const isBrushed = highlightSet.has(r.path);
        return (
          <div
            key={r.path}
            data-testid={`live-table-row-${tile.id}-${r.path}`}
            data-row-id={r.path}
            data-brushed={isBrushed ? "true" : "false"}
            style={{
              display: "grid",
              gridTemplateColumns: "82px 1fr 112px",
              padding: "6px 8px",
              borderTop: "1px solid #1e293b",
              borderLeft: isBrushed ? "3px solid #38bdf8" : "3px solid transparent",
              backgroundColor: isBrushed ? "rgba(56, 189, 248, 0.18)" : "transparent",
              fontSize: 11,
              alignItems: "center",
              transition: "background-color 120ms ease",
            }}
          >
            <span
              style={{
                fontFamily: "monospace",
                color: isBrushed ? "#38bdf8" : "#c084fc",
                fontWeight: isBrushed ? 700 : 500,
              }}
            >
              {r.path}
            </span>
            <span style={{ color: isBrushed ? "#f8fafc" : "#e2e8f0" }}>{r.label}</span>
            <span
              style={{
                padding: "2px 6px",
                borderRadius: 999,
                textAlign: "center",
                fontSize: 10,
                fontWeight: 600,
                backgroundColor: isFail ? "#ef444433" : isPass ? "#05966933" : "#f59e0b33",
                color: isFail ? "#f87171" : isPass ? "#34d399" : "#fbbf24",
              }}
            >
              {r.currentValue ?? "PENDING"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function resolveLinkedRequirementIdsForBrush(
  tile: CanvasTile,
  xRange: [number, number],
  brushWindow: [number, number],
  meanMass: number,
  thresholds: { label: string; axis: "x" | "y"; value: number; direction: "above-fail" | "below-fail" }[] | undefined,
): string[] {
  const ids = new Set<string>();

  const configured = tile.viewState?.["linkedRequirementIds"];
  if (Array.isArray(configured)) {
    for (const item of configured) {
      if (typeof item === "string" && item.trim().length > 0) {
        ids.add(item.trim());
      }
    }
  }

  for (const th of thresholds ?? []) {
    const matches = th.label.match(/REQ-\d+/g);
    if (matches) {
      for (const id of matches) ids.add(id);
    }
  }

  for (const anchor of tile.pinnedAnchors ?? []) {
    if (anchor.kind === "requirement") {
      ids.add(anchor.path);
    }
  }

  const [minX, maxX] = xRange;
  const span = Math.max(1e-6, maxX - minX);
  const loFrac = (Math.min(brushWindow[0], brushWindow[1]) - minX) / span;
  const hiFrac = (Math.max(brushWindow[0], brushWindow[1]) - minX) / span;

  // Link REQ-014 (mass envelope) when brushing lower/mass domain or elevated mass
  if (loFrac <= 0.55 || meanMass >= 2.0) {
    ids.add("REQ-014");
  }
  // Link REQ-042 (peak thermal threshold) when brushing mid/upper transient region or thermal envelope
  if (hiFrac >= 0.25 || ids.size === 0) {
    ids.add("REQ-042");
  }

  return Array.from(ids);
}

/**
 * Modelon Impact-style interactive Canvas2D plot tile (`paintCanvasPlot`)
 * with live `tile.viewState.simulationSeries` support, synchronized simulation
 * timeline crosshair, interactive hover scrubbing, and click/drag scatter brushing
 * linked to ReqIF table tiles (`onBrushLinkedIds`).
 */
export function LiveCanvasPlotTile({
  tile,
  lod,
  simulationTime = 0,
  onTimeScrub,
  onBrushLinkedIds,
}: {
  tile: CanvasTile;
  lod: TileLodTier;
  simulationTime?: number | undefined;
  onTimeScrub?: ((t: number) => void) | undefined;
  onBrushLinkedIds?: ((ids: string[]) => void) | undefined;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushAnchorRef = useRef<number | null>(null);
  const [brushX, setBrushX] = useState<[number, number] | null>(null);

  const meanMassStr = tile.pinnedAnchors?.find((a) => a.path === "input.mass")?.currentValue ?? "2.14";
  const parsedMass = Number.parseFloat(meanMassStr);
  const meanMass = Number.isFinite(parsedMass) ? parsedMass : 2.14;

  const realSeries = useMemo(() => extractSimulationSeries(tile.viewState?.["simulationSeries"]), [tile.viewState]);
  const hasRealSeries = realSeries.length > 0;
  const xRange = useMemo(
    () => (hasRealSeries ? computeSeriesXRange(realSeries) : ([0, 10] as [number, number])),
    [hasRealSeries, realSeries],
  );

  const activeThresholds = useMemo(
    () =>
      hasRealSeries
        ? undefined
        : [{ label: "REQ-042 Max Temp (360 K)", axis: "y" as const, value: 360, direction: "above-fail" as const }],
    [hasRealSeries],
  );

  const clientXToDataX = (clientX: number, target: HTMLCanvasElement): number => {
    const rect = target.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 356;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left - 42) / Math.max(1, width - 54)));
    const [minX, maxX] = xRange;
    return Number((minX + frac * (maxX - minX)).toFixed(2));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const cssW = 356;
    const cssH = 175;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    let seriesToPlot: PlotSeriesData[];
    let title: string;

    if (realSeries.length > 0) {
      seriesToPlot = realSeries;
      title = tile.title;
    } else {
      // Deterministic high-density Monte Carlo + transient envelope bound to live mass parameter
      const n = 2000;
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1)) * 10;
        xs[i] = t;
        ys[i] = 330 + (meanMass - 1.8) * 32 + 14 * Math.sin(t * 0.9) + 4 * Math.cos(t * 2.7);
      }
      seriesToPlot = [{ id: "T_max", label: "T_max (K)", color: "#14b8a6", unit: "K", x: xs, y: ys }];
      title = `${tile.title} (m=${meanMass.toFixed(2)} kg)`;
    }

    paintCanvasPlot(
      ctx as unknown as Canvas2DContextLike,
      {
        id: tile.id,
        title,
        kind: "timeseries",
        series: seriesToPlot,
        thresholds: activeThresholds,
        crosshairX: simulationTime,
        brushX: brushX ?? undefined,
        dark: true,
        lod,
      },
      0,
      0,
      cssW,
      cssH,
    );
    ctx.restore();
  }, [tile.id, tile.title, meanMass, simulationTime, lod, realSeries, activeThresholds, brushX]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={`live-canvas-plot-${tile.id}`}
      data-plot-source={hasRealSeries ? "simulation-series" : "parametric"}
      data-series-count={String(hasRealSeries ? realSeries.length : 1)}
      data-brush-active={brushX ? "true" : "false"}
      onPointerDown={(e) => {
        e.stopPropagation();
        const xVal = clientXToDataX(e.clientX, e.currentTarget);
        const [minX, maxX] = xRange;
        const halfWin = (maxX - minX) * 0.08;
        const nextBrush: [number, number] = [
          Math.max(minX, Number((xVal - halfWin).toFixed(2))),
          Math.min(maxX, Number((xVal + halfWin).toFixed(2))),
        ];
        brushAnchorRef.current = xVal;
        setBrushX(nextBrush);
        onTimeScrub?.(xVal);
        onBrushLinkedIds?.(resolveLinkedRequirementIdsForBrush(tile, xRange, nextBrush, meanMass, activeThresholds));
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0 && brushAnchorRef.current === null) return;
        const xVal = clientXToDataX(e.clientX, e.currentTarget);
        onTimeScrub?.(xVal);
        if (brushAnchorRef.current !== null) {
          const nextBrush: [number, number] = [
            Math.min(brushAnchorRef.current, xVal),
            Math.max(brushAnchorRef.current, xVal),
          ];
          setBrushX(nextBrush);
          onBrushLinkedIds?.(resolveLinkedRequirementIdsForBrush(tile, xRange, nextBrush, meanMass, activeThresholds));
        }
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        brushAnchorRef.current = null;
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        brushAnchorRef.current = null;
        setBrushX(null);
        onBrushLinkedIds?.([]);
      }}
      style={{
        width: "100%",
        height: 175,
        display: "block",
        borderRadius: 6,
        cursor: "crosshair",
      }}
    />
  );
}

export interface LiveWebTileContext {
  simulationTime?: number | undefined;
  onTimeScrub?: ((time: number) => void) | undefined;
  highlightedRowIds?: string[] | undefined;
  onBrushLinkedIds?: ((ids: string[]) => void) | undefined;
  onCodeChange?: ((tileId: string, code: string) => void) | undefined;
  onParameterEdit?: ((tileId: string, anchorPath: string, numericValue: number) => void) | undefined;
  onExitFocus?: (() => void) | undefined;
}

export type LiveWebTileRenderOptions = LiveWebTileContext;

/**
 * High-fidelity web tile renderer combining:
 * - Single-WebGL-context shared-scissor 3D CAD / FEA / CFD viewports (`<Scissor3DViewport>`) with lazy binary VTK fetch
 * - Headless `UnifiedGraph` Canvas2D schematics for `schematic` and `fmu` tiles
 * - High-DPI Canvas2D multi-layer PCB views (`<LiveEcadCanvasTile>`) for `ecad` tiles
 * - Modelon Impact-style interactive Canvas2D plots (`paintCanvasPlot`) with scatter brush-linking
 * - Brush-linked ReqIF & specification tables (`<LiveTableTile>`)
 * - Syntax-highlighted interactive preview & editable focus editor (`<LiveCodeTile>`) for `code` tiles
 * - `@modelscript/canvas` polyglot renderers for all remaining languages & macro/thumbnail LODs
 */
// eslint-disable-next-line react-refresh/only-export-components
export function renderLiveWebTileContent(
  tile: CanvasTile,
  lod: TileLodTier,
  isWebGlLive: boolean,
  options: LiveWebTileContext = {},
): React.ReactNode {
  const descriptor = sharedRegistry.resolveDescriptor(tile.languageId, tile.artifactUri);

  if (tile.archetype === "cad3d" && (lod === "interactive" || lod === "focus") && isWebGlLive) {
    return <LiveCad3DTile tile={tile} simulationTime={options.simulationTime} />;
  }

  if ((tile.archetype === "schematic" || tile.archetype === "fmu") && (lod === "interactive" || lod === "focus")) {
    return (
      <LiveUnifiedSchematicTile
        tile={tile}
        accentColor={tile.archetype === "fmu" ? "#10b981" : descriptor.accentColor}
        simulationTime={options.simulationTime}
      />
    );
  }

  if (tile.archetype === "ecad" && (lod === "interactive" || lod === "focus")) {
    return <LiveEcadCanvasTile tile={tile} />;
  }

  if (tile.archetype === "analytics" && (lod === "interactive" || lod === "focus")) {
    return (
      <LiveCanvasPlotTile
        tile={tile}
        lod={lod}
        simulationTime={options.simulationTime}
        onTimeScrub={options.onTimeScrub}
        onBrushLinkedIds={options.onBrushLinkedIds}
      />
    );
  }

  if (tile.archetype === "table" && (lod === "interactive" || lod === "focus")) {
    return <LiveTableTile tile={tile} highlightedRowIds={options.highlightedRowIds} />;
  }

  if (tile.archetype === "code" && (lod === "interactive" || lod === "focus")) {
    return (
      <LiveCodeTile
        tile={tile}
        lod={lod}
        onCodeChange={options.onCodeChange}
        onParameterEdit={options.onParameterEdit}
        onExitFocus={options.onExitFocus}
      />
    );
  }

  return renderPolyglotTileContent({
    tile,
    lod,
    descriptor,
    isWebGlLive,
  });
}
