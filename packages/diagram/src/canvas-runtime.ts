// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  autoLayoutDiagram as coreAutoLayoutDiagram,
  autoLayoutDiagramAsync as coreAutoLayoutDiagramAsync,
  layoutWithElk as coreLayoutWithElk,
  type AutoLayoutOptions,
} from "./auto-layout.js";
import { updateSolderDots } from "./canvas-edge-routing.js";
import { renderDiagram } from "./canvas-render.js";
import {
  containerInstances,
  enqueueDiagramAction,
  getActiveFlipSelectedNodes,
  getActiveGraph,
  getActiveRotateSelectedNodes,
  getOptionsForGraph,
  getPendingDiagramData,
  getPropertyCacheForGraph,
  getReadOnlyForGraph,
  getSelectedNodeIdForGraph,
  graphBaseGridSizes,
  postMessageToHost,
  setPendingDiagramData,
  showProperties,
} from "./canvas-state.js";
import type { Cell, DiagramWindow, Graph, Node } from "./canvas-types.js";
import {
  exportGraphPngDataUrl,
  exportGraphSvgString,
  isMinimapVisibleOnContainer,
  setDiagramGridOnGraph,
  setDiagramSnapOnGraph,
  toggleMinimapOnContainer,
  type DiagramGridMode,
} from "./grid-controls.js";
import { groupSelectedNodesOnGraph, ungroupSelectedNodesOnGraph, type GroupableGraphLike } from "./group-actions.js";
import { defaultInteractiveStateManager, type InteractiveWriteAction } from "./interactive.js";
import * as Spinner from "./spinner.js";
import { animateCells, type SimulationFrame } from "./telemetry.js";

// Handle deferred diagram updates to avoid interrupting active interactions
let isMouseDown = false;

if (typeof document !== "undefined") {
  const flushPendingDiagramOnRelease = () => {
    isMouseDown = false;
    const pd = getPendingDiagramData();
    if (pd) {
      setPendingDiagramData(null);
      if (pd.data?.isLoading) {
        Spinner.show();
      }
      renderDiagram(pd.data, pd.isDark);
      if (!pd.data?.isLoading) {
        Spinner.hide();
      }
    }
  };

  document.addEventListener(
    "mousedown",
    () => {
      isMouseDown = true;
    },
    true,
  );

  document.addEventListener("mouseup", flushPendingDiagramOnRelease, true);
  document.addEventListener("pointerup", flushPendingDiagramOnRelease, true);
  document.addEventListener("pointercancel", flushPendingDiagramOnRelease, true);
  if (typeof window !== "undefined") {
    window.addEventListener("blur", flushPendingDiagramOnRelease);
  }

  // Initialize Diagram Type Select
  const diagramSelect = document.getElementById("diagramTypeSelect") as HTMLSelectElement;
  if (diagramSelect) {
    diagramSelect.addEventListener("change", (e) => {
      Spinner.show();
      postMessageToHost({ type: "changeDiagramType", diagramType: (e.target as HTMLSelectElement).value });
    });
  }
}

/**
 * Automatically calculates and applies an optimal spatial layout for diagram components.
 * Preserves the background coordinate system, axes, and non-component annotations.
 *
 * @param targetGraph Optional specific X6 Graph instance. Defaults to the active singleton graph.
 * @param options Optional layout configuration overrides.
 * @returns `true` if layout was computed and applied; `false` if skipped (e.g. no layoutable nodes).
 */
export function autoLayoutDiagram(targetGraph?: Graph | null, options?: AutoLayoutOptions): boolean {
  const g = targetGraph ?? getActiveGraph();
  if (!g || g.disposed) return false;
  return coreAutoLayoutDiagram(g as unknown as Parameters<typeof coreAutoLayoutDiagram>[0], {
    ...options,
    onAction: (act) => enqueueDiagramAction(act, g),
    updateSolderDots: (target) => updateSolderDots(target as unknown as Graph),
  });
}

/**
 * Asynchronously calculates and applies an optimal spatial layout for diagram components.
 * For large models (>= 30 components), displays a progress indicator and yields to the
 * browser paint loop.
 *
 * @param targetGraph Optional specific X6 Graph instance. Defaults to the active singleton graph.
 * @param options Optional layout configuration overrides.
 * @returns Promise resolving to `true` if layout was computed and applied; `false` if skipped.
 */
export async function autoLayoutDiagramAsync(
  targetGraph?: Graph | null,
  options?: AutoLayoutOptions,
): Promise<boolean> {
  const g = targetGraph ?? getActiveGraph();
  if (!g || g.disposed) return false;
  return coreAutoLayoutDiagramAsync(g as unknown as Parameters<typeof coreAutoLayoutDiagramAsync>[0], {
    ...options,
    onAction: (act) => enqueueDiagramAction(act, g),
    updateSolderDots: (target) => updateSolderDots(target as unknown as Graph),
  });
}

/**
 * Multi-pass Sugiyama layered orthogonal layout with port crossing minimization.
 */
export function layoutWithElk(targetGraph?: Graph | null, options?: AutoLayoutOptions): boolean {
  const g = targetGraph ?? getActiveGraph();
  if (!g || g.disposed) return false;
  return coreLayoutWithElk(g as unknown as Parameters<typeof coreLayoutWithElk>[0], {
    ...options,
    onAction: (act) => enqueueDiagramAction(act, g),
    updateSolderDots: (target) => updateSolderDots(target as unknown as Graph),
  });
}

/**
 * Groups selected nodes inside a container group node while keeping drag-to-reparent off.
 */
export function groupSelectedNodes(targetGraph?: Graph | null): boolean {
  const g = targetGraph ?? getActiveGraph();
  if (!g || g.disposed) return false;
  const grp = groupSelectedNodesOnGraph(g as unknown as GroupableGraphLike, {
    readOnly: getReadOnlyForGraph(g),
  });
  return grp !== null;
}

/**
 * Ungroups any selected container group nodes while keeping component coordinates intact.
 */
export function ungroupSelectedNodes(targetGraph?: Graph | null): boolean {
  const g = targetGraph ?? getActiveGraph();
  if (!g || g.disposed) return false;
  const ungrouped = ungroupSelectedNodesOnGraph(g as unknown as GroupableGraphLike, {
    readOnly: getReadOnlyForGraph(g),
  });
  return ungrouped.length > 0;
}

/**
 * Applies a live simulation telemetry state frame to animate diagram nodes and edges.
 */
export function applySimulationFrame(
  stateVector: Record<string, number> | Float64Array,
  varIndexMap?: Map<string, number> | Record<string, number>,
): void {
  const graph = getActiveGraph();
  if (!graph) return;
  animateCells({ nodes: graph.getNodes(), edges: graph.getEdges() }, stateVector, varIndexMap);
}

let activeSimulationBatchId: number | null = null;

/**
 * Applies and plays back a batch of simulation telemetry frames over time at the requested FPS.
 */
export function applySimulationBatch(frames: SimulationFrame[], fps = 30): void {
  const graph = getActiveGraph();
  if (!graph || !Array.isArray(frames) || frames.length === 0) return;
  if (typeof window === "undefined" || !window.requestAnimationFrame) {
    const last = frames[frames.length - 1];
    if (last) {
      applySimulationFrame(last.stateVector, last.varIndexMap);
    }
    return;
  }

  if (activeSimulationBatchId !== null) {
    cancelAnimationFrame(activeSimulationBatchId);
    activeSimulationBatchId = null;
  }

  let frameIdx = 0;
  let lastTime = 0;
  const interval = 1000 / Math.max(1, Math.min(120, fps));

  function tick(timestamp: number) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = timestamp - lastTime;
    if (elapsed >= interval) {
      lastTime = timestamp;
      const frame = frames[frameIdx];
      if (frame) {
        applySimulationFrame(frame.stateVector, frame.varIndexMap);
      }
      frameIdx++;
    }
    if (frameIdx < frames.length) {
      activeSimulationBatchId = requestAnimationFrame(tick);
    } else {
      activeSimulationBatchId = null;
    }
  }

  activeSimulationBatchId = requestAnimationFrame(tick);
}

/**
 * Toggles the collapsed/expanded visual state of a composite group container node,
 * hiding or restoring its embedded child nodes and resizing the container header.
 */
export function toggleGroupNodeCollapse(node: Node | null | undefined): void {
  if (!node) return;
  const data = node.getData?.() || {};
  const isCollapsed = Boolean(data.collapsed);
  const children = node.getChildren?.() || [];

  if (!isCollapsed) {
    const currentSize = typeof node.size === "function" ? node.size() : { width: 240, height: 180 };
    node.setData?.({ ...data, collapsed: true, origWidth: currentSize.width, origHeight: currentSize.height });
    children.forEach((c: Cell) => c.setVisible?.(false));
    node.resize?.(Math.max(180, currentSize.width), 40);
  } else {
    node.setData?.({ ...data, collapsed: false });
    node.resize?.(data.origWidth || 240, data.origHeight || 180);
    children.forEach((c: Cell) => c.setVisible?.(true));
  }
}

/**
 * Serializes the active diagram's SVG DOM element into a standalone XML string.
 */
export function exportDiagramSvg(): string {
  return exportGraphSvgString(getActiveGraph());
}

/**
 * Renders the active diagram SVG onto an offscreen HTML5 canvas and exports a PNG data URL.
 */
export async function exportDiagramPng(scale = 2): Promise<string> {
  return exportGraphPngDataUrl(getActiveGraph(), scale);
}

/**
 * Programmatically triggers an interactive widget binding (toggle, momentary button, slider, numeric input)
 * on a diagram component node and dispatches the resulting parameter write action.
 */
export function triggerInteractiveInput(
  nodeId: string,
  variableName: string,
  eventType: "click" | "mousedown" | "mouseup" | "input",
  inputValue?: unknown,
): InteractiveWriteAction | null {
  const graph = getActiveGraph();
  if (!graph) return null;
  const node = graph.getCellById(nodeId);
  if (!node || !node.isNode()) return null;
  const interactiveBindings = node.getData()?.interactive;
  if (!Array.isArray(interactiveBindings)) return null;
  const binding = interactiveBindings.find((b) => b.variableName === variableName);
  if (!binding) return null;
  const action = defaultInteractiveStateManager.handleInteraction(node, binding, eventType, inputValue);
  if (action) {
    enqueueDiagramAction(action);
  }
  return action;
}

/**
 * Dynamically switches the canvas background grid style (`doubleMesh`, `dot`, `mesh`, or `none`).
 */
export function setDiagramGrid(mode: DiagramGridMode, g?: Graph | null): void {
  const targetGraph = g ?? getActiveGraph();
  const opts = getOptionsForGraph(targetGraph);
  setDiagramGridOnGraph(targetGraph, mode, { isDark: opts?.isDark });
}

/**
 * Toggles snap-to-grid on the active diagram canvas.
 */
export function setDiagramSnap(enabled: boolean, g?: Graph | null): void {
  const targetGraph = g ?? getActiveGraph();
  if (!targetGraph) return;
  setDiagramSnapOnGraph(targetGraph, enabled, graphBaseGridSizes.get(targetGraph) ?? 2);
}

/**
 * Toggles the Minimap HUD for the active diagram.
 */
export function toggleMinimap(container?: HTMLElement | null): boolean {
  const targetGraph = (container ? containerInstances.get(container)?.graph : undefined) ?? getActiveGraph();
  return toggleMinimapOnContainer(container, targetGraph);
}

/**
 * Returns true if the Minimap HUD is currently open.
 */
export function isMinimapVisible(container?: HTMLElement | null): boolean {
  return isMinimapVisibleOnContainer(container, getActiveGraph()?.container);
}

/**
 * Rotates the currently selected nodes on the target graph (or active graph)
 * by `deltaDegrees`, re-routing all connected edges and updating solder dots.
 */
export function rotateSelectedNodes(deltaDegrees = 90, targetGraph?: Graph | null): void {
  const g = targetGraph ?? getActiveGraph();
  if (!g || g.disposed) return;
  if (g.container && containerInstances.has(g.container)) {
    const inst = containerInstances.get(g.container);
    if (inst?.rotateSelectedNodes) {
      inst.rotateSelectedNodes(deltaDegrees);
      return;
    }
  }
  const activeRotate = getActiveRotateSelectedNodes();
  if (activeRotate) {
    activeRotate(deltaDegrees, g);
  }
}

/**
 * Flips the currently selected nodes on the target graph (or active graph)
 * along `axis` ('x' for horizontal, 'y' for vertical mirror), re-routing all connected edges and updating solder dots.
 */
export function flipSelectedNodes(axis: "x" | "y" = "x", targetGraph?: Graph | null): void {
  const g = targetGraph ?? getActiveGraph();
  if (!g || g.disposed) return;
  if (g.container && containerInstances.has(g.container)) {
    const inst = containerInstances.get(g.container);
    if (inst?.flipSelectedNodes) {
      inst.flipSelectedNodes(axis);
      return;
    }
  }
  const activeFlip = getActiveFlipSelectedNodes();
  if (activeFlip) {
    activeFlip(axis, g);
  }
}

// Listen for messages from the extension host
if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    const trustedSource = event.source === window || event.source === window.parent || event.source === null;
    const trustedOrigin =
      !event.origin ||
      event.origin === window.location.origin ||
      event.origin.startsWith("vscode-webview://") ||
      event.origin === "null";
    if (!trustedSource && !trustedOrigin) return;
    const message = event.data;
    if (!message || typeof message !== "object" || typeof message.type !== "string") return;
    const win = window as unknown as DiagramWindow;
    const graph = getActiveGraph();
    switch (message.type) {
      case "loading": {
        Spinner.show();
        break;
      }
      case "stopLoading": {
        Spinner.hide();
        break;
      }
      case "diagramData": {
        if (isMouseDown) {
          setPendingDiagramData({ data: message.data, isDark: message.isDark ?? true });
        } else {
          if (message.data?.isLoading) {
            Spinner.show();
          }
          renderDiagram(message.data, message.isDark ?? true);
          if (!message.data?.isLoading) {
            Spinner.hide();
          }
        }
        break;
      }
      case "simulationFrame": {
        if (message.stateVector) {
          applySimulationFrame(message.stateVector, message.varIndexMap);
        }
        break;
      }
      case "simulationBatch": {
        if (Array.isArray(message.frames)) {
          applySimulationBatch(message.frames, message.fps);
        }
        break;
      }
      case "dragEnd": {
        if (!graph) return;
        win.__handleDragEnd?.();
        break;
      }
      case "workbenchDragOver": {
        if (!graph) return;
        const { clientX, clientY } = message;
        if (typeof clientX === "number" && typeof clientY === "number") {
          const p = graph.clientToLocal(clientX, clientY);
          const snappedX = Math.round(p.x / 20) * 20;
          const snappedY = Math.round(p.y / 20) * 20;
          win.__movePlacementGhost?.(snappedX, snappedY);
        }
        break;
      }
      case "workbenchDrop": {
        if (!graph) return;
        const { clientX, clientY } = message;
        if (typeof clientX === "number" && typeof clientY === "number") {
          const p = graph.clientToLocal(clientX, clientY);
          win.__handlePlacementClick?.(p.x, p.y);
        } else if (
          win.__lastCanvasPos &&
          typeof win.__lastCanvasPos.x === "number" &&
          typeof win.__lastCanvasPos.y === "number"
        ) {
          // __lastCanvasPos is already in local/world graph coordinates
          win.__handlePlacementClick?.(win.__lastCanvasPos.x, win.__lastCanvasPos.y);
        } else {
          win.__handleDragEnd?.();
        }
        break;
      }
      case "startPlacement": {
        if (!graph) return;
        const { className, classKind, iconSvg, isDrag } = message;
        if (!className) break;
        win.__startPlacement?.({ className, classKind, iconSvg, isDrag });
        break;
      }
      case "empty": {
        Spinner.hide();
        const placeholder = document.getElementById("placeholder");
        if (placeholder) {
          placeholder.style.display = "flex";
          placeholder.innerHTML = `
          <div style="text-align: center; max-width: 400px; padding: 20px;">
            <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.4;">📐</div>
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">No diagram data available</div>
            <div style="font-size: 12px; opacity: 0.7; line-height: 1.5;">
              This model may not have graphical annotations, or the class could not be resolved.
              Try adding <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 2px;">annotation(Diagram(...))</code> to your model.
            </div>
          </div>`;
        }
        if (graph) {
          graph.clearCells();
        }
        break;
      }

      case "autoLayout": {
        if (!graph) return;
        void autoLayoutDiagramAsync(graph);
        break;
      }

      case "error": {
        Spinner.hide();
        const placeholder2 = document.getElementById("placeholder");
        if (placeholder2) {
          placeholder2.style.display = "flex";
          const errorMsg = String(message.message || "Unknown error")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          placeholder2.innerHTML = `
          <div style="text-align: center; max-width: 500px; padding: 20px;">
            <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--vscode-errorForeground, #f48771);">Diagram Error</div>
            <div style="font-size: 12px; opacity: 0.8; line-height: 1.5; text-align: left; background: rgba(128,128,128,0.1); padding: 12px; border-radius: 4px; max-height: 200px; overflow-y: auto; font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; word-break: break-word;">${errorMsg}</div>
          </div>`;
        }
        break;
      }

      case "componentProperties": {
        // On-demand property response: update the properties panel with full data
        const { componentName, properties: fullProps } = message;
        if (fullProps) {
          getPropertyCacheForGraph(graph).set(componentName, fullProps);
          if (getSelectedNodeIdForGraph(graph) === componentName) {
            showProperties({ id: componentName, properties: fullProps }, graph);
          }
        }
        break;
      }

      case "setLanguage": {
        const toolbar = document.getElementById("toolbar");
        if (toolbar) {
          toolbar.style.display = message.language === "sysml" ? "flex" : "none";
        }
        const isPscad = Boolean(message.language && /^(pscad|pscx|pslx|pswx|psmx)$/i.test(message.language));
        const canvasHud = document.getElementById("canvas-hud");
        if (canvasHud) {
          canvasHud.style.display = isPscad ? "flex" : "none";
        }
        break;
      }

      case "setDiagramType": {
        const diagramTypeSelect = document.getElementById("diagramTypeSelect") as HTMLSelectElement | null;
        if (diagramTypeSelect && message.diagramType) {
          diagramTypeSelect.value = message.diagramType;
        }
        break;
      }
    }
  });
}
