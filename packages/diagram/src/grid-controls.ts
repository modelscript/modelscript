// SPDX-License-Identifier: AGPL-3.0-or-later

import { isMinimapOpen, toggleMinimapHud, updateMinimapHud, type MinimapGraph } from "./minimap.js";
import { serializeInteractiveGraphSvg } from "./svg-renderer.js";

export type DiagramGridMode = "doubleMesh" | "dot" | "mesh" | "none";

export interface GridControlGraphLike {
  disposed?: boolean | undefined;
  options?: Record<string, unknown> | undefined;
  container?: HTMLElement | null | undefined;
  drawGrid(options: Record<string, unknown>): void;
  showGrid?: (() => void) | undefined;
  hideGrid?: (() => void) | undefined;
  setGridSize?: ((size: number) => void) | undefined;
  setSnapEnabled?: ((enabled: boolean) => void) | undefined;
  setSnapStep?: ((step: number) => void) | undefined;
}

export interface ExportableGraphLike {
  container?: { querySelector(selector: string): Element | null; style?: CSSStyleDeclaration } | null | undefined;
  options?: Record<string, unknown> | undefined;
}

export interface MinimapControlGraphLike extends MinimapGraph {
  container?: HTMLElement | null | undefined;
}

function detectDarkBackground(bgColor?: string): boolean {
  if (!bgColor) return false;
  const c = bgColor.trim().toLowerCase();
  if (!c || c === "transparent" || c === "none") return false;
  if (c === "#ffffff" || c === "#fff" || c === "white" || c === "#f8fafc" || c === "#f1f5f9") return false;
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const r = hex.length === 3 ? parseInt(hex[0]! + hex[0]!, 16) : parseInt(hex.slice(0, 2), 16);
    const g = hex.length === 3 ? parseInt(hex[1]! + hex[1]!, 16) : parseInt(hex.slice(2, 4), 16);
    const b = hex.length === 3 ? parseInt(hex[2]! + hex[2]!, 16) : parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (rgbMatch) {
    return (0.299 * Number(rgbMatch[1]) + 0.587 * Number(rgbMatch[2]) + 0.114 * Number(rgbMatch[3])) / 255 < 0.5;
  }
  return true;
}

/**
 * Dynamically switches the canvas background grid style on a target graph.
 */
export function setDiagramGridOnGraph(
  targetGraph: GridControlGraphLike | null | undefined,
  mode: DiagramGridMode,
  options?: { isDark?: boolean | undefined },
): void {
  if (!targetGraph || targetGraph.disposed) return;
  if (mode === "none") {
    targetGraph.hideGrid?.();
    return;
  }
  targetGraph.showGrid?.();
  const containerBg = targetGraph.container?.style?.backgroundColor;
  const rawBackground = targetGraph.options?.["background"];
  const optBgColor =
    rawBackground &&
    typeof rawBackground === "object" &&
    typeof (rawBackground as Record<string, unknown>)["color"] === "string"
      ? ((rawBackground as Record<string, unknown>)["color"] as string)
      : undefined;
  const bgColor = containerBg || optBgColor;
  const isDark = options?.isDark !== undefined ? options.isDark : detectDarkBackground(bgColor);
  const gridColor = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.12)";
  if (mode === "dot") {
    targetGraph.drawGrid({
      type: "dot",
      args: { color: gridColor, thickness: 1.5 },
    });
  } else if (mode === "mesh") {
    targetGraph.drawGrid({
      type: "mesh",
      args: { color: gridColor, thickness: 1 },
    });
  } else if (mode === "doubleMesh") {
    targetGraph.drawGrid({
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    });
  }
}

/**
 * Toggles snap-to-grid on a target graph without distorting the rendered visual grid pitch.
 */
export function setDiagramSnapOnGraph(
  targetGraph: GridControlGraphLike | null | undefined,
  enabled: boolean,
  baseGridSize = 2,
): void {
  if (!targetGraph || targetGraph.disposed) return;
  if (typeof targetGraph.setSnapEnabled === "function") {
    targetGraph.setSnapEnabled(enabled);
    if (enabled && typeof targetGraph.setSnapStep === "function") {
      targetGraph.setSnapStep(baseGridSize);
    }
    return;
  }
  targetGraph.setGridSize?.(enabled ? baseGridSize : 1);
}

/**
 * Toggles the Minimap HUD for a container element and refreshes its radar viewport
 * from `targetGraph` when opened.
 */
export function toggleMinimapOnContainer(
  container: HTMLElement | null | undefined,
  targetGraph?: MinimapControlGraphLike | null | undefined,
): boolean {
  const c = container ?? targetGraph?.container;
  if (!c) return false;
  const isOpened = toggleMinimapHud(c);
  if (isOpened && targetGraph && !targetGraph.disposed) {
    const hud = c.querySelector("#modelscript-minimap-hud") as HTMLElement | null;
    if (hud) {
      updateMinimapHud(hud, targetGraph);
    }
  }
  return isOpened;
}

/**
 * Returns true if the Minimap HUD is currently visible inside the target container.
 */
export function isMinimapVisibleOnContainer(
  container: HTMLElement | null | undefined,
  fallbackContainer?: HTMLElement | null | undefined,
): boolean {
  const c = container ?? fallbackContainer;
  if (!c) return false;
  return isMinimapOpen(c);
}

/**
 * Serializes a graph's SVG DOM element into a standalone, content-fitted XML string.
 */
export function exportGraphSvgString(
  targetGraph: ExportableGraphLike | null | undefined,
  options?: { background?: string | undefined; padding?: number | undefined },
): string {
  if (!targetGraph) return "";
  const svgElem = (targetGraph.container?.querySelector("svg.ms-graph-svg") ??
    targetGraph.container?.querySelector("svg")) as SVGSVGElement | null;
  if (!svgElem) return "";
  const bg =
    options?.background ??
    (targetGraph.container?.style?.backgroundColor && targetGraph.container.style.backgroundColor !== "transparent"
      ? targetGraph.container.style.backgroundColor
      : undefined);
  return serializeInteractiveGraphSvg(svgElem, { background: bg, padding: options?.padding });
}

/**
 * Renders a graph's SVG onto an offscreen HTML5 canvas and exports a DPR-aware PNG data URL.
 */
export async function exportGraphPngDataUrl(
  targetGraph: ExportableGraphLike | null | undefined,
  scale?: number,
): Promise<string> {
  const resolvedScale = scale ?? Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
  const svgString = exportGraphSvgString(targetGraph);
  if (!svgString || typeof document === "undefined") return "";
  return new Promise((resolve) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = (img.width || 800) * resolvedScale;
      canvas.height = (img.height || 600) * resolvedScale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(resolvedScale, resolvedScale);
        ctx.drawImage(img, 0, 0);
      }
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("");
    };
    img.src = url;
  });
}
