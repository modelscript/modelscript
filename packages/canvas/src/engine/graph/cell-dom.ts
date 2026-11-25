// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorldPoint } from "../../schema/canvas-document.js";
import { compileGlyphMarkup, materializeGlyphToSvg, setSvgTextContent } from "../glyph-compiler.js";
import type { SoaSceneGraph } from "../soa-scene.js";
import type { UnifiedCell } from "./cell.js";
import { ensureEdgeMarker } from "./edge-routing.js";
import { samplePointAlongPolyline } from "./geometry.js";
import { SVG_NS, type EdgeRenderPathResult, type UnifiedCellHost, type UnifiedCellViewBase } from "./types.js";

export interface CellDomSyncContext<TGraph extends UnifiedCellHost<UnifiedCell>> {
  activeRenderMode: "svg" | "canvas2d";
  nodesG: SVGGElement | null;
  edgesG: SVGGElement | null;
  defsEl: SVGDefsElement | null;
  markerCache: Map<string, string>;
  selectedIds: ReadonlySet<string>;
  scheduleCanvas2DRender: () => void;
  findViewByCell: (cell: UnifiedCell | string) => UnifiedCellViewBase<UnifiedCell, TGraph> | null;
  computeEdgeRenderPath: (edge: UnifiedCell) => EdgeRenderPathResult;
  syncEdgeToolsDom: (edge: UnifiedCell) => void;
}

export function insertElementByZIndex(layer: SVGGElement, el: Element, zIndex: number): void {
  el.setAttribute("data-z-index", String(zIndex));
  for (let child = layer.firstElementChild; child; child = child.nextElementSibling) {
    const cz = Number(child.getAttribute("data-z-index") ?? 0);
    if (cz > zIndex) {
      layer.insertBefore(el, child);
      return;
    }
  }
  layer.appendChild(el);
}

export function reorderCellDomByZIndex(
  cell: UnifiedCell,
  nodesG: SVGGElement | null,
  edgesG: SVGGElement | null,
): void {
  const el = cell.view?.container;
  const layer = cell.isNode() ? nodesG : edgesG;
  if (!el || !layer || el.parentNode !== layer) return;
  el.setAttribute("data-z-index", String(cell.zIndex));
  const targetZ = cell.zIndex;
  let insertBeforeEl: Element | null = null;
  for (let child = layer.firstElementChild; child; child = child.nextElementSibling) {
    if (child === el) continue;
    const cz = Number(child.getAttribute("data-z-index") ?? 0);
    if (cz > targetZ) {
      insertBeforeEl = child;
      break;
    }
  }
  if (insertBeforeEl !== el.nextElementSibling) {
    layer.insertBefore(el, insertBeforeEl);
  }
}

export function syncEdgeLabelsDom(edge: UnifiedCell, pts: WorldPoint[]): void {
  const container = edge.view?.container;
  if (!container || typeof document === "undefined") return;
  let labelsG = container.querySelector(".ms-edge-labels") as SVGGElement | null;
  if (!edge.labels || edge.labels.length === 0) {
    if (labelsG) labelsG.innerHTML = "";
    return;
  }
  if (!labelsG) {
    labelsG = document.createElementNS(SVG_NS, "g");
    labelsG.setAttribute("class", "ms-edge-labels");
    container.appendChild(labelsG);
  }
  labelsG.innerHTML = "";

  for (const rawLabel of edge.labels) {
    if (!rawLabel || typeof rawLabel !== "object") continue;
    const lbl = rawLabel as {
      attrs?:
        | {
            text?: { text?: string | undefined; fill?: string | undefined; fontSize?: number | undefined } | undefined;
            label?: { text?: string | undefined } | undefined;
            rect?: { fill?: string | undefined; stroke?: string | undefined } | undefined;
          }
        | undefined;
      position?: number | { distance?: number | undefined } | undefined;
    };
    const text = lbl.attrs?.text?.text ?? lbl.attrs?.label?.text;
    if (!text) continue;
    const frac =
      typeof lbl.position === "number"
        ? lbl.position <= 1 && lbl.position >= 0
          ? lbl.position
          : 0.5
        : typeof lbl.position?.distance === "number" && lbl.position.distance <= 1 && lbl.position.distance >= 0
          ? lbl.position.distance
          : 0.5;
    const pt = samplePointAlongPolyline(pts, frac);

    const lg = document.createElementNS(SVG_NS, "g");
    lg.setAttribute("class", "ms-edge-label");
    lg.setAttribute("transform", `translate(${pt.x}, ${pt.y})`);

    const fontSize = lbl.attrs?.text?.fontSize ?? 11;
    const padX = 5;
    const estW = Math.max(18, text.length * (fontSize * 0.62) + padX * 2);
    const estH = fontSize + 6;
    const pill = document.createElementNS(SVG_NS, "rect");
    pill.setAttribute("x", String(-estW / 2));
    pill.setAttribute("y", String(-estH / 2));
    pill.setAttribute("width", String(estW));
    pill.setAttribute("height", String(estH));
    pill.setAttribute("rx", "3");
    pill.setAttribute("fill", lbl.attrs?.rect?.fill ?? "rgba(15, 23, 42, 0.85)");
    if (lbl.attrs?.rect?.stroke) pill.setAttribute("stroke", lbl.attrs.rect.stroke);
    lg.appendChild(pill);

    const txt = document.createElementNS(SVG_NS, "text");
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("font-size", String(fontSize));
    txt.setAttribute("fill", lbl.attrs?.text?.fill ?? "#e2e8f0");
    txt.textContent = text;
    lg.appendChild(txt);
    labelsG.appendChild(lg);
  }
}

export function syncCellDom<TGraph extends UnifiedCellHost<UnifiedCell>>(
  cell: UnifiedCell,
  ctx: CellDomSyncContext<TGraph>,
): void {
  if (ctx.activeRenderMode === "canvas2d") {
    ctx.scheduleCanvas2DRender();
    return;
  }
  const el = cell.view?.container;
  if (!el) return;

  if (cell.isNode()) {
    const cx = cell.width / 2;
    const cy = cell.height / 2;
    const rot = cell.angle !== 0 ? ` rotate(${cell.angle}, ${cx}, ${cy})` : "";
    el.setAttribute("transform", `translate(${cell.x}, ${cell.y})${rot}`);
    if ("style" in el) {
      (el as HTMLElement).style.display = cell.visible ? "" : "none";
    }
    // Apply flipX / flipY cleanly on the glyph host so flips persist across DOM rebuilds
    const data = cell.getData();
    const flipX = Boolean(data["flipX"]);
    const flipY = Boolean(data["flipY"]);
    const glyphHost = el.querySelector?.(".ms-node-glyph");
    if (glyphHost) {
      if (flipX || flipY) {
        const sx = flipX ? -1 : 1;
        const sy = flipY ? -1 : 1;
        const tx = flipX ? cell.width : 0;
        const ty = flipY ? cell.height : 0;
        glyphHost.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
      } else if (glyphHost.getAttribute?.("transform")) {
        glyphHost.removeAttribute?.("transform");
      }
    }
    // Keep port DOM positions synchronized with flip state
    const ports = cell.getPorts();
    if (ports.length > 0) {
      el.querySelectorAll(".ms-port").forEach((pEl) => {
        const pid = pEl.getAttribute("port-id") ?? pEl.getAttribute("port");
        const match = ports.find((p) => p.id === pid);
        if (match) {
          const rawX = match.args?.x ?? 0;
          const rawY = match.args?.y ?? 0;
          const px = flipX ? cell.width - rawX : rawX;
          const py = flipY ? cell.height - rawY : rawY;
          pEl.setAttribute("transform", `translate(${px}, ${py})`);
        }
      });
    }
  } else {
    const { d, sourcePt, targetPt, routePoints, stroke, strokeWidth, strokeDasharray, sourceMarker, targetMarker } =
      ctx.computeEdgeRenderPath(cell);
    const isSelected = ctx.selectedIds.has(cell.id);
    el.classList?.toggle?.("ms-edge-selected", isSelected);
    const haloEl = cell.selectorElements.get("halo")?.[0] as SVGElement | undefined;
    if (haloEl) {
      haloEl.setAttribute("d", d);
      haloEl.style.display = isSelected ? "" : "none";
    }
    const hitEl = cell.selectorElements.get("hit")?.[0];
    if (hitEl) {
      hitEl.setAttribute("d", d);
    }
    const pathEl = cell.selectorElements.get("line")?.[0];
    if (pathEl) {
      pathEl.setAttribute("d", d);
      pathEl.setAttribute("stroke", stroke);
      pathEl.setAttribute("stroke-width", String(strokeWidth));
      if (strokeDasharray) pathEl.setAttribute("stroke-dasharray", strokeDasharray);
      else pathEl.removeAttribute("stroke-dasharray");

      const srcMarkerId = ensureEdgeMarker(ctx.defsEl, ctx.markerCache, sourceMarker, stroke);
      if (srcMarkerId) pathEl.setAttribute("marker-start", `url(#${srcMarkerId})`);
      else pathEl.removeAttribute("marker-start");

      const tgtMarkerId = ensureEdgeMarker(ctx.defsEl, ctx.markerCache, targetMarker, stroke);
      if (tgtMarkerId) pathEl.setAttribute("marker-end", `url(#${tgtMarkerId})`);
      else pathEl.removeAttribute("marker-end");
    }
    syncEdgeLabelsDom(cell, [sourcePt, ...routePoints, targetPt]);
    if (cell.getTools().length > 0 || isSelected) {
      ctx.syncEdgeToolsDom(cell);
    }
  }
}

export function rebuildCellDom<TGraph extends UnifiedCellHost<UnifiedCell>>(
  cell: UnifiedCell,
  ctx: CellDomSyncContext<TGraph>,
): void {
  if (typeof document === "undefined" || !ctx.nodesG || !ctx.edgesG) return;
  if (ctx.activeRenderMode === "canvas2d") {
    ctx.scheduleCanvas2DRender();
    return;
  }

  const oldContainer = cell.view?.container ?? null;
  cell.selectorElements.clear();

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("data-cell-id", cell.id);
  g.setAttribute("data-z-index", String(cell.zIndex));
  g.setAttribute("class", cell.isNode() ? "ms-cell ms-node" : "ms-cell ms-edge");

  if (cell.isNode()) {
    const glyph = cell.getCompiledGlyph();
    if (glyph) {
      const inner = materializeGlyphToSvg(glyph, document, cell.width, cell.height, cell.selectorElements);
      inner.setAttribute("class", "ms-node-glyph");
      g.appendChild(inner);
    }
    // Render ports (respecting flipX / flipY so flips survive DOM rebuilds)
    const data = cell.getData();
    const flipX = Boolean(data["flipX"]);
    const flipY = Boolean(data["flipY"]);
    for (const p of cell.getPorts()) {
      const pg = document.createElementNS(SVG_NS, "g");
      pg.setAttribute("class", "ms-port");
      pg.setAttribute("port", p.id);
      pg.setAttribute("port-id", p.id);
      pg.setAttribute("data-port", p.id);
      pg.setAttribute("magnet", "true");
      const rawX = p.args?.x ?? 0;
      const rawY = p.args?.y ?? 0;
      const px = flipX ? cell.width - rawX : rawX;
      const py = flipY ? cell.height - rawY : rawY;
      pg.setAttribute("transform", `translate(${px}, ${py})`);
      if (p.markup) {
        const portGlyph = compileGlyphMarkup(p.markup, p.attrs, 8, 8);
        pg.appendChild(materializeGlyphToSvg(portGlyph, document, 8, 8));
      } else {
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("r", "4");
        dot.setAttribute("fill", "#38bdf8");
        dot.setAttribute("stroke", "#0f172a");
        dot.setAttribute("stroke-width", "1");
        pg.appendChild(dot);
      }
      g.appendChild(pg);
    }
    if (oldContainer && oldContainer.parentNode === ctx.nodesG) {
      ctx.nodesG.replaceChild(g, oldContainer);
    } else {
      if (oldContainer && oldContainer.parentNode) {
        oldContainer.parentNode.removeChild(oldContainer);
      }
      insertElementByZIndex(ctx.nodesG, g, cell.zIndex);
    }
  } else {
    const haloEl = document.createElementNS(SVG_NS, "path");
    haloEl.setAttribute("class", "ms-edge-halo");
    haloEl.setAttribute("fill", "none");
    haloEl.setAttribute("stroke", "rgba(56, 189, 248, 0.35)");
    haloEl.setAttribute("stroke-width", "8");
    haloEl.setAttribute("stroke-linecap", "round");
    haloEl.setAttribute("stroke-linejoin", "round");
    haloEl.setAttribute("vector-effect", "non-scaling-stroke");
    haloEl.setAttribute("pointer-events", "none");
    haloEl.style.display = "none";
    g.appendChild(haloEl);

    const pathEl = document.createElementNS(SVG_NS, "path");
    pathEl.setAttribute("class", "ms-edge-line connection");
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("data-selector", "line");
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(pathEl);

    const hitEl = document.createElementNS(SVG_NS, "path");
    hitEl.setAttribute("class", "ms-edge-hit");
    hitEl.setAttribute("fill", "none");
    hitEl.setAttribute("stroke", "transparent");
    hitEl.setAttribute("stroke-width", "14");
    hitEl.setAttribute("vector-effect", "non-scaling-stroke");
    hitEl.setAttribute("pointer-events", "stroke");
    hitEl.style.cursor = "pointer";
    g.appendChild(hitEl);

    cell.selectorElements.set("line", [pathEl]);
    cell.selectorElements.set("halo", [haloEl]);
    cell.selectorElements.set("hit", [hitEl]);
    if (oldContainer && oldContainer.parentNode === ctx.edgesG) {
      ctx.edgesG.replaceChild(g, oldContainer);
    } else {
      if (oldContainer && oldContainer.parentNode) {
        oldContainer.parentNode.removeChild(oldContainer);
      }
      insertElementByZIndex(ctx.edgesG, g, cell.zIndex);
    }
  }

  const view = ctx.findViewByCell(cell)!;
  view.container = g;
  syncCellDom(cell, ctx);
}

/**
 * Scales a node's vector icon graphics, ref-sized primitives, and port positions in-place
 * whenever its dimensions change (via interactive resize handles or `setSize()`).
 */
export function resizeCellVisualDom(
  cell: UnifiedCell,
  prevWidth: number,
  prevHeight: number,
  scene: SoaSceneGraph,
  activeRenderMode: "svg" | "canvas2d",
): void {
  if (!cell.isNode()) return;
  const newW = cell.width;
  const newH = cell.height;
  if (Math.abs(newW - prevWidth) < 0.01 && Math.abs(newH - prevHeight) < 0.01) return;

  // 1. Rescale ports proportionally and sync SoA scene
  const ports = cell.getPorts();
  if (ports.length > 0) {
    const sx = prevWidth > 0 ? newW / prevWidth : 1;
    const sy = prevHeight > 0 ? newH / prevHeight : 1;
    for (const p of ports) {
      if (!p.args) p.args = {};
      if (typeof p.args.x === "number") p.args.x = Math.round(p.args.x * sx * 10) / 10;
      if (typeof p.args.y === "number") p.args.y = Math.round(p.args.y * sy * 10) / 10;
    }
    scene.setNodePorts(
      cell.id,
      ports.map((p) => ({
        id: p.id,
        group: p.group,
        x: p.args?.x ?? 0,
        y: p.args?.y ?? 0,
        angle: p.args?.angle,
      })),
    );
  }

  // 2. Keep markup root dimensions in sync (clone attrs so shared markup objects are never mutated)
  const rawMarkup = cell.getMarkup();
  if (rawMarkup && !Array.isArray(rawMarkup) && rawMarkup.attrs) {
    if (rawMarkup.attrs["width"] !== undefined || rawMarkup.attrs["height"] !== undefined) {
      const clonedAttrs = { ...rawMarkup.attrs };
      if (clonedAttrs["width"] !== undefined) clonedAttrs["width"] = newW;
      if (clonedAttrs["height"] !== undefined) clonedAttrs["height"] = newH;
      rawMarkup.attrs = clonedAttrs;
    }
  }
  const el = cell.view?.container;
  if (!el || typeof document === "undefined" || activeRenderMode === "canvas2d") return;

  // Update live port DOM transforms (accounting for flip)
  const data = cell.getData();
  const flipX = Boolean(data["flipX"]);
  const flipY = Boolean(data["flipY"]);
  const portEls = el.querySelectorAll(".ms-port");
  portEls.forEach((pEl) => {
    const pid = pEl.getAttribute("port-id") ?? pEl.getAttribute("port");
    const match = ports.find((p) => p.id === pid);
    if (match) {
      const rawX = match.args?.x ?? 0;
      const rawY = match.args?.y ?? 0;
      const px = flipX ? newW - rawX : rawX;
      const py = flipY ? newH - rawY : rawY;
      pEl.setAttribute("transform", `translate(${px}, ${py})`);
    }
  });

  // Update outer <svg> or re-materialize glyph primitives so icons & background rects scale smoothly
  const glyphHost = el.querySelector(".ms-node-glyph");
  const outerSvg = glyphHost?.firstElementChild;
  if (outerSvg && outerSvg.tagName.toLowerCase() === "svg") {
    outerSvg.setAttribute("width", String(newW));
    outerSvg.setAttribute("height", String(newH));
    for (const child of Array.from(outerSvg.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === "rect") {
        // Only resize background/body rects matching the previous full bounds, not inner graphic rects
        const rw = parseFloat(child.getAttribute("width") ?? "");
        const rh = parseFloat(child.getAttribute("height") ?? "");
        const isBody = child.getAttribute("data-selector") === "body";
        if (isBody || (Math.abs(rw - prevWidth) < 1 && Math.abs(rh - prevHeight) < 1)) {
          child.setAttribute("width", String(newW));
          child.setAttribute("height", String(newH));
        }
      } else if (tag === "g") {
        const tf = child.getAttribute("transform") || "";
        const m = /scale\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(tf);
        if (m) {
          const fsx = parseFloat(m[1]!);
          const fsy = parseFloat(m[2]!);
          child.setAttribute(
            "transform",
            `translate(${fsx < 0 ? newW : 0}, ${fsy < 0 ? newH : 0}) scale(${fsx}, ${fsy})`,
          );
        }
      }
    }
  } else if (glyphHost && glyphHost.parentNode) {
    const recompiled = compileGlyphMarkup(cell.getMarkup(), cell.getAttrs(), newW, newH);
    cell.selectorElements.clear();
    const nextGlyph = materializeGlyphToSvg(recompiled, document, newW, newH, cell.selectorElements);
    nextGlyph.setAttribute("class", "ms-node-glyph");
    glyphHost.parentNode.replaceChild(nextGlyph, glyphHost);
  }
}

export function patchCellSelectorDom(
  cell: UnifiedCell,
  selector: string,
  key: string,
  val: unknown,
  activeRenderMode: "svg" | "canvas2d",
  scheduleCanvas2DRender: () => void,
): void {
  if (activeRenderMode === "canvas2d") {
    scheduleCanvas2DRender();
    return;
  }
  const els = cell.selectorElements.get(selector);
  if (!els || els.length === 0) return;
  for (const el of els) {
    if (key === "text" || key === "textContent") {
      const str = val === null || val === undefined ? "" : String(val);
      if (el.tagName.toLowerCase() === "text" && typeof document !== "undefined") {
        setSvgTextContent(el, str, document);
      } else {
        el.textContent = str;
      }
    } else if (val === null || val === undefined) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, String(val));
    }
  }
}
