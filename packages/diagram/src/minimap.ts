// SPDX-License-Identifier: AGPL-3.0-or-later

import { isEphemeralDiagramNode } from "./drop-placeholder.js";
import { resolveNodePortWorldPoint, type RouterNodeLike } from "./port-router.js";

export interface MinimapGraphNode {
  id: string;
  getPosition?: (() => { x: number; y: number } | undefined) | undefined;
  getSize?: (() => { width: number; height: number } | undefined) | undefined;
  attr?: ((path: string) => unknown) | undefined;
}

export interface MinimapEndpoint {
  cell?: string | undefined;
  port?: string | undefined;
}

export interface MinimapGraphEdge {
  id: string;
  getSourcePoint?: (() => { x: number; y: number } | null | undefined) | undefined;
  getTargetPoint?: (() => { x: number; y: number } | null | undefined) | undefined;
  getVertices?: (() => { x: number; y: number }[] | undefined) | undefined;
  getSourceCell?: (() => unknown) | undefined;
  getTargetCell?: (() => unknown) | undefined;
  getSourceCellId?: (() => string | undefined) | undefined;
  getTargetCellId?: (() => string | undefined) | undefined;
  getSourcePortId?: (() => string | undefined) | undefined;
  getTargetPortId?: (() => string | undefined) | undefined;
  getSource?: (() => unknown) | undefined;
  getTarget?: (() => unknown) | undefined;
  source?: MinimapEndpoint | undefined;
  target?: MinimapEndpoint | undefined;
  attr?: ((path: string) => unknown) | undefined;
  getBBox?: (() => { x: number; y: number; width: number; height: number } | undefined) | undefined;
}

export interface MinimapGraph {
  disposed?: boolean | undefined;
  container?: HTMLElement | { clientWidth?: number; clientHeight?: number } | null | undefined;
  getNodes: () => MinimapGraphNode[];
  getEdges?: (() => MinimapGraphEdge[]) | undefined;
  scale?: (() => { sx: number; sy: number }) | undefined;
  translate?: ((tx?: number, ty?: number) => { tx: number; ty: number }) | undefined;
  centerPoint?: ((x: number, y: number) => void) | undefined;
  findViewByCell?: ((cell: never) => unknown) | undefined;
  getCellById?: ((id: string) => unknown) | undefined;
}

/**
 * Creates or retrieves the floating Minimap HUD container in the DOM.
 */
export function ensureMinimapHud(
  container: HTMLElement,
  onCenterGraph: (worldX: number, worldY: number) => void,
): HTMLElement | null {
  if (typeof document === "undefined" || !container) return null;
  let hud = container.querySelector("#modelscript-minimap-hud") as HTMLElement | null;
  if (hud) return hud;

  hud = document.createElement("div");
  hud.id = "modelscript-minimap-hud";
  hud.className = "modelscript-minimap-hud";
  hud.style.position = "absolute";
  hud.style.right = "16px";
  hud.style.bottom = "36px";
  hud.style.width = "180px";
  hud.style.height = "120px";
  hud.style.background = "var(--ms-surface-glass, rgba(22, 27, 34, 0.85))";
  hud.style.backdropFilter = "blur(12px)";
  hud.style.border = "1px solid var(--ms-border, rgba(255, 255, 255, 0.12))";
  hud.style.borderRadius = "8px";
  hud.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.35)";
  hud.style.zIndex = "990";
  hud.style.overflow = "hidden";
  hud.style.display = "flex";
  hud.style.flexDirection = "column";
  hud.style.userSelect = "none";

  // Minimap Header
  const header = document.createElement("div");
  header.className = "minimap-header";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.padding = "4px 8px";
  header.style.fontSize = "10px";
  header.style.fontWeight = "600";
  header.style.color = "var(--ms-text-2, #94a3b8)";
  header.style.borderBottom = "1px solid var(--ms-divider, rgba(255, 255, 255, 0.08))";

  const title = document.createElement("span");
  title.textContent = "Minimap (M)";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.style.background = "transparent";
  closeBtn.style.border = "none";
  closeBtn.style.color = "var(--ms-text-2, #94a3b8)";
  closeBtn.style.fontSize = "14px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.padding = "0 4px";
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    hud!.style.display = "none";
  };
  header.appendChild(closeBtn);
  hud.appendChild(header);

  // SVG Thumbnail Canvas
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "minimap-svg";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.cursor = "crosshair";

  let isDraggingMinimap = false;
  const panToMinimapCoord = (clientX: number, clientY: number) => {
    const rect = svg.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    const viewBox = svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      const worldX = viewBox.x + (clickX / rect.width) * viewBox.width;
      const worldY = viewBox.y + (clickY / rect.height) * viewBox.height;
      onCenterGraph(worldX, worldY);
    }
  };

  svg.addEventListener("pointerdown", (e: PointerEvent) => {
    isDraggingMinimap = true;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
    panToMinimapCoord(e.clientX, e.clientY);
  });

  svg.addEventListener("pointermove", (e: PointerEvent) => {
    if (!isDraggingMinimap) return;
    panToMinimapCoord(e.clientX, e.clientY);
  });

  const stopMinimapDrag = (e: PointerEvent) => {
    if (isDraggingMinimap) {
      isDraggingMinimap = false;
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };
  svg.addEventListener("pointerup", stopMinimapDrag);
  svg.addEventListener("pointercancel", stopMinimapDrag);

  hud.appendChild(svg);
  container.appendChild(hud);
  return hud;
}

/**
 * Updates the SVG thumbnail and viewfinder extent in the Minimap HUD.
 */
export function updateMinimapHud(hud: HTMLElement | null, g: MinimapGraph): void {
  if (!hud || hud.style.display === "none") return;
  const svg = hud.querySelector("#minimap-svg") as SVGSVGElement | null;
  if (!svg) return;

  const nodes = g.getNodes().filter((n) => !isEphemeralDiagramNode(n.id));
  if (nodes.length === 0) {
    svg.innerHTML = "";
    return;
  }

  // Calculate full model bounding box (including nodes and edge paths)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const pos = n.getPosition?.();
    const size = n.getSize?.();
    if (!pos || !size) continue;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + (size.width || 0));
    maxY = Math.max(maxY, pos.y + (size.height || 0));
  }

  const edges = g.getEdges?.() || [];
  for (const edge of edges) {
    if (typeof g.findViewByCell === "function") {
      const edgeView = g.findViewByCell(edge as never) as {
        path?: { bbox?: () => { x: number; y: number; width: number; height: number } };
      } | null;
      if (typeof edgeView?.path?.bbox === "function") {
        try {
          const b = edgeView.path.bbox();
          if (b && isFinite(b.x) && isFinite(b.y)) {
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + (b.width || 0));
            maxY = Math.max(maxY, b.y + (b.height || 0));
            continue;
          }
        } catch {}
      }
    }

    if (typeof edge.getBBox === "function") {
      try {
        const b = edge.getBBox();
        if (b && isFinite(b.x) && isFinite(b.y)) {
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + (b.width || 0));
          maxY = Math.max(maxY, b.y + (b.height || 0));
          continue;
        }
      } catch {}
    }

    const p1 = edge.getSourcePoint?.();
    const p2 = edge.getTargetPoint?.();
    if (p1 && isFinite(p1.x) && isFinite(p1.y)) {
      minX = Math.min(minX, p1.x);
      minY = Math.min(minY, p1.y);
      maxX = Math.max(maxX, p1.x);
      maxY = Math.max(maxY, p1.y);
    }
    if (p2 && isFinite(p2.x) && isFinite(p2.y)) {
      minX = Math.min(minX, p2.x);
      minY = Math.min(minY, p2.y);
      maxX = Math.max(maxX, p2.x);
      maxY = Math.max(maxY, p2.y);
    }
    const verts = edge.getVertices?.() || [];
    for (const v of verts) {
      if (v && isFinite(v.x) && isFinite(v.y)) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }
    }
  }

  if (minX === Infinity || !isFinite(minX)) return;

  // Add 40px margin around graph
  const pad = 40;
  minX -= pad;
  minY -= pad;
  const totalW = Math.max(100, maxX - minX + pad * 2);
  const totalH = Math.max(100, maxY - minY + pad * 2);

  svg.setAttribute("viewBox", `${minX} ${minY} ${totalW} ${totalH}`);

  // Calculate visible viewfinder rectangle
  const container = g.container as HTMLElement | undefined;
  const cw = container?.clientWidth || 800;
  const ch = container?.clientHeight || 600;
  const { sx, sy } = typeof g.scale === "function" ? g.scale() : { sx: 1, sy: 1 };
  const { tx, ty } = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };

  const viewX = -tx / sx;
  const viewY = -ty / sy;
  const viewW = cw / sx;
  const viewH = ch / sy;

  // Render SVG elements
  let svgContent = "";

  // 1. Render edges
  for (const edge of edges) {
    let pathData = "";

    // 1a. Try retrieving exact rendered path from EdgeView if available in graph
    if (typeof g.findViewByCell === "function") {
      const edgeView = g.findViewByCell(edge as never) as {
        getConnectionPathData?: () => string;
        path?: { serialize?: () => string };
      } | null;
      if (typeof edgeView?.getConnectionPathData === "function") {
        pathData = edgeView.getConnectionPathData() || "";
      } else if (typeof edgeView?.path?.serialize === "function") {
        pathData = edgeView.path.serialize() || "";
      }
    }

    if (pathData) {
      svgContent += `<path d="${pathData}" fill="none" stroke="#64748b" stroke-width="1.5" opacity="0.6" stroke-linejoin="round" stroke-linecap="round"/>`;
      continue;
    }

    // 1b. Fallback: retrieve endpoints and intermediate vertices
    let p1 = edge.getSourcePoint?.();
    let p2 = edge.getTargetPoint?.();

    if (typeof edge.getSourceCell === "function" || typeof edge.getSourceCellId === "function") {
      let sCell = typeof edge.getSourceCell === "function" ? edge.getSourceCell() : null;
      if (!sCell && typeof g.getCellById === "function") {
        const sId = typeof edge.getSourceCellId === "function" ? edge.getSourceCellId() : edge.source?.cell;
        if (sId) sCell = g.getCellById(sId);
      }
      const sPort = typeof edge.getSourcePortId === "function" ? edge.getSourcePortId() : edge.source?.port;
      const resolvedP1 = resolveNodePortWorldPoint(sCell as RouterNodeLike, sPort, p1);
      if (resolvedP1) p1 = resolvedP1;
    }

    if (typeof edge.getTargetCell === "function" || typeof edge.getTargetCellId === "function") {
      let tCell = typeof edge.getTargetCell === "function" ? edge.getTargetCell() : null;
      if (!tCell && typeof g.getCellById === "function") {
        const tId = typeof edge.getTargetCellId === "function" ? edge.getTargetCellId() : edge.target?.cell;
        if (tId) tCell = g.getCellById(tId);
      }
      const tPort = typeof edge.getTargetPortId === "function" ? edge.getTargetPortId() : edge.target?.port;
      const resolvedP2 = resolveNodePortWorldPoint(tCell as RouterNodeLike, tPort, p2);
      if (resolvedP2) p2 = resolvedP2;
    }

    const vertices = edge.getVertices?.() || [];

    if (p1 && p2 && isFinite(p1.x) && isFinite(p1.y) && isFinite(p2.x) && isFinite(p2.y)) {
      if (vertices.length > 0) {
        const pts = [p1, ...vertices, p2];
        const d = `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
        svgContent += `<path d="${d}" fill="none" stroke="#64748b" stroke-width="1.5" opacity="0.6" stroke-linejoin="round" stroke-linecap="round"/>`;
      } else {
        svgContent += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#64748b" stroke-width="1.5" opacity="0.6"/>`;
      }
    }
  }

  // 2. Render node thumbnails
  for (const n of nodes) {
    const pos = n.getPosition?.();
    const size = n.getSize?.();
    if (!pos || !size) continue;
    const stroke = (n.attr?.("body/stroke") as string) || "#38bdf8";
    svgContent += `<rect x="${pos.x}" y="${pos.y}" width="${size.width}" height="${size.height}" rx="2" ry="2" fill="#334155" stroke="${stroke}" stroke-width="1" opacity="0.8"/>`;
  }

  // 3. Render camera viewfinder
  svgContent += `<rect x="${viewX}" y="${viewY}" width="${viewW}" height="${viewH}" fill="rgba(56, 189, 248, 0.2)" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3 2"/>`;

  svg.innerHTML = svgContent;
}

/**
 * Toggles the visibility of the Minimap HUD.
 */
export function toggleMinimapHud(container: HTMLElement): boolean {
  if (typeof document === "undefined" || !container) return false;
  const hud = container.querySelector("#modelscript-minimap-hud") as HTMLElement | null;
  if (!hud) return false;
  const isHidden = hud.style.display === "none";
  hud.style.display = isHidden ? "flex" : "none";
  return isHidden;
}

/**
 * Returns true if the Minimap HUD is currently open and visible.
 */
export function isMinimapOpen(container: HTMLElement): boolean {
  if (typeof document === "undefined" || !container) return false;
  const hud = container.querySelector("#modelscript-minimap-hud") as HTMLElement | null;
  return Boolean(hud && hud.style.display !== "none");
}
