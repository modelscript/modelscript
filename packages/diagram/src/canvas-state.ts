// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ContainerDiagramInstance,
  DiagramHostMessage,
  DiagramRendererOptions,
  DiagramWindow,
  Graph,
  RenderDiagramInput,
} from "./canvas-types.js";
import { getGraphState, isGraphReadOnly, peekGraphState } from "./graph-state.js";
import type { InteractiveWriteAction } from "./interactive.js";

/** Active diagram renderer configuration options. */
let currentOptions: DiagramRendererOptions | null = null;
/** Singleton AntV X6 graph instance for the active diagram canvas. */
let activeGraph: Graph | null = null;
/** ID of the currently selected component node, if any. */
let selectedNodeId: string | null = null;
/** True while renderDiagram is programmatically mutating the X6 graph. */
let isRenderingDiagram = false;
/** Monotonic generation counter to cancel stale delayed recentering callbacks. */
let renderFitGeneration = 0;
/** Cache for on-demand component properties (cleared on diagram re-render). */
const propertyCache = new Map<string, unknown>();
/** Whether the currently rendered diagram is read-only (disables canvas node/edge mutations). */
let isCurrentDiagramReadOnly = false;
/** Active diagram's language or metadata default connector (e.g. "normal" for Modelica, or "rounded" for SysML2). */
let activeDefaultConnector: unknown | undefined;
/** Active diagram metadata (language, wireCrossingStyle, etc.). */
let activeDiagramMetadata: Record<string, unknown> | undefined;

let activeRotateSelectedNodes: ((deltaDegrees: number, targetGraph?: Graph) => void) | null = null;
let activeFlipSelectedNodes: ((axis: "x" | "y", targetGraph?: Graph) => void) | null = null;
let activeSyncAlignmentToolbar: (() => void) | null = null;
let pendingDiagramData: { data: RenderDiagramInput; isDark: boolean } | null = null;

export const containerInstances = new Map<HTMLElement, ContainerDiagramInstance>();
export const graphBaseGridSizes = new WeakMap<Graph, number>();
/** Tracks whether a graph uses Y-up schema coordinates (e.g. Modelica) vs Y-down (e.g. PSCAD). */
export const yUpCoordsByGraph = new WeakMap<Graph, boolean>();
/** Pending `requestAnimationFrame` handles per graph for coalescing solder-dot updates. */
export const solderDotsRafByGraph = new WeakMap<Graph, number>();

export function getActiveGraph(): Graph | null {
  return activeGraph;
}

export function setActiveGraph(g: Graph | null): void {
  activeGraph = g;
}

export function getCurrentOptions(): DiagramRendererOptions | null {
  return currentOptions;
}

export function setCurrentOptions(opts: DiagramRendererOptions | null): void {
  currentOptions = opts;
}

export function getSelectedNodeIdState(): string | null {
  return selectedNodeId;
}

export function setSelectedNodeIdState(id: string | null): void {
  selectedNodeId = id;
}

export function getIsRenderingDiagram(): boolean {
  return isRenderingDiagram;
}

export function setIsRenderingDiagram(rendering: boolean): void {
  isRenderingDiagram = rendering;
}

export function nextRenderFitGeneration(): number {
  return ++renderFitGeneration;
}

export function getRenderFitGeneration(): number {
  return renderFitGeneration;
}

export function getDefaultPropertyCache(): Map<string, unknown> {
  return propertyCache;
}

export function setIsCurrentDiagramReadOnly(readOnly: boolean): void {
  isCurrentDiagramReadOnly = readOnly;
}

export function getActiveDefaultConnector(): unknown {
  return activeDefaultConnector;
}

export function setActiveDefaultConnector(connector: unknown): void {
  activeDefaultConnector = connector;
}

export function setActiveDiagramMetadata(metadata: Record<string, unknown> | undefined): void {
  activeDiagramMetadata = metadata;
}

export function getActiveRotateSelectedNodes(): ((deltaDegrees: number, targetGraph?: Graph) => void) | null {
  return activeRotateSelectedNodes;
}

export function setActiveRotateSelectedNodes(fn: ((deltaDegrees: number, targetGraph?: Graph) => void) | null): void {
  activeRotateSelectedNodes = fn;
}

export function getActiveFlipSelectedNodes(): ((axis: "x" | "y", targetGraph?: Graph) => void) | null {
  return activeFlipSelectedNodes;
}

export function setActiveFlipSelectedNodes(fn: ((axis: "x" | "y", targetGraph?: Graph) => void) | null): void {
  activeFlipSelectedNodes = fn;
}

export function getActiveSyncAlignmentToolbar(): (() => void) | null {
  return activeSyncAlignmentToolbar;
}

export function setActiveSyncAlignmentToolbar(fn: (() => void) | null): void {
  activeSyncAlignmentToolbar = fn;
}

export function getPendingDiagramData(): { data: RenderDiagramInput; isDark: boolean } | null {
  return pendingDiagramData;
}

export function setPendingDiagramData(pending: { data: RenderDiagramInput; isDark: boolean } | null): void {
  pendingDiagramData = pending;
}

export function getOptionsForGraph(g?: Graph | null): DiagramRendererOptions | null {
  if (g?.container && containerInstances.has(g.container)) {
    return containerInstances.get(g.container)!.options;
  }
  return currentOptions;
}

export function getMetadataForGraph(g?: Graph | null): Record<string, unknown> | null {
  const gs = peekGraphState(g);
  if (gs?.metadata !== undefined) {
    return gs.metadata ?? null;
  }
  if (g?.container && containerInstances.has(g.container)) {
    return containerInstances.get(g.container)!.metadata ?? null;
  }
  return activeDiagramMetadata ?? null;
}

export function getReadOnlyForGraph(g?: Graph | null): boolean {
  return isGraphReadOnly(g ?? activeGraph, isCurrentDiagramReadOnly);
}

export function getDefaultConnectorForGraph(g?: Graph | null): unknown {
  const target = g ?? activeGraph;
  const gs = peekGraphState(target);
  return gs?.defaultConnector ?? activeDefaultConnector ?? getOptionsForGraph(target)?.defaultConnector;
}

export function getPropertyCacheForGraph(g?: Graph | null): Map<string, unknown> {
  const target = g ?? activeGraph;
  return target ? getGraphState(target)!.propertyCache : propertyCache;
}

export function getSelectedNodeIdForGraph(g?: Graph | null): string | null {
  const target = g ?? activeGraph;
  const gs = peekGraphState(target);
  return gs ? gs.selectedNodeId : selectedNodeId;
}

export function setSelectedNodeIdForGraph(g: Graph | null | undefined, id: string | null): void {
  const target = g ?? activeGraph;
  selectedNodeId = id;
  if (target) {
    getGraphState(target)!.selectedNodeId = id;
    if (target.container && containerInstances.has(target.container)) {
      containerInstances.get(target.container)!.selectedNodeId = id;
    }
  }
}

/**
 * Sets or updates the active configuration options and callbacks for the diagram renderer.
 */
export function setDiagramOptions(options: DiagramRendererOptions): void {
  currentOptions = options;
  if (options.container && containerInstances.has(options.container)) {
    const inst = containerInstances.get(options.container)!;
    inst.options = options;
    activeGraph = inst.graph;
  }
}

/**
 * Dispatches a structural or spatial diagram edit action to the registered `onAction` callback.
 */
export function enqueueDiagramAction(action: Record<string, unknown> | InteractiveWriteAction, g?: Graph | null): void {
  const opts = getOptionsForGraph(g);
  if (opts?.onAction) opts.onAction(action);
}

/**
 * Forwards host-bound messages (`undo`, `redo`, `getProperties`, `revealSource`, `navigateTo`)
 * to the appropriate callback in `currentOptions`.
 */
export function postMessageToHost(msg: DiagramHostMessage, g?: Graph | null): void {
  const opts = getOptionsForGraph(g);
  if (msg.type === "undo" && opts?.onUndo) {
    opts.onUndo();
    return;
  }
  if (msg.type === "redo" && opts?.onRedo) {
    opts.onRedo();
    return;
  }
  if (msg.type === "getProperties") {
    if (opts?.onMessage) {
      opts.onMessage(msg);
      return;
    }
    if (opts?.onShowProperties && msg.componentName) {
      opts.onShowProperties(msg.componentName, undefined, true);
      return;
    }
  }
  // Forward all other messages (revealSource, navigateTo, changeDiagramType, etc.)
  if (opts?.onMessage) opts.onMessage(msg);
}

export function toSchemaY(targetGraph: Graph, y: number): number {
  const isYUp = yUpCoordsByGraph.get(targetGraph) ?? true;
  return Math.round(isYUp ? -y : y);
}

/**
 * Updates the breadcrumb bar in the webview if present.
 */
export function updateBreadcrumbs(breadcrumbs?: { id: string; label: string }[]): void {
  if (typeof document === "undefined") return;
  const bar = document.getElementById("breadcrumb-bar");
  if (!bar) return;
  if (!breadcrumbs || breadcrumbs.length <= 1) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }
  bar.style.display = "flex";
  bar.innerHTML = "";

  breadcrumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "›";
      bar.appendChild(sep);
    }
    const item = document.createElement("span");
    const isLast = idx === breadcrumbs.length - 1;
    item.className = `breadcrumb-item${isLast ? " active" : ""}`;
    item.textContent = crumb.label;
    if (!isLast) {
      item.onclick = () => {
        postMessageToHost({
          type: "navigateTo",
          className: crumb.id,
          diagramType: "All",
        });
      };
    }
    bar.appendChild(item);
  });

  const backBtn = document.createElement("button");
  backBtn.className = "breadcrumb-back-btn";
  backBtn.innerHTML = "◀ Back to Overview";
  backBtn.onclick = () => {
    postMessageToHost({
      type: "navigateTo",
      className: breadcrumbs[0]?.id ?? "",
      diagramType: "All",
    });
  };
  bar.appendChild(backBtn);
}

/**
 * Invokes the registered `onShowProperties` callback to display or update the component inspector.
 */
export function showProperties(
  nodeData: { id: string; properties?: unknown; isLoading?: boolean | undefined },
  g?: Graph | null,
): void {
  if (nodeData.id && nodeData.properties) {
    const p = nodeData.properties as { schema?: unknown; parameters?: unknown };
    if (p.schema || p.parameters) {
      getPropertyCacheForGraph(g).set(nodeData.id, nodeData.properties);
    }
  }
  const opts = getOptionsForGraph(g);
  if (opts?.onShowProperties) {
    opts.onShowProperties(nodeData.id, nodeData.properties, nodeData.isLoading);
  }
}

/**
 * Disposes the AntV X6 graph instance for `targetContainer` (or the active graph if omitted)
 * and restores the remaining active container instance, if any.
 */
export function disposeDiagram(targetContainer?: HTMLElement | null): void {
  const clearOwnedGlobals = (disposedGraph: Graph) => {
    const rafId = solderDotsRafByGraph.get(disposedGraph);
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      solderDotsRafByGraph.delete(disposedGraph);
    }
    if (activeGraph === disposedGraph) {
      pendingDiagramData = null;
      const remaining = Array.from(containerInstances.values()).pop();
      activeGraph = remaining?.graph ?? null;
      currentOptions = remaining?.options ?? null;
      selectedNodeId = remaining?.selectedNodeId ?? null;
      if (!activeGraph && typeof window !== "undefined") {
        const win = window as unknown as DiagramWindow;
        delete win.__startPlacement;
        delete win.__movePlacementGhost;
        delete win.__handlePlacementClick;
        delete win.__handleDragEnd;
        delete win.__lastCanvasPos;
      }
    }
  };

  if (targetContainer) {
    const inst = containerInstances.get(targetContainer);
    if (inst) {
      inst.cleanupListeners?.();
      try {
        inst.graph.dispose();
      } catch {
        // ignore dispose errors
      }
      containerInstances.delete(targetContainer);
      clearOwnedGlobals(inst.graph);
    }
    return;
  }

  if (activeGraph) {
    const disposed = activeGraph;
    const container = disposed.container;
    const inst = container ? containerInstances.get(container) : undefined;
    inst?.cleanupListeners?.();
    if (container) containerInstances.delete(container);
    try {
      disposed.dispose();
    } catch {
      // ignore dispose errors
    }
    clearOwnedGlobals(disposed);
  } else {
    pendingDiagramData = null;
    currentOptions = null;
  }
}

/**
 * Returns the graph instance strictly bound to `targetContainer`, or `null` if none exists.
 * Unlike {@link getGraph}, this never falls back to another container's global singleton graph.
 */
export function getGraphFor(targetContainer: HTMLElement | null | undefined): Graph | null {
  if (!targetContainer) return null;
  const inst = containerInstances.get(targetContainer);
  if (!inst || inst.graph.disposed) return null;
  return inst.graph;
}

/**
 * Returns the graph instance for `targetContainer` (or the active graph if omitted),
 * or `null` if none is initialized.
 */
export function getGraph(targetContainer?: HTMLElement | null): Graph | null {
  if (targetContainer && containerInstances.has(targetContainer)) {
    return containerInstances.get(targetContainer)!.graph;
  }
  return activeGraph;
}
