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
  getWidth?: (() => number) | undefined;
  getHeight?: (() => number) | undefined;
  getNodes: () => MinimapGraphNode[];
  getEdges?: (() => MinimapGraphEdge[]) | undefined;
  scale?: (() => { sx: number; sy: number }) | undefined;
  translate?: ((tx?: number, ty?: number) => { tx: number; ty: number }) | undefined;
  centerPoint?: ((x: number, y: number) => void) | undefined;
  findViewByCell?: ((cell: never) => unknown) | undefined;
  getCellById?: ((id: string) => unknown) | undefined;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const minimapCenterCallbacks = new WeakMap<HTMLElement, (worldX: number, worldY: number) => void>();

function sanitizeSvgColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return fallback;
  if (/^[#a-zA-Z0-9(),.\s%-]+$/.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Removes any Minimap HUD attached to `container`.
 */
export function destroyMinimapHud(container: HTMLElement | null | undefined): void {
  if (!container) return;
  minimapCenterCallbacks.delete(container);
  const hud = container.querySelector("#modelscript-minimap-hud");
  if (hud) hud.remove();
}

/**
 * Creates or retrieves the floating Minimap HUD container in the DOM.
 * Always updates the `onCenterGraph` callback so remounted graphs never invoke a disposed instance.
 */
export function ensureMinimapHud(
  container: HTMLElement,
  onCenterGraph: (worldX: number, worldY: number) => void,
  initiallyVisible = true,
): HTMLElement | null {
  if (typeof document === "undefined" || !container) return null;
  minimapCenterCallbacks.set(container, onCenterGraph);

  let hud = container.querySelector("#modelscript-minimap-hud") as HTMLElement | null;
  if (hud) return hud;

  hud = document.createElement("div");
  hud.id = "modelscript-minimap-hud";
  hud.className = "modelscript-minimap-hud";
  hud.style.position = "absolute";
  hud.style.right = "16px";
  hud.style.bottom = "68px";
  hud.style.width = "180px";
  hud.style.height = "120px";
  hud.style.background = "var(--ms-surface-glass, rgba(22, 27, 34, 0.85))";
  hud.style.backdropFilter = "blur(12px)";
  (hud.style as unknown as Record<string, string>)["webkitBackdropFilter"] = "blur(12px)";
  hud.style.border = "1px solid var(--ms-divider, rgba(148, 163, 184, 0.25))";
  hud.style.borderRadius = "12px";
  hud.style.boxShadow = "var(--ms-shadow-card, 0 12px 32px -4px rgba(0, 0, 0, 0.25))";
  hud.style.zIndex = "990";
  hud.style.overflow = "hidden";
  hud.style.display = initiallyVisible ? "flex" : "none";
  hud.style.flexDirection = "column";
  hud.style.userSelect = "none";
  hud.style.transition = "opacity 0.15s ease, transform 0.15s ease";

  // Minimap Floating Header / Overlay Badge
  const header = document.createElement("div");
  header.className = "minimap-header";
  header.style.position = "absolute";
  header.style.top = "0";
  header.style.left = "0";
  header.style.right = "0";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.padding = "6px 8px";
  header.style.zIndex = "2";
  header.style.pointerEvents = "none";

  const title = document.createElement("span");
  title.textContent = "Radar";
  title.style.fontSize = "9px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "0.06em";
  title.style.textTransform = "uppercase";
  title.style.color = "var(--ms-text-3, rgba(148, 163, 184, 0.85))";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close Minimap");
  closeBtn.title = "Close Minimap (M)";
  closeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`;
  closeBtn.style.pointerEvents = "auto";
  closeBtn.style.background = "var(--ms-surface-2, rgba(100, 116, 139, 0.22))";
  closeBtn.style.border = "none";
  closeBtn.style.borderRadius = "999px";
  closeBtn.style.width = "18px";
  closeBtn.style.height = "18px";
  closeBtn.style.display = "flex";
  closeBtn.style.alignItems = "center";
  closeBtn.style.justifyContent = "center";
  closeBtn.style.color = "var(--ms-text-2, #94a3b8)";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.opacity = "0";
  closeBtn.style.transition = "opacity 0.15s ease, background 0.15s ease, color 0.15s ease";
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = "var(--ms-surface-hover, rgba(100, 116, 139, 0.45))";
    closeBtn.style.color = "var(--ms-text-1, #ffffff)";
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = "var(--ms-surface-2, rgba(100, 116, 139, 0.22))";
    closeBtn.style.color = "var(--ms-text-2, #94a3b8)";
  };
  closeBtn.onfocus = () => {
    closeBtn.style.opacity = "1";
  };
  closeBtn.onblur = () => {
    closeBtn.style.opacity = "0";
  };
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    hud!.style.display = "none";
  };
  header.appendChild(closeBtn);
  hud.appendChild(header);

  hud.onmouseenter = () => {
    closeBtn.style.opacity = "1";
  };
  hud.onmouseleave = () => {
    if (document.activeElement !== closeBtn) {
      closeBtn.style.opacity = "0";
    }
  };

  // SVG Thumbnail Canvas
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "minimap-svg";
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Diagram overview minimap");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.cursor = "crosshair";

  let isDraggingMinimap = false;
  const panToMinimapCoord = (clientX: number, clientY: number) => {
    const centerFn = minimapCenterCallbacks.get(container);
    if (!centerFn) return;
    // Use exact SVG screen CTM inversion so letterboxing (preserveAspectRatio="xMidYMid meet") is respected
    if (typeof svg.createSVGPoint === "function" && typeof svg.getScreenCTM === "function") {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        try {
          const pt = svg.createSVGPoint();
          pt.x = clientX;
          pt.y = clientY;
          const world = pt.matrixTransform(ctm.inverse());
          if (Number.isFinite(world.x) && Number.isFinite(world.y)) {
            centerFn(world.x, world.y);
            return;
          }
        } catch {
          // Fallback below
        }
      }
    }
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0 && rect.width > 0 && rect.height > 0) {
      const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
      const renderedW = viewBox.width * scale;
      const renderedH = viewBox.height * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;
      const worldX = viewBox.x + (clientX - rect.left - offsetX) / scale;
      const worldY = viewBox.y + (clientY - rect.top - offsetY) / scale;
      centerFn(worldX, worldY);
    }
  };

  svg.addEventListener("pointerdown", (e: PointerEvent) => {
    if (typeof e.button === "number" && e.button !== 0) return;
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
  if (!hud || hud.style.display === "none" || g.disposed) return;
  const svg = hud.querySelector("#minimap-svg") as SVGSVGElement | null;
  if (!svg || typeof document === "undefined") return;

  const nodes = g.getNodes().filter((n) => !isEphemeralDiagramNode(n.id));
  if (nodes.length === 0) {
    svg.textContent = "";
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const n of nodes) {
    const pos = n.getPosition?.();
    const size = n.getSize?.();
    if (!pos || !size) continue;
    includePt(pos.x, pos.y);
    includePt(pos.x + (size.width || 0), pos.y + (size.height || 0));
  }

  const edges = g.getEdges?.() || [];
  const edgePolylines: { x: number; y: number }[][] = [];

  for (const edge of edges) {
    const view =
      typeof g.findViewByCell === "function"
        ? (g.findViewByCell(edge as never) as {
            sourcePoint?: { x: number; y: number } | undefined;
            targetPoint?: { x: number; y: number } | undefined;
            routePoints?: { x: number; y: number }[] | undefined;
          } | null)
        : null;

    let p1 = view?.sourcePoint ?? edge.getSourcePoint?.();
    let p2 = view?.targetPoint ?? edge.getTargetPoint?.();

    if (
      (!p1 || (p1.x === 0 && p1.y === 0)) &&
      (typeof edge.getSourceCell === "function" || typeof edge.getSourceCellId === "function")
    ) {
      let sCell = typeof edge.getSourceCell === "function" ? edge.getSourceCell() : null;
      if (!sCell && typeof g.getCellById === "function") {
        const sId = typeof edge.getSourceCellId === "function" ? edge.getSourceCellId() : edge.source?.cell;
        if (sId) sCell = g.getCellById(sId);
      }
      const sPort = typeof edge.getSourcePortId === "function" ? edge.getSourcePortId() : edge.source?.port;
      const resolvedP1 = resolveNodePortWorldPoint(sCell as RouterNodeLike, sPort, p1);
      if (resolvedP1) p1 = resolvedP1;
    }

    if (
      (!p2 || (p2.x === 0 && p2.y === 0)) &&
      (typeof edge.getTargetCell === "function" || typeof edge.getTargetCellId === "function")
    ) {
      let tCell = typeof edge.getTargetCell === "function" ? edge.getTargetCell() : null;
      if (!tCell && typeof g.getCellById === "function") {
        const tId = typeof edge.getTargetCellId === "function" ? edge.getTargetCellId() : edge.target?.cell;
        if (tId) tCell = g.getCellById(tId);
      }
      const tPort = typeof edge.getTargetPortId === "function" ? edge.getTargetPortId() : edge.target?.port;
      const resolvedP2 = resolveNodePortWorldPoint(tCell as RouterNodeLike, tPort, p2);
      if (resolvedP2) p2 = resolvedP2;
    }

    const midPts = view?.routePoints && view.routePoints.length > 0 ? view.routePoints : (edge.getVertices?.() ?? []);
    if (p1 && p2 && Number.isFinite(p1.x) && Number.isFinite(p1.y) && Number.isFinite(p2.x) && Number.isFinite(p2.y)) {
      const poly = [p1, ...midPts, p2];
      for (const pt of poly) includePt(pt.x, pt.y);
      edgePolylines.push(poly);
    } else if (typeof (view as { getConnectionPathData?: () => string } | null)?.getConnectionPathData === "function") {
      const pathData = (view as { getConnectionPathData: () => string }).getConnectionPathData();
      if (typeof pathData === "string" && pathData.length > 0) {
        const nums = pathData.match(/-?\d+(?:\.\d+)?/g);
        if (nums && nums.length >= 4) {
          const poly: { x: number; y: number }[] = [];
          for (let i = 0; i + 1 < nums.length; i += 2) {
            const x = Number(nums[i]);
            const y = Number(nums[i + 1]);
            if (Number.isFinite(x) && Number.isFinite(y)) {
              includePt(x, y);
              poly.push({ x, y });
            }
          }
          if (poly.length >= 2) {
            edgePolylines.push(poly);
          }
        }
      }
    }
  }

  if (minX === Infinity || !Number.isFinite(minX)) return;

  // Calculate visible viewfinder rectangle and union it into bounds so panning off-content stays visible
  const container = g.container as HTMLElement | undefined;
  const cw = (typeof g.getWidth === "function" ? g.getWidth() : 0) || container?.clientWidth || 800;
  const ch = (typeof g.getHeight === "function" ? g.getHeight() : 0) || container?.clientHeight || 600;
  const { sx, sy } = typeof g.scale === "function" ? g.scale() : { sx: 1, sy: 1 };
  const { tx, ty } = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };

  const viewX = -tx / (sx || 1);
  const viewY = -ty / (sy || 1);
  const viewW = cw / (sx || 1);
  const viewH = ch / (sy || 1);

  includePt(viewX, viewY);
  includePt(viewX + viewW, viewY + viewH);

  // Add 40px margin around union bounds
  const pad = 40;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const totalW = Math.max(100, maxX - minX);
  const totalH = Math.max(100, maxY - minY);

  svg.setAttribute("viewBox", `${minX} ${minY} ${totalW} ${totalH}`);

  // Build SVG safely using DOM elements in browsers (no raw innerHTML interpolation of user strings).
  // Fall back to sanitized numeric/allow-listed SVG markup only in lightweight mock DOMs without createDocumentFragment.
  if (typeof document.createDocumentFragment === "function") {
    const frag = document.createDocumentFragment();

    for (const poly of edgePolylines) {
      if (poly.length === 2) {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(poly[0]!.x));
        line.setAttribute("y1", String(poly[0]!.y));
        line.setAttribute("x2", String(poly[1]!.x));
        line.setAttribute("y2", String(poly[1]!.y));
        line.setAttribute("stroke", "var(--ms-text-3, #64748b)");
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("vector-effect", "non-scaling-stroke");
        line.setAttribute("opacity", "0.6");
        frag.appendChild(line);
      } else {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M ${poly.map((p) => `${p.x} ${p.y}`).join(" L ")}`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "var(--ms-text-3, #64748b)");
        path.setAttribute("stroke-width", "1.5");
        path.setAttribute("vector-effect", "non-scaling-stroke");
        path.setAttribute("opacity", "0.6");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-linecap", "round");
        frag.appendChild(path);
      }
    }

    for (const n of nodes) {
      const pos = n.getPosition?.();
      const size = n.getSize?.();
      if (!pos || !size) continue;
      const stroke = sanitizeSvgColor(n.attr?.("body/stroke"), "#38bdf8");
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(pos.x));
      rect.setAttribute("y", String(pos.y));
      rect.setAttribute("width", String(Math.max(1, size.width)));
      rect.setAttribute("height", String(Math.max(1, size.height)));
      rect.setAttribute("rx", "3");
      rect.setAttribute("ry", "3");
      rect.setAttribute("fill", "var(--ms-surface-2, rgba(100, 116, 139, 0.35))");
      rect.setAttribute("stroke", stroke);
      rect.setAttribute("stroke-width", "1.2");
      rect.setAttribute("vector-effect", "non-scaling-stroke");
      rect.setAttribute("opacity", "0.9");
      frag.appendChild(rect);
    }

    const vf = document.createElementNS(SVG_NS, "rect");
    vf.setAttribute("x", String(viewX));
    vf.setAttribute("y", String(viewY));
    vf.setAttribute("width", String(Math.max(1, viewW)));
    vf.setAttribute("height", String(Math.max(1, viewH)));
    vf.setAttribute("rx", "3");
    vf.setAttribute("ry", "3");
    vf.setAttribute("fill", "rgba(6, 182, 212, 0.16)");
    vf.setAttribute("stroke", "#06b6d4");
    vf.setAttribute("stroke-width", "1.5");
    vf.setAttribute("vector-effect", "non-scaling-stroke");
    frag.appendChild(vf);

    svg.textContent = "";
    svg.appendChild(frag);
  } else {
    const parts: string[] = [];
    for (const poly of edgePolylines) {
      if (poly.length === 2) {
        parts.push(
          `<line x1="${poly[0]!.x}" y1="${poly[0]!.y}" x2="${poly[1]!.x}" y2="${poly[1]!.y}" stroke="var(--ms-text-3, #64748b)" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity="0.6"/>`,
        );
      } else {
        const d = `M ${poly.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
        parts.push(
          `<path d="${d}" fill="none" stroke="var(--ms-text-3, #64748b)" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity="0.6" stroke-linejoin="round" stroke-linecap="round"/>`,
        );
      }
    }
    for (const n of nodes) {
      const pos = n.getPosition?.();
      const size = n.getSize?.();
      if (!pos || !size) continue;
      const stroke = sanitizeSvgColor(n.attr?.("body/stroke"), "#38bdf8");
      parts.push(
        `<rect x="${pos.x}" y="${pos.y}" width="${Math.max(1, size.width)}" height="${Math.max(1, size.height)}" rx="3" ry="3" fill="var(--ms-surface-2, rgba(100, 116, 139, 0.35))" stroke="${stroke}" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.9"/>`,
      );
    }
    parts.push(
      `<rect x="${viewX}" y="${viewY}" width="${Math.max(1, viewW)}" height="${Math.max(1, viewH)}" rx="3" ry="3" fill="rgba(6, 182, 212, 0.16)" stroke="#06b6d4" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
    );
    svg.innerHTML = parts.join("");
  }
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
