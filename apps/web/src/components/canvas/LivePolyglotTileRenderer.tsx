// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildCanvasAnalyticsPlotSpec,
  buildCanvasTileSourceCode,
  CANVAS_BOARD_THEMES,
  computeCanvasSeriesXRange,
  extractCanvasDiagramData,
  extractCanvasSimulationSeries,
  paintCanvasEcadPreview,
  paintCanvasPlot,
  paintCanvasSchematicPreview,
  renderPolyglotTileContent,
  resolveCanvasEcadLayers,
  resolveCanvasTileMeanMass,
  TileAdapterRegistry,
  tokenizeCanvasCodeLine,
  type Canvas2DContextLike,
  type CanvasBoardPaintContext,
  type CanvasEcadLayerVisibility,
  type CanvasTile,
  type TileLodTier,
} from "@modelscript/canvas";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Scissor3DViewport } from "./SharedScissor3DHost";

const sharedRegistry = new TileAdapterRegistry();

function extractVtkBuffer(raw: unknown): Uint8Array | undefined {
  if (raw instanceof Uint8Array) return raw;
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return undefined;
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
 * at `interactive` and `focus` LOD tiers — delegates to `@modelscript/canvas` `paintCanvasSchematicPreview`.
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
  const diagramData = useMemo(() => extractCanvasDiagramData(tile.viewState?.["diagramData"]), [tile.viewState]);

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
    paintCanvasSchematicPreview(
      ctx as unknown as CanvasBoardPaintContext,
      tile,
      0,
      0,
      cssW,
      cssH,
      CANVAS_BOARD_THEMES.dark,
      {
        accent: accentColor,
        simulationTime,
        diagramData,
        padding: 14,
        maxScale: 1.25,
      },
    );
    ctx.restore();
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

/**
 * High-DPI Canvas2D multi-layer PCB renderer for `ecad` tiles at `interactive`/`focus` LOD.
 * Delegates drawing directly to `@modelscript/canvas` `paintCanvasEcadPreview` (shared with VR desk).
 */
export function LiveEcadCanvasTile({ tile }: { tile: CanvasTile }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layers, setLayers] = useState<CanvasEcadLayerVisibility>(() => resolveCanvasEcadLayers(tile.viewState));

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
    paintCanvasEcadPreview(
      ctx as unknown as CanvasBoardPaintContext,
      tile,
      0,
      0,
      cssW,
      cssH,
      layers,
      CANVAS_BOARD_THEMES.dark.ecad,
    );
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

function renderSyntaxHighlightedLine(line: string, lineIdx: number): React.ReactNode {
  const pal = CANVAS_BOARD_THEMES.dark.code;
  const tokens = tokenizeCanvasCodeLine(line);
  return tokens.map((tok, tokIdx) => {
    if (tok.kind === "plain") {
      return <React.Fragment key={`p_${lineIdx}_${tokIdx}`}>{tok.text}</React.Fragment>;
    }
    if (tok.kind === "comment") {
      return (
        <span key={`c_${lineIdx}_${tokIdx}`} style={{ color: pal.comment, fontStyle: "italic" }}>
          {tok.text}
        </span>
      );
    }
    const color =
      tok.kind === "string"
        ? pal.string
        : tok.kind === "number"
          ? pal.number
          : tok.kind === "keyword"
            ? pal.keyword
            : pal.plain;
    return (
      <span key={`t_${lineIdx}_${tokIdx}`} style={{ color }}>
        {tok.text}
      </span>
    );
  });
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
 * - At `interactive` LOD: renders syntax-highlighted, line-numbered code preview (shared tokenizer).
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
  const defaultCode = useMemo(() => buildCanvasTileSourceCode(tile), [tile]);
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

  const meanMass = resolveCanvasTileMeanMass(tile);
  const realSeries = useMemo(
    () => extractCanvasSimulationSeries(tile.viewState?.["simulationSeries"]),
    [tile.viewState],
  );
  const hasRealSeries = realSeries.length > 0;
  const xRange = useMemo(
    () => (hasRealSeries ? computeCanvasSeriesXRange(realSeries) : ([0, 10] as [number, number])),
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

    const spec = buildCanvasAnalyticsPlotSpec(tile, {
      simulationTime,
      brushX: brushX ?? undefined,
      lod,
      dark: true,
      realSeries,
    });
    paintCanvasPlot(ctx as unknown as Canvas2DContextLike, spec, 0, 0, cssW, cssH);
    ctx.restore();
  }, [tile, simulationTime, lod, realSeries, brushX]);

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
 * - Shared `@modelscript/canvas` Canvas2D schematics (`paintCanvasSchematicPreview`) for `schematic` and `fmu` tiles
 * - Shared `@modelscript/canvas` Canvas2D multi-layer PCB views (`paintCanvasEcadPreview`) for `ecad` tiles
 * - Shared `@modelscript/canvas` plots (`buildCanvasAnalyticsPlotSpec` + `paintCanvasPlot`) with scatter brush-linking
 * - Brush-linked ReqIF & specification tables (`<LiveTableTile>`)
 * - Syntax-highlighted preview & editable focus editor (`<LiveCodeTile>`) using shared `tokenizeCanvasCodeLine`
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
