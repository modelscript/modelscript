// SPDX-License-Identifier: AGPL-3.0-or-later

import { isMinimapOpen, toggleMinimapHud, updateMinimapHud, type MinimapGraph } from "./minimap.js";

export type DiagramGridMode = "doubleMesh" | "dot" | "mesh" | "none";

export interface GridControlGraphLike {
  disposed?: boolean | undefined;
  options?: Record<string, unknown> | undefined;
  drawGrid(options: Record<string, unknown>): void;
  showGrid?: (() => void) | undefined;
  hideGrid?: (() => void) | undefined;
  setGridSize?: ((size: number) => void) | undefined;
}

export interface ExportableGraphLike {
  container?: { querySelector(selector: string): Element | null } | null | undefined;
}

export interface MinimapControlGraphLike extends MinimapGraph {
  container?: HTMLElement | null | undefined;
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
  const rawBackground = targetGraph.options?.["background"];
  const bgColor =
    rawBackground &&
    typeof rawBackground === "object" &&
    typeof (rawBackground as Record<string, unknown>)["color"] === "string"
      ? ((rawBackground as Record<string, unknown>)["color"] as string)
      : undefined;
  const isDark = options?.isDark !== undefined ? options.isDark : bgColor !== "#ffffff" && bgColor !== "#f8fafc";
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
 * Toggles snap-to-grid on a target graph, restoring `baseGridSize` when enabled
 * or switching to a 1px free-placement raster when disabled.
 */
export function setDiagramSnapOnGraph(
  targetGraph: GridControlGraphLike | null | undefined,
  enabled: boolean,
  baseGridSize = 2,
): void {
  if (!targetGraph || targetGraph.disposed) return;
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
 * Serializes a graph's SVG DOM element into a standalone XML string.
 */
export function exportGraphSvgString(targetGraph: ExportableGraphLike | null | undefined): string {
  if (!targetGraph) return "";
  const svgElem = targetGraph.container?.querySelector("svg");
  return svgElem ? new XMLSerializer().serializeToString(svgElem) : "";
}

/**
 * Renders a graph's SVG onto an offscreen HTML5 canvas and exports a PNG data URL.
 */
export async function exportGraphPngDataUrl(
  targetGraph: ExportableGraphLike | null | undefined,
  scale = 2,
): Promise<string> {
  const svgString = exportGraphSvgString(targetGraph);
  if (!svgString || typeof document === "undefined") return "";
  return new Promise((resolve) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = (img.width || 800) * scale;
      canvas.height = (img.height || 600) * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(scale, scale);
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
