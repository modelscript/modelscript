// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AlignmentGuideLine } from "../../core/alignment-guides.js";
import type { WorldBounds } from "../../schema/canvas-document.js";
import type { WiringPreview } from "../pointer-fsm.js";
import { SVG_NS, type GraphDomLayers, type GridStyleState } from "./types.js";

export function mountGraphDom(params: {
  container: HTMLElement;
  width: number;
  height: number;
  bgColor: string;
  gridPatternId: string;
  gridSize: number;
  gridColor: string;
  gridVisible: boolean;
  activeRenderMode: "svg" | "canvas2d";
}): GraphDomLayers | null {
  const { container, width, height, bgColor, gridPatternId, gridSize, gridColor, gridVisible, activeRenderMode } =
    params;
  if (typeof document === "undefined" || !container || typeof container.appendChild !== "function") {
    return null;
  }

  const style = container.style;
  if (style) {
    if (!style.position) style.position = "relative";
    style.overflow = "hidden";
    style.backgroundColor = bgColor;
  }

  const root = document.createElement("div");
  root.className = "ms-graph ms-unified-canvas";
  root.style.position = "relative";
  root.style.width = "100%";
  root.style.height = "100%";
  root.style.userSelect = "none";

  // High-scale Canvas2D layer (auto-activated above highScaleThreshold nodes)
  const canvas2D = document.createElement("canvas");
  canvas2D.className = "ms-canvas2d-layer";
  canvas2D.style.position = "absolute";
  canvas2D.style.inset = "0";
  canvas2D.style.width = "100%";
  canvas2D.style.height = "100%";
  canvas2D.style.display = activeRenderMode === "canvas2d" ? "block" : "none";
  canvas2D.style.pointerEvents = "none";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ms-graph-svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";

  const defs = document.createElementNS(SVG_NS, "defs");
  const pattern = document.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", gridPatternId);
  pattern.setAttribute("width", String(gridSize * 10));
  pattern.setAttribute("height", String(gridSize * 10));
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  const gridPath = document.createElementNS(SVG_NS, "path");
  const step = gridSize * 10;
  gridPath.setAttribute("d", `M ${step} 0 L 0 0 0 ${step}`);
  gridPath.setAttribute("fill", "none");
  gridPath.setAttribute("stroke", gridColor);
  gridPath.setAttribute("stroke-width", "1");
  pattern.appendChild(gridPath);
  defs.appendChild(pattern);
  svg.appendChild(defs);

  const gridRect = document.createElementNS(SVG_NS, "rect");
  gridRect.setAttribute("width", "100%");
  gridRect.setAttribute("height", "100%");
  gridRect.setAttribute("fill", gridVisible ? `url(#${gridPatternId})` : "none");
  gridRect.setAttribute("pointer-events", "none");
  svg.appendChild(gridRect);

  const viewportG = document.createElementNS(SVG_NS, "g");
  viewportG.setAttribute("class", "ms-canvas-viewport");

  const edgesG = document.createElementNS(SVG_NS, "g");
  edgesG.setAttribute("class", "ms-edges-layer");
  const nodesG = document.createElementNS(SVG_NS, "g");
  nodesG.setAttribute("class", "ms-nodes-layer");
  const toolsG = document.createElementNS(SVG_NS, "g");
  toolsG.setAttribute("class", "ms-tools-layer");

  const guidesG = document.createElementNS(SVG_NS, "g");
  guidesG.setAttribute("class", "ms-alignment-guides");
  guidesG.setAttribute("pointer-events", "none");

  const edgeToolsG = document.createElementNS(SVG_NS, "g");
  edgeToolsG.setAttribute("class", "ms-edge-tools");

  const marqueeRect = document.createElementNS(SVG_NS, "rect");
  marqueeRect.setAttribute("class", "ms-marquee-rect");
  marqueeRect.setAttribute("fill", "rgba(56, 189, 248, 0.12)");
  marqueeRect.setAttribute("stroke", "#38bdf8");
  marqueeRect.setAttribute("stroke-width", "1");
  marqueeRect.setAttribute("stroke-dasharray", "4 3");
  marqueeRect.setAttribute("vector-effect", "non-scaling-stroke");
  marqueeRect.setAttribute("pointer-events", "none");
  marqueeRect.style.display = "none";

  const previewPath = document.createElementNS(SVG_NS, "path");
  previewPath.setAttribute("fill", "none");
  previewPath.setAttribute("stroke", "#0891b2");
  previewPath.setAttribute("stroke-width", "1.5");
  previewPath.setAttribute("stroke-dasharray", "5 4");
  previewPath.setAttribute("vector-effect", "non-scaling-stroke");
  previewPath.setAttribute("pointer-events", "none");

  toolsG.appendChild(guidesG);
  toolsG.appendChild(edgeToolsG);
  toolsG.appendChild(marqueeRect);
  toolsG.appendChild(previewPath);

  viewportG.appendChild(edgesG);
  viewportG.appendChild(nodesG);
  viewportG.appendChild(toolsG);
  svg.appendChild(viewportG);

  const widgetLayer = document.createElement("div");
  widgetLayer.className = "ms-widget-portal-layer";
  widgetLayer.style.position = "absolute";
  widgetLayer.style.inset = "0";
  widgetLayer.style.pointerEvents = "none";

  const widgetCanvas = document.createElement("canvas");
  widgetCanvas.className = "ms-widgets-canvas";
  widgetCanvas.style.position = "absolute";
  widgetCanvas.style.inset = "0";
  widgetCanvas.style.width = "100%";
  widgetCanvas.style.height = "100%";
  widgetCanvas.style.display = "none";
  widgetCanvas.style.pointerEvents = "none";
  widgetLayer.appendChild(widgetCanvas);

  const selOverlay = document.createElement("div");
  selOverlay.className = "ms-widget-selection";
  selOverlay.style.position = "absolute";
  selOverlay.style.inset = "0";
  selOverlay.style.pointerEvents = "none";

  root.appendChild(canvas2D);
  root.appendChild(svg);
  root.appendChild(widgetLayer);
  root.appendChild(selOverlay);
  container.appendChild(root);

  return {
    rootEl: root,
    canvas2DEl: canvas2D,
    widgetCanvasEl: widgetCanvas,
    svgEl: svg,
    defsEl: defs,
    gridPatternEl: pattern,
    gridRectEl: gridRect,
    viewportG,
    edgesG,
    nodesG,
    toolsG,
    guidesG,
    edgeToolsG,
    marqueeRectEl: marqueeRect,
    widgetLayerEl: widgetLayer,
    selectionOverlayEl: selOverlay,
    wirePreviewPathEl: previewPath,
  };
}

export function applyGridArgs(grid: GridStyleState, args: unknown): void {
  if (Array.isArray(args)) {
    const minor = args[0] as { color?: string | undefined; thickness?: number | undefined } | undefined;
    const major = args[args.length - 1] as
      { color?: string | undefined; thickness?: number | undefined; factor?: number | undefined } | undefined;
    if (minor && args.length >= 2) {
      if (typeof minor.color === "string") grid.gridMinorColor = minor.color;
      if (typeof minor.thickness === "number") grid.gridMinorThickness = minor.thickness;
    }
    if (major) {
      if (typeof major.color === "string") grid.gridColor = major.color;
      if (typeof major.thickness === "number") grid.gridThickness = major.thickness;
      if (typeof major.factor === "number" && major.factor >= 1) grid.gridFactor = major.factor;
    }
  } else if (args && typeof args === "object") {
    const a = args as { color?: string | undefined; thickness?: number | undefined; factor?: number | undefined };
    if (typeof a.color === "string") grid.gridColor = a.color;
    if (typeof a.thickness === "number") grid.gridThickness = a.thickness;
    if (typeof a.factor === "number" && a.factor >= 1) grid.gridFactor = a.factor;
  }
}

export function syncGridPatternDom(
  gridPatternEl: SVGPatternElement | null,
  gridRectEl: SVGRectElement | null,
  gridPatternId: string,
  grid: GridStyleState,
  cameraState: { tx: number; ty: number; zoom: number },
  panOnly = false,
): void {
  if (!gridPatternEl || typeof document === "undefined") return;
  const zoom = Math.max(0.02, cameraState.zoom);
  const baseStep = Math.max(1, grid.gridSize);

  // Fast path during panning when zoom & grid config have not changed: update patternTransform only
  if (panOnly && grid.lastGridZoom === zoom && gridPatternEl.childElementCount > 0) {
    if (grid.gridType === "dot") {
      const r = Math.max(0.75, Math.min(3, grid.gridThickness * 0.75));
      gridPatternEl.setAttribute("patternTransform", `translate(${cameraState.tx - r}, ${cameraState.ty - r})`);
    } else {
      gridPatternEl.setAttribute("patternTransform", `translate(${cameraState.tx}, ${cameraState.ty})`);
    }
    return;
  }
  grid.lastGridZoom = zoom;

  if (grid.gridType === "dot") {
    let screenStep = baseStep * zoom;
    while (screenStep < 8) screenStep *= 2;
    const r = Math.max(0.75, Math.min(3, grid.gridThickness * 0.75));
    gridPatternEl.setAttribute("width", String(screenStep));
    gridPatternEl.setAttribute("height", String(screenStep));
    gridPatternEl.setAttribute("patternTransform", `translate(${cameraState.tx - r}, ${cameraState.ty - r})`);
    gridPatternEl.innerHTML = "";
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(r));
    dot.setAttribute("cy", String(r));
    dot.setAttribute("r", String(r));
    dot.setAttribute("fill", grid.gridColor);
    gridPatternEl.appendChild(dot);
  } else if (grid.gridType === "mesh") {
    let screenStep = baseStep * zoom;
    while (screenStep < 8) screenStep *= 2;
    gridPatternEl.setAttribute("width", String(screenStep));
    gridPatternEl.setAttribute("height", String(screenStep));
    gridPatternEl.setAttribute("patternTransform", `translate(${cameraState.tx}, ${cameraState.ty})`);
    gridPatternEl.innerHTML = "";
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${screenStep} 0 L 0 0 0 ${screenStep}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", grid.gridColor);
    path.setAttribute("stroke-width", String(Math.max(0.5, grid.gridThickness)));
    gridPatternEl.appendChild(path);
  } else {
    // doubleMesh: major grid every gridSize * gridFactor, optional minor subdivisions
    const factor = Math.max(1, Math.round(grid.gridFactor));
    let majorStep = baseStep * factor * zoom;
    while (majorStep < 10) majorStep *= 2;
    const minorStep = majorStep / factor;

    gridPatternEl.setAttribute("width", String(majorStep));
    gridPatternEl.setAttribute("height", String(majorStep));
    gridPatternEl.setAttribute("patternTransform", `translate(${cameraState.tx}, ${cameraState.ty})`);
    gridPatternEl.innerHTML = "";

    if (
      factor > 1 &&
      minorStep >= 6 &&
      grid.gridMinorThickness > 0 &&
      grid.gridMinorColor !== "transparent" &&
      grid.gridMinorColor !== "none"
    ) {
      let minorD = "";
      for (let i = 1; i < factor; i++) {
        const offset = i * minorStep;
        minorD += `M ${offset} 0 L ${offset} ${majorStep} M 0 ${offset} L ${majorStep} ${offset} `;
      }
      const minorPath = document.createElementNS(SVG_NS, "path");
      minorPath.setAttribute("d", minorD.trim());
      minorPath.setAttribute("fill", "none");
      minorPath.setAttribute("stroke", grid.gridMinorColor);
      minorPath.setAttribute("stroke-width", String(grid.gridMinorThickness));
      gridPatternEl.appendChild(minorPath);
    }

    const majorPath = document.createElementNS(SVG_NS, "path");
    majorPath.setAttribute("d", `M ${majorStep} 0 L 0 0 0 ${majorStep}`);
    majorPath.setAttribute("fill", "none");
    majorPath.setAttribute("stroke", grid.gridColor);
    majorPath.setAttribute("stroke-width", String(Math.max(0.5, grid.gridThickness)));
    gridPatternEl.appendChild(majorPath);
  }

  if (gridRectEl) {
    gridRectEl.setAttribute("fill", grid.gridVisible ? `url(#${gridPatternId})` : "none");
  }
}

export function syncMarqueeDom(marqueeRectEl: SVGRectElement | null, rect: WorldBounds | null): void {
  if (!marqueeRectEl) return;
  if (!rect || (rect.width < 1 && rect.height < 1)) {
    marqueeRectEl.style.display = "none";
    return;
  }
  marqueeRectEl.style.display = "";
  marqueeRectEl.setAttribute("x", String(rect.x));
  marqueeRectEl.setAttribute("y", String(rect.y));
  marqueeRectEl.setAttribute("width", String(rect.width));
  marqueeRectEl.setAttribute("height", String(rect.height));
}

export function syncAlignmentGuidesDom(guidesG: SVGGElement | null, guides: AlignmentGuideLine[]): void {
  if (!guidesG || typeof document === "undefined") return;
  guidesG.innerHTML = "";
  for (const g of guides) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "ms-alignment-guide");
    if (g.orientation === "vertical") {
      line.setAttribute("x1", String(g.position));
      line.setAttribute("x2", String(g.position));
      line.setAttribute("y1", String(g.start));
      line.setAttribute("y2", String(g.end));
    } else {
      line.setAttribute("x1", String(g.start));
      line.setAttribute("x2", String(g.end));
      line.setAttribute("y1", String(g.position));
      line.setAttribute("y2", String(g.position));
    }
    line.setAttribute("stroke", "#ec4899");
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-dasharray", "4 3");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    guidesG.appendChild(line);
  }
}

function setPortIncompatibleTooltip(el: Element, reason: string | null): void {
  if (reason) {
    el.setAttribute?.("data-incompatible-reason", reason);
    const existing = el.querySelector?.("title.ms-incompat-title") as SVGTitleElement | null | undefined;
    if (existing) {
      existing.textContent = reason;
    } else if (el.ownerDocument?.createElementNS && typeof el.appendChild === "function") {
      const titleEl = el.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "title");
      titleEl.setAttribute("class", "ms-incompat-title");
      titleEl.textContent = reason;
      el.appendChild(titleEl);
    }
  } else {
    el.removeAttribute?.("data-incompatible-reason");
    const existing = el.querySelector?.("title.ms-incompat-title");
    existing?.remove?.();
  }
}

function syncIncompatiblePillDom(
  overlayG: SVGGElement | null | undefined,
  target: { x: number; y: number } | null | undefined,
  reason: string | null | undefined,
): void {
  if (!overlayG) return;
  const existing = overlayG.querySelector?.(".ms-incompat-pill");
  if (!target || !reason) {
    existing?.remove?.();
    return;
  }
  const doc = overlayG.ownerDocument;
  if (!doc?.createElementNS) return;
  existing?.remove?.();

  const pillG = doc.createElementNS(SVG_NS, "g");
  pillG.setAttribute("class", "ms-incompat-pill");
  pillG.setAttribute("pointer-events", "none");
  pillG.setAttribute("data-incompatible-reason", reason);

  const label = reason.length > 56 ? `${reason.slice(0, 53)}…` : reason;
  const charWidth = 6.2;
  const padX = 8;
  const pillW = Math.max(84, Math.round(label.length * charWidth + padX * 2));
  const pillH = 22;
  const rx = target.x - pillW / 2;
  const ry = target.y - pillH - 12;

  const rect = doc.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(rx));
  rect.setAttribute("y", String(ry));
  rect.setAttribute("width", String(pillW));
  rect.setAttribute("height", String(pillH));
  rect.setAttribute("rx", "5");
  rect.setAttribute("fill", "rgba(15, 23, 42, 0.94)");
  rect.setAttribute("stroke", "#ef4444");
  rect.setAttribute("stroke-width", "1");

  const text = doc.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(target.x));
  text.setAttribute("y", String(ry + 14.5));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", "#fecaca");
  text.setAttribute("font-size", "11");
  text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
  text.textContent = label;

  pillG.appendChild(rect);
  pillG.appendChild(text);
  overlayG.appendChild(pillG);
}

export function syncMagnetHighlightsDom(
  nodesG: SVGGElement | null,
  preview: WiringPreview | null,
  canConnect?: (sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string) => boolean,
  getRejectionReason?: (
    sourceNodeId: string,
    sourcePortId: string,
    targetNodeId: string,
    targetPortId: string,
  ) => string | null | undefined,
  overlayG?: SVGGElement | null,
): void {
  if (!nodesG) return;
  nodesG.classList?.toggle("ms-wiring-active", Boolean(preview));
  const ports = nodesG.querySelectorAll(".ms-port");
  ports.forEach((el) => {
    el.classList.remove("ms-magnet-source");
    el.classList.remove("ms-magnet-available");
    el.classList.remove("ms-magnet-adsorbed");
    el.classList.remove("ms-magnet-incompatible");
    setPortIncompatibleTooltip(el, null);
    if (!preview) return;
    const cellId = el.closest?.("[data-cell-id]")?.getAttribute("data-cell-id");
    const portId = el.getAttribute("port") ?? el.getAttribute("port-id");
    if (!cellId || !portId) return;
    if (cellId === preview.sourceNodeId && portId === preview.sourcePortId) {
      el.classList.add("ms-magnet-source");
    } else if (
      preview.snappedTarget &&
      preview.snappedTarget.nodeId === cellId &&
      preview.snappedTarget.portId === portId
    ) {
      el.classList.add("ms-magnet-adsorbed");
    } else {
      const ok = canConnect ? canConnect(preview.sourceNodeId, preview.sourcePortId, cellId, portId) : true;
      el.classList.add(ok ? "ms-magnet-available" : "ms-magnet-incompatible");
      if (!ok && getRejectionReason) {
        const reason = getRejectionReason(preview.sourceNodeId, preview.sourcePortId, cellId, portId);
        if (reason) setPortIncompatibleTooltip(el, reason);
      }
    }
  });

  if (preview?.incompatibleTarget && getRejectionReason) {
    const reason = getRejectionReason(
      preview.sourceNodeId,
      preview.sourcePortId,
      preview.incompatibleTarget.nodeId,
      preview.incompatibleTarget.portId,
    );
    syncIncompatiblePillDom(overlayG, preview.incompatibleTarget, reason);
  } else {
    syncIncompatiblePillDom(overlayG, null, null);
  }
}

export function syncHoveredPortDom(
  nodesG: SVGGElement | null,
  hoveredPort: { nodeId: string; portId: string } | null,
): void {
  if (!nodesG) return;
  const ports = nodesG.querySelectorAll(".ms-port");
  ports.forEach((el) => {
    if (!hoveredPort) {
      el.classList.remove("ms-port-hover");
      return;
    }
    const cellId = el.closest?.("[data-cell-id]")?.getAttribute("data-cell-id");
    const portId = el.getAttribute("port") ?? el.getAttribute("port-id");
    if (cellId === hoveredPort.nodeId && portId === hoveredPort.portId) {
      el.classList.add("ms-port-hover");
    } else {
      el.classList.remove("ms-port-hover");
    }
  });
}

export function createInitialGridState(gridOption: unknown): GridStyleState {
  const state: GridStyleState = {
    gridSize: 2,
    gridVisible: true,
    gridType: "doubleMesh",
    gridColor: "rgba(255, 255, 255, 0.12)",
    gridThickness: 1,
    gridFactor: 10,
    gridMinorColor: "transparent",
    gridMinorThickness: 0,
    lastGridZoom: -1,
  };
  if (typeof gridOption === "object" && gridOption !== null) {
    const g = gridOption as {
      size?: number | undefined;
      visible?: boolean | undefined;
      type?: string | undefined;
      args?: unknown;
    };
    state.gridSize = Math.max(1, g.size ?? 2);
    state.gridVisible = g.visible !== false;
    state.gridType = g.type ?? "doubleMesh";
    if ("args" in g) applyGridArgs(state, g.args);
  } else if (typeof gridOption === "number") {
    state.gridSize = Math.max(1, gridOption);
  }
  return state;
}
