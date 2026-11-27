// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractCanvasDiagramData,
  extractCanvasSimulationSeries,
  paintCanvasBlueprintFrame,
  paintCanvasBoardBackground,
  paintCanvasComments,
  paintCanvasFrames,
  paintCanvasTileBody,
  paintCanvasTileCard,
  paintCanvasTitleBlock,
  paintCanvasWires,
  resolveCanvasBoardTheme,
  TileAdapterRegistry,
  traceCanvasRoundedRect,
  truncateCanvasLabel,
  type CanvasBoardPaintContext,
  type CanvasBoardTheme,
  type CanvasBoardThemeId,
  type CanvasDiagramDataLike,
  type CanvasDiagramEdgeLike,
  type CanvasDiagramNodeLike,
  type CanvasDocument,
  type CanvasTile,
  type PlotSeriesData,
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

/** Default visual theme for the VR drafting desk texture (spread architectural cyanotype blueprint). */
export const DEFAULT_VR_BOARD_THEME: CanvasBoardThemeId = "blueprint";

const sharedTileRegistry = new TileAdapterRegistry();

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
  /** Board theme (`"blueprint"` default for VR desk, plus `"light"` and `"dark"`). */
  theme?: CanvasBoardThemeId | undefined;
  /** When non-null, zooms that single tile full-screen across the entire desk surface. */
  focusedTileId?: string | null | undefined;
  /** Optional board viewport pan offset (in logical 1600×1000 UV pixels). */
  boardPan?: { x: number; y: number } | undefined;
  /** Tile ID whose top-right `[⤢]` full-screen zoom button is currently hovered. */
  hoveredMaximizeTileId?: string | null | undefined;
  /** Hovered header button ID (`"back" | "prev" | "next" | "reset-pan"`). */
  hoveredHeaderBtn?: "back" | "prev" | "next" | "reset-pan" | null | undefined;
}

export type VrDiagramNodeLike = CanvasDiagramNodeLike;
export type VrDiagramEdgeLike = CanvasDiagramEdgeLike;
export type VrDiagramDataLike = CanvasDiagramDataLike;

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

/** Extracts and validates serialized schematic diagram nodes & edges from a tile's `viewState`. */
export function extractVrDiagramData(raw: unknown): VrDiagramDataLike | null {
  return extractCanvasDiagramData(raw);
}

/** Extracts validated `PlotSeriesData` trajectories from a tile's `viewState.simulationSeries`. */
export function extractVrSimulationSeries(raw: unknown): PlotSeriesData[] {
  return extractCanvasSimulationSeries(raw, "#0284c7");
}

function toBoardPaintContext(ctx: CanvasRenderingContext2D): CanvasBoardPaintContext {
  // Single boundary adapter: DOM CanvasRenderingContext2D has invariant CanvasTextAlign/CanvasFillRule
  // while @modelscript/canvas's CanvasBoardPaintContext uses broader string/unknown signatures.
  return ctx as unknown as CanvasBoardPaintContext;
}

function getCanvasImageSourceSize(img: CanvasImageSource): { width: number; height: number } {
  if ("naturalWidth" in img && "naturalHeight" in img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { width: img.naturalWidth, height: img.naturalHeight };
  }
  if ("videoWidth" in img && "videoHeight" in img && img.videoWidth > 0 && img.videoHeight > 0) {
    return { width: img.videoWidth, height: img.videoHeight };
  }
  if ("displayWidth" in img && "displayHeight" in img && img.displayWidth > 0 && img.displayHeight > 0) {
    return { width: img.displayWidth, height: img.displayHeight };
  }
  if ("width" in img && "height" in img) {
    const w = typeof img.width === "number" && img.width > 0 ? img.width : 0;
    const h = typeof img.height === "number" && img.height > 0 ? img.height : 0;
    return { width: w, height: h };
  }
  return { width: 0, height: 0 };
}

function formatDrawingNumber(docId: string): string {
  const cleaned = (docId || "MS-BOARD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return cleaned.startsWith("MS-") ? cleaned.slice(0, 18) : `MS-${cleaned.slice(0, 15)}`;
}

function extractIsoDate(iso: string | undefined): string {
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
    return iso.slice(0, 10);
  }
  return "2026-11-24";
}

function paintCapturedImageOverride(
  rawCtx: CanvasRenderingContext2D,
  capturedImg: CanvasImageSource | undefined,
  rect: WorldBounds,
  theme: CanvasBoardTheme,
  isFullscreen: boolean,
): boolean {
  if (!capturedImg || typeof rawCtx.drawImage !== "function") return false;
  const imgSize = getCanvasImageSourceSize(capturedImg);
  if (imgSize.width <= 0 || imgSize.height <= 0) return false;

  const ctxLike = toBoardPaintContext(rawCtx);
  rawCtx.save();
  rawCtx.translate(rect.x, rect.y);
  rawCtx.fillStyle = theme.id === "light" ? "#ffffff" : theme.insetFill;
  traceCanvasRoundedRect(ctxLike, 0, 0, rect.width, rect.height, 6);
  rawCtx.fill();
  rawCtx.strokeStyle = theme.insetStroke;
  rawCtx.lineWidth = 1;
  rawCtx.stroke();

  if (typeof rawCtx.clip === "function") {
    rawCtx.beginPath();
    rawCtx.rect(1, 1, Math.max(1, rect.width - 2), Math.max(1, rect.height - 2));
    rawCtx.clip();
  }

  const imgPad = isFullscreen ? 16 : 8;
  const availW = Math.max(16, rect.width - imgPad * 2);
  const availH = Math.max(16, rect.height - imgPad * 2);
  const fitScale = Math.min(availW / imgSize.width, availH / imgSize.height);
  const drawW = imgSize.width * fitScale;
  const drawH = imgSize.height * fitScale;
  const drawX = (rect.width - drawW) * 0.5;
  const drawY = (rect.height - drawH) * 0.5;

  rawCtx.imageSmoothingEnabled = true;
  rawCtx.imageSmoothingQuality = "high";
  rawCtx.drawImage(capturedImg, drawX, drawY, drawW, drawH);
  rawCtx.restore();
  return true;
}

function paintHeaderPillButton(
  ctx: CanvasRenderingContext2D,
  rect: PodiumUiRect,
  label: string,
  hovered: boolean,
  theme: CanvasBoardTheme,
  primary = false,
): void {
  const ctxLike = toBoardPaintContext(ctx);
  ctx.save();
  ctx.fillStyle = primary ? theme.chromeAccent : hovered ? theme.chromeButtonHover : theme.chromeButtonFill;
  ctx.strokeStyle = primary || hovered ? theme.chromeAccent : theme.chromeStroke;
  ctx.lineWidth = hovered ? 1.8 : 1.4;
  traceCanvasRoundedRect(ctxLike, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = primary ? theme.chromeAccentText : theme.chromeText;
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.width * 0.5, rect.y + rect.height * 0.5 + 0.5);
  ctx.restore();
}

function paintTileMaximizeButton(
  ctx: CanvasRenderingContext2D,
  rect: PodiumUiRect,
  hovered: boolean,
  theme: CanvasBoardTheme,
): void {
  const ctxLike = toBoardPaintContext(ctx);
  ctx.save();
  ctx.fillStyle = hovered ? theme.chromeAccent : theme.chromeButtonFill;
  ctx.strokeStyle = hovered ? theme.chromeText : theme.chromeAccent;
  ctx.lineWidth = 1.6;
  traceCanvasRoundedRect(ctxLike, rect.x, rect.y, rect.width, rect.height, 7);
  ctx.fill();
  ctx.stroke();

  // Crisp 4-corner expand arrows icon (⤢) — guaranteed crisp across all fonts & headless canvases
  const cx = rect.x + rect.width * 0.5;
  const cy = rect.y + rect.height * 0.5;
  const d = 7.5;
  const head = 4.6;
  ctx.strokeStyle = hovered ? theme.chromeAccentText : theme.chromeText;
  ctx.lineWidth = 2.1;
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
  theme: CanvasBoardTheme,
): number {
  const ctxLike = toBoardPaintContext(ctx);
  const safeTime = Number.isFinite(simulationTime) ? simulationTime : 0;
  const timeText = `t = ${safeTime.toFixed(2)}s`;
  const pillW = 152;
  const pillH = 28;
  const pillX = width - pillW - 16;
  const pillY = (headerH - pillH) / 2;

  ctx.fillStyle = theme.chromeButtonFill;
  ctx.strokeStyle = theme.chromeAccent;
  ctx.lineWidth = 1.4;
  traceCanvasRoundedRect(ctxLike, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = safeTime > 0 ? "#10b981" : theme.chromeAccent;
  ctx.beginPath();
  ctx.arc(pillX + 14, headerH / 2, 3.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.chromeText;
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
  theme: CanvasBoardTheme,
): void {
  const headerH = PODIUM_HEADER_HEIGHT;
  const displayTitle = truncateCanvasLabel(docTitle || "Engineering Canvas", 54);

  ctx.save();
  ctx.fillStyle = theme.chromeFill;
  ctx.fillRect(0, 0, width, headerH);

  ctx.fillStyle = theme.chromeAccent;
  ctx.fillRect(0, 0, 5, headerH);
  ctx.fillStyle = theme.chromeStroke;
  ctx.fillRect(0, headerH - 1.5, width, 1.5);

  ctx.fillStyle = theme.chromeAccent;
  ctx.beginPath();
  ctx.arc(22, headerH / 2, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.chromeText;
  ctx.font = "700 16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(displayTitle, 36, headerH / 2);

  const pillX = paintSimClockPill(ctx, width, headerH, simulationTime, theme);

  let metaRightX = pillX - 18;
  if (isPanned) {
    paintHeaderPillButton(
      ctx,
      PODIUM_RESET_PAN_BTN_RECT,
      "↺ Center Board",
      hoveredHeaderBtn === "reset-pan",
      theme,
      false,
    );
    metaRightX = PODIUM_RESET_PAN_BTN_RECT.x - 16;
  }

  const themeTag = theme.label.toUpperCase();
  const metaText = `${themeTag} · ${tileCount} tiles · ${wireCount} wires · Drag tiles or click ⤢ to zoom`;
  ctx.fillStyle = theme.chromeMuted;
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
  theme: CanvasBoardTheme,
): void {
  const ctxLike = toBoardPaintContext(ctx);
  const headerH = PODIUM_HEADER_HEIGHT;
  ctx.save();
  ctx.fillStyle = theme.chromeFill;
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = theme.chromeAccent;
  ctx.fillRect(0, 0, 5, headerH);
  ctx.fillStyle = theme.chromeStroke;
  ctx.fillRect(0, headerH - 1.5, width, 1.5);

  paintHeaderPillButton(ctx, PODIUM_BACK_BTN_RECT, "← All Blocks", hoveredHeaderBtn === "back", theme, true);

  const badgeText = tile.archetype.toUpperCase();
  const badgeX = PODIUM_BACK_BTN_RECT.x + PODIUM_BACK_BTN_RECT.width + 16;
  const badgeW = Math.max(74, badgeText.length * 9 + 18);
  ctx.fillStyle = theme.badgeFill;
  ctx.strokeStyle = theme.chromeAccent;
  ctx.lineWidth = 1.25;
  traceCanvasRoundedRect(ctxLike, badgeX, 12, badgeW, 24, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = theme.badgeText;
  ctx.font = "700 11px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, badgeX + badgeW * 0.5, headerH * 0.5 + 0.5);

  const titleX = badgeX + badgeW + 14;
  ctx.fillStyle = theme.chromeText;
  ctx.font = "700 17px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(truncateCanvasLabel(tile.title, 48), titleX, headerH * 0.5);

  if (tileCount > 1) {
    ctx.fillStyle = theme.chromeMuted;
    ctx.font = "600 12px monospace";
    ctx.textAlign = "right";
    ctx.fillText(
      `Block ${tileIndex + 1}/${tileCount} · Esc / Double-click to exit`,
      PODIUM_PREV_TILE_BTN_RECT.x - 14,
      headerH * 0.5,
    );
    paintHeaderPillButton(ctx, PODIUM_PREV_TILE_BTN_RECT, "◀", hoveredHeaderBtn === "prev", theme, false);
    paintHeaderPillButton(ctx, PODIUM_NEXT_TILE_BTN_RECT, "▶", hoveredHeaderBtn === "next", theme, false);
  }

  paintSimClockPill(ctx, width, headerH, simulationTime, theme);
  ctx.restore();
}

function paintActiveHeroPlinthOverlay(ctx: CanvasRenderingContext2D, b: WorldBounds, theme: CanvasBoardTheme): void {
  const ctxLike = toBoardPaintContext(ctx);
  ctx.save();

  ctx.shadowColor = theme.id === "blueprint" ? "rgba(125, 211, 252, 0.55)" : "rgba(2, 132, 199, 0.45)";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = theme.chromeAccent;
  ctx.lineWidth = 4;
  traceCanvasRoundedRect(ctxLike, b.x - 3, b.y - 3, b.width + 6, b.height + 6, 12);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = theme.cardStroke;
  ctx.lineWidth = 1.4;
  traceCanvasRoundedRect(ctxLike, b.x + 1, b.y + 1, b.width - 2, b.height - 2, 9);
  ctx.stroke();

  const badgeText = "ACTIVE ON PLINTH";
  const pillH = 24;
  const pillW = Math.min(Math.max(142, b.width - 20), 168);
  const pillX = Math.max(b.x + 8, b.x + b.width - pillW - 10);
  const pillY = b.y + 10;

  ctx.fillStyle = theme.chromeAccent;
  ctx.strokeStyle = theme.id === "light" ? "#ffffff" : theme.chromeFill;
  ctx.lineWidth = 2;
  traceCanvasRoundedRect(ctxLike, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = theme.chromeAccentText;
  ctx.beginPath();
  ctx.arc(pillX + 12, pillY + pillH / 2, 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.chromeAccentText;
  ctx.font = "700 11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, pillX + 21, pillY + pillH / 2 + 0.5);

  ctx.restore();
}

/**
 * Paints the entire `.mscanvas` board onto a persistent offscreen HTMLCanvasElement using
 * `@modelscript/canvas`'s shared Canvas2D painters so the VR Drafting Desk achieves full
 * 2D infinite canvas parity across all 7 archetypes, grouping frames, routed Digital Thread
 * wires, review comment pins, pinned anchor pills, and board themes (`blueprint` / `light` / `dark`).
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
  // so logical 1600×1000 UV coordinates remain 100% identical across 1× and high-DPI canvases.
  const transform = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const scaleX = transform && Number.isFinite(transform.a) && transform.a > 0 ? transform.a : 1;
  const scaleY = transform && Number.isFinite(transform.d) && transform.d > 0 ? transform.d : 1;
  const w = canvas.width > 0 ? canvas.width / scaleX : ROTUNDA_BOARD_CANVAS_WIDTH;
  const h = canvas.height > 0 ? canvas.height / scaleY : ROTUNDA_BOARD_CANVAS_HEIGHT;

  const theme = resolveCanvasBoardTheme(options?.theme ?? DEFAULT_VR_BOARD_THEME, DEFAULT_VR_BOARD_THEME);
  const panX = options?.boardPan?.x ?? 0;
  const panY = options?.boardPan?.y ?? 0;
  const focusedTileId = options?.focusedTileId ?? null;
  const hoveredMaximizeTileId = options?.hoveredMaximizeTileId ?? null;
  const hoveredHeaderBtn = options?.hoveredHeaderBtn ?? null;

  const tiles = Object.values(doc.tiles).sort((a, b) => a.zIndex - b.zIndex);
  const wires = Object.values(doc.wires);
  const frames = Object.values(doc.frames ?? {});
  const comments = Object.values(doc.comments ?? {});
  const ctxLike = toBoardPaintContext(ctx);

  // 1. Shared board substrate (Prussian-blue fiber paper + major/minor grid in blueprint, or light/dark grid)
  paintCanvasBoardBackground(ctxLike, w, h, theme, { panX, panY, scale: 1 });

  // ── Full-Screen Single-Block Zoom Mode ──
  const focusedTile = focusedTileId ? doc.tiles[focusedTileId] : undefined;
  if (focusedTile) {
    const focusedIndex = Math.max(
      0,
      tiles.findIndex((t) => t.id === focusedTile.id),
    );
    const desc = sharedTileRegistry.resolveDescriptor(focusedTile.languageId, focusedTile.artifactUri);
    const pad = theme.borderFrame ? 34 : 18;
    const fullBounds: WorldBounds = {
      x: pad,
      y: PODIUM_HEADER_HEIGHT + pad,
      width: Math.max(200, w - pad * 2),
      height: Math.max(200, h - PODIUM_HEADER_HEIGHT - pad * 2),
    };

    ctx.save();
    ctx.fillStyle = theme.cardFill;
    ctx.strokeStyle = theme.cardStroke;
    ctx.lineWidth = 1.6;
    traceCanvasRoundedRect(ctxLike, fullBounds.x, fullBounds.y, fullBounds.width, fullBounds.height, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const innerBounds: WorldBounds = {
      x: fullBounds.x + 16,
      y: fullBounds.y + 16,
      width: Math.max(120, fullBounds.width - 32),
      height: Math.max(120, fullBounds.height - 32),
    };
    const capturedImg = capturedImages?.get(focusedTile.id);
    paintCanvasTileBody(ctxLike, focusedTile, innerBounds, theme, {
      accent: desc.accentColor,
      label: desc.label,
      lod: "focus",
      simulationTime,
      showAnchorPills: true,
      fontScale: 1.35,
      cadCaption: `3D ASSEMBLY · ${focusedTile.artifactUri || focusedTile.title} · LINKED TO CENTRAL PLINTH`,
      paintVisualOverride:
        capturedImg && (focusedTile.archetype === "schematic" || focusedTile.archetype === "fmu")
          ? (_c, rect) => paintCapturedImageOverride(ctx, capturedImg, rect, theme, true)
          : undefined,
    });

    if (theme.borderFrame) {
      paintCanvasBlueprintFrame(ctxLike, 0, PODIUM_HEADER_HEIGHT, w, h - PODIUM_HEADER_HEIGHT, theme);
    }
    paintFocusedBlockHeaderStrip(
      ctx,
      w,
      focusedTile,
      focusedIndex,
      tiles.length,
      simulationTime,
      hoveredHeaderBtn,
      theme,
    );
    return;
  }

  // ── Multi-Block Drafting Board Mode (2D Canvas Parity) ──
  const maybeTitle = "title" in doc ? doc.title : undefined;
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

  // Layer 1: Grouping frames (2D canvas parity)
  if (frames.length > 0) {
    paintCanvasFrames(ctxLike, frames, theme);
  }

  // Layer 2: Routed Digital Thread & FMI wires (anchor-projected, orthogonal/bezier, live drag bounds)
  if (wires.length > 0) {
    paintCanvasWires(ctxLike, doc, theme, {
      resolveTile: (t) =>
        dragPreview && dragPreview.tileId === t.id ? { ...t, bounds: resolveEffectiveBounds(t, dragPreview) } : t,
      showLabels: true,
      lineScale: 1.25,
    });
  }

  // Layer 3: All polyglot tiles (shared card chrome + shared archetype visual body + anchor pills)
  for (const tile of tiles) {
    const b = resolveEffectiveBounds(tile, dragPreview);
    const desc = sharedTileRegistry.resolveDescriptor(tile.languageId, tile.artifactUri);
    const isDragging = dragPreview?.tileId === tile.id;
    const isWireTarget = hoverTargetTileId === tile.id;
    const isHeroOnPlinth = Boolean(activeHeroTileId && activeHeroTileId === tile.id);

    const innerRect = paintCanvasTileCard(ctxLike, tile, b, theme, {
      accent: desc.accentColor,
      headerHeight: 50,
      titleFontPx: 14,
      badge: tile.languageId,
      subtitle: tile.artifactUri,
      selected: isDragging || isWireTarget,
      radius: 10,
      reserveRight: isHeroOnPlinth ? 216 : 46,
      padding: 10,
    });

    const capturedImg = capturedImages?.get(tile.id);
    paintCanvasTileBody(ctxLike, tile, innerRect, theme, {
      accent: desc.accentColor,
      label: desc.label,
      lod: "interactive",
      simulationTime,
      showAnchorPills: true,
      cadCaption: "3D ASSEMBLY · LINKED TO PLINTH",
      paintVisualOverride:
        capturedImg && (tile.archetype === "schematic" || tile.archetype === "fmu")
          ? (_c, rect) => paintCapturedImageOverride(ctx, capturedImg, rect, theme, false)
          : undefined,
    });

    if (isHeroOnPlinth) {
      paintActiveHeroPlinthOverlay(ctx, b, theme);
    }

    // Always draw crisp `[⤢]` full-screen zoom button in top-right of every tile header
    const maxBtnRect = getTileMaximizeButtonRect(b, isHeroOnPlinth);
    paintTileMaximizeButton(ctx, maxBtnRect, hoveredMaximizeTileId === tile.id, theme);

    // Live drag or 3D-to-2D wire target highlight ring
    if (isDragging || isWireTarget) {
      ctx.save();
      ctx.strokeStyle = isDragging ? "#10b981" : "#f59e0b";
      ctx.lineWidth = 4;
      ctx.setLineDash?.([10, 6]);
      traceCanvasRoundedRect(ctxLike, b.x - 4, b.y - 4, b.width + 8, b.height + 8, 12);
      ctx.stroke();
      ctx.setLineDash?.([]);
      ctx.restore();
    }
  }

  // Layer 4: Unresolved spatial review comment pins (2D canvas parity)
  if (comments.length > 0) {
    paintCanvasComments(ctxLike, comments, theme);
  }

  ctx.restore();

  // Layer 5: Architectural blueprint engineering border frame & corner title block
  if (theme.borderFrame) {
    paintCanvasBlueprintFrame(ctxLike, 0, PODIUM_HEADER_HEIGHT, w, h - PODIUM_HEADER_HEIGHT, theme);
  }
  if (theme.titleBlock) {
    const tbW = 336;
    const tbH = 82;
    const margin = theme.borderFrame ? 28 : 16;
    paintCanvasTitleBlock(ctxLike, w - tbW - margin, h - tbH - margin, tbW, tbH, theme, {
      title: docTitle,
      drawingNumber: formatDrawingNumber(doc.id),
      scale: `1:${(1 / ROTUNDA_BOARD_TEX_SCALE).toFixed(2)}`,
      sheet: "1/1",
      tileCount: tiles.length,
      wireCount: wires.length,
      date: extractIsoDate(doc.metadata?.updatedAt),
      revision: "REV A",
    });
  }

  // Layer 6: Themed top header strip
  const isPanned = Math.hypot(panX, panY) > 2;
  paintBoardHeaderStrip(
    ctx,
    w,
    docTitle,
    tiles.length,
    wires.length,
    simulationTime,
    isPanned,
    hoveredHeaderBtn,
    theme,
  );
}
