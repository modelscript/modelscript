// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraController } from "../../core/camera.js";
import type { Scissor3DPortalManager } from "../../renderers/scissor-3d-manager.js";
import type { ScissorSnapshotBaker } from "../../renderers/snapshot-baker.js";
import type { WebGpuSchematicRenderer } from "../../renderers/webgpu-renderer.js";
import { paintCanvasPlot } from "../../widgets/canvas-plot.js";
import { paintCanvasTable, paintStickyBadge } from "../../widgets/canvas-table.js";
import { AnimationPropKind, type CompiledAnimationUpdate } from "../animation-engine.js";
import { paintGlyphToCanvas2D, type Canvas2DContextLike } from "../glyph-compiler.js";
import type { SoaSceneGraph } from "../soa-scene.js";
import type { UnifiedCell } from "./cell.js";
import { isDarkColorString } from "./geometry.js";
import type { EdgeRenderPathResult, UnifiedCanvasWidgetSpec } from "./types.js";

export interface Canvas2DPaintContext {
  width: number;
  height: number;
  bgColor: string;
  activeRenderMode: "svg" | "canvas2d";
  camera: CameraController;
  scene: SoaSceneGraph;
  cells: ReadonlyMap<string, UnifiedCell>;
  widgets: ReadonlyMap<string, UnifiedCanvasWidgetSpec>;
  portal3DManager: Scissor3DPortalManager;
  snapshotBaker: ScissorSnapshotBaker;
  webGpuRenderer: WebGpuSchematicRenderer;
  getEdges: () => UnifiedCell[];
  computeEdgeRenderPath: (edge: UnifiedCell) => EdgeRenderPathResult;
}

export function paintSceneToCanvas2D(
  ctx: Canvas2DContextLike,
  host: Canvas2DPaintContext,
  options: { dark?: boolean | undefined } = {},
): {
  drawnNodes: number;
  drawnEdges: number;
  drawnWidgets: number;
  drawnFrozenPortals: number;
} {
  const cam = host.camera.getState();
  const visibleRect = host.camera.getVisibleWorldBounds({ width: host.width, height: host.height }, 64);
  const visibleNodes = host.scene.queryVisibleNodes(visibleRect);

  ctx.save();
  ctx.translate(cam.tx, cam.ty);
  ctx.scale(cam.zoom, cam.zoom);

  const vMinX = visibleRect.x;
  const vMinY = visibleRect.y;
  const vMaxX = visibleRect.x + visibleRect.width;
  const vMaxY = visibleRect.y + visibleRect.height;

  let drawnEdges = 0;
  for (const edge of host.getEdges()) {
    const { d, sourcePt, targetPt, routePoints, stroke, strokeWidth } = host.computeEdgeRenderPath(edge);
    if (!d) continue;
    // Frustum-cull offscreen edges
    let eMinX = Math.min(sourcePt.x, targetPt.x);
    let eMaxX = Math.max(sourcePt.x, targetPt.x);
    let eMinY = Math.min(sourcePt.y, targetPt.y);
    let eMaxY = Math.max(sourcePt.y, targetPt.y);
    for (const rp of routePoints) {
      if (rp.x < eMinX) eMinX = rp.x;
      if (rp.x > eMaxX) eMaxX = rp.x;
      if (rp.y < eMinY) eMinY = rp.y;
      if (rp.y > eMaxY) eMaxY = rp.y;
    }
    if (eMaxX < vMinX || eMinX > vMaxX || eMaxY < vMinY || eMinY > vMaxY) continue;
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
    const cell = host.cells.get(summary.id);
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
  const portalRects = host.portal3DManager.computeFrameScissorRects(host.camera, {
    width: host.width,
    height: host.height,
  });
  const drawnFrozenPortals = host.snapshotBaker.paintFrozenSnapshots(
    ctx,
    portalRects
      .filter((r) => !r.renderLive)
      .map((r) => {
        const cell = host.cells.get(r.portalId);
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
  for (const w of host.widgets.values()) {
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

export function renderWidgetCanvasDom(
  widgetCanvasEl: HTMLCanvasElement | null,
  disposed: boolean,
  host: Canvas2DPaintContext,
): void {
  if (!widgetCanvasEl || disposed) return;
  if (host.widgets.size === 0 || (host.activeRenderMode === "canvas2d" && !host.webGpuRenderer.isReady())) {
    widgetCanvasEl.style.display = "none";
    return;
  }
  widgetCanvasEl.style.display = "block";
  const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
  const targetW = Math.max(1, Math.round(host.width * dpr));
  const targetH = Math.max(1, Math.round(host.height * dpr));
  if (widgetCanvasEl.width !== targetW || widgetCanvasEl.height !== targetH) {
    widgetCanvasEl.width = targetW;
    widgetCanvasEl.height = targetH;
  }
  const ctx = widgetCanvasEl.getContext("2d");
  if (!ctx) return;
  const cam = host.camera.getState();
  const isDark = isDarkColorString(host.bgColor);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, host.width, host.height);
  ctx.translate(cam.tx, cam.ty);
  ctx.scale(cam.zoom, cam.zoom);
  const ctxLike = ctx as unknown as Canvas2DContextLike;
  for (const w of host.widgets.values()) {
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

export function renderCanvas2DFrame(
  canvas2DEl: HTMLCanvasElement,
  webGpuCanvasEl: HTMLCanvasElement | null,
  widgetCanvasEl: HTMLCanvasElement | null,
  disposed: boolean,
  host: Canvas2DPaintContext,
): void {
  const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
  const targetW = Math.max(1, Math.round(host.width * dpr));
  const targetH = Math.max(1, Math.round(host.height * dpr));

  // Attempt zero-overhead WebGPU instanced submission first when enabled & ready
  if (host.webGpuRenderer.isReady() && webGpuCanvasEl) {
    if (webGpuCanvasEl.width !== targetW || webGpuCanvasEl.height !== targetH) {
      webGpuCanvasEl.width = targetW;
      webGpuCanvasEl.height = targetH;
    }
    webGpuCanvasEl.style.display = "block";
    const gpuRes = host.webGpuRenderer.renderFrame(host.scene, host.camera, {
      width: host.width,
      height: host.height,
    });
    if (gpuRes.rendered) {
      canvas2DEl.style.display = "none";
      renderWidgetCanvasDom(widgetCanvasEl, disposed, host);
      return;
    }
  }

  canvas2DEl.style.display = "block";
  if (canvas2DEl.width !== targetW || canvas2DEl.height !== targetH) {
    canvas2DEl.width = targetW;
    canvas2DEl.height = targetH;
  }
  const ctx = canvas2DEl.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, host.width, host.height);
  const isDark = isDarkColorString(host.bgColor);
  paintSceneToCanvas2D(ctx as unknown as Canvas2DContextLike, host, { dark: isDark });
  ctx.restore();
}

export function applyAnimationUpdateToCell(cell: UnifiedCell, upd: CompiledAnimationUpdate): void {
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
    const n = Math.max(0, Math.min(1, upd.normalized));
    const h = cell.height || 1;
    cell.attr(`${upd.selector}/transform`, `translate(0, ${(h * (1 - n)).toFixed(2)}) scale(1, ${n.toFixed(3)})`);
  }
}

export function createWebGpuCanvasEl(rootEl: HTMLElement | null): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !rootEl) return null;
  const gpuCanvas = document.createElement("canvas");
  gpuCanvas.className = "ms-webgpu-layer";
  gpuCanvas.style.position = "absolute";
  gpuCanvas.style.inset = "0";
  gpuCanvas.style.width = "100%";
  gpuCanvas.style.height = "100%";
  gpuCanvas.style.pointerEvents = "none";
  gpuCanvas.style.display = "none";
  rootEl.insertBefore(gpuCanvas, rootEl.firstChild);
  return gpuCanvas;
}

export function resolveDesiredRenderMode(
  preference: "auto" | "svg" | "canvas2d",
  nodeCount: number,
  highScaleThreshold: number,
): "svg" | "canvas2d" {
  if (preference === "canvas2d") return "canvas2d";
  if (preference === "svg") return "svg";
  return nodeCount > highScaleThreshold ? "canvas2d" : "svg";
}

export function applyRenderModeToDom(params: {
  desired: "svg" | "canvas2d";
  canvas2DEl: HTMLCanvasElement | null;
  webGpuCanvasEl: HTMLCanvasElement | null;
  webGpuReady: boolean;
  nodesG: SVGGElement | null;
  edgesG: SVGGElement | null;
  cells: ReadonlyMap<string, UnifiedCell>;
  scheduleCanvas2DRender: () => void;
  rebuildCellDom: (cell: UnifiedCell) => void;
}): void {
  const {
    desired,
    canvas2DEl,
    webGpuCanvasEl,
    webGpuReady,
    nodesG,
    edgesG,
    cells,
    scheduleCanvas2DRender,
    rebuildCellDom,
  } = params;
  if (canvas2DEl) canvas2DEl.style.display = desired === "canvas2d" ? "block" : "none";
  if (webGpuCanvasEl) webGpuCanvasEl.style.display = desired === "canvas2d" && webGpuReady ? "block" : "none";
  if (nodesG && edgesG) {
    if (desired === "canvas2d") {
      nodesG.innerHTML = "";
      edgesG.innerHTML = "";
      scheduleCanvas2DRender();
    } else {
      for (const c of cells.values()) rebuildCellDom(c);
    }
  }
}
