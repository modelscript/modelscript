// SPDX-License-Identifier: AGPL-3.0-or-later

import { applyNodeFlipVisuals } from "./alignment.js";
import { scheduleUpdateSolderDots, updateSolderDots } from "./canvas-edge-routing.js";
import { initGraph } from "./canvas-init.js";
import { prepareDiagramRenderModel } from "./canvas-render-normalize.js";
import {
  containerInstances,
  getActiveGraph,
  getActiveSyncAlignmentToolbar,
  getDefaultPropertyCache,
  getIsRenderingDiagram,
  getOptionsForGraph,
  getPropertyCacheForGraph,
  getRenderFitGeneration,
  getSelectedNodeIdForGraph,
  graphBaseGridSizes,
  nextRenderFitGeneration,
  postMessageToHost,
  setActiveDefaultConnector,
  setActiveDiagramMetadata,
  setIsCurrentDiagramReadOnly,
  setIsRenderingDiagram,
  setSelectedNodeIdState,
  showProperties,
  updateBreadcrumbs,
  yUpCoordsByGraph,
} from "./canvas-state.js";
import type { Graph, RenderDiagramInput, RenderDiagramNodeInput } from "./canvas-types.js";
import {
  clearActiveDropPlaceholder,
  dropComponentGhost,
  getActiveDropPlaceholder,
  getTypicalNodeSize,
  isEphemeralDiagramNode,
} from "./drop-placeholder.js";
import { beginGraphRenderState, getGraphState } from "./graph-state.js";
import { updateMinimapHud } from "./minimap.js";
import type { PointLike } from "./port-router.js";
import { resolveEdgeSelectionStyle, updateNodeVisualOnResize, type EdgeSelectionStyle } from "./selection-handles.js";
import { scheduleViewportCulling } from "./viewport-culling.js";

/**
 * Renders (or incrementally diffs and updates) a polyglot diagram model onto the AntV X6 graph canvas,
 * executing hierarchical Dagre/sequence/swimlane/TSM layouts and updating topological solder dots.
 */
export function renderDiagram(data: RenderDiagramInput, isDark: boolean): void {
  const g = initGraph(isDark);
  if (!g) return;

  setIsRenderingDiagram(true);
  try {
    renderDiagramInternal(g, data, isDark);
  } finally {
    setIsRenderingDiagram(false);
  }
}

export function renderDiagramInternal(g: Graph, data: RenderDiagramInput, isDark: boolean): void {
  const prevRendering = getIsRenderingDiagram();
  setIsRenderingDiagram(true);
  try {
    renderDiagramInternalBody(g, data, isDark);
  } finally {
    setIsRenderingDiagram(prevRendering);
  }
}

function renderDiagramInternalBody(g: Graph, data: RenderDiagramInput, isDark: boolean): void {
  const gs = getGraphState(g)!;
  const isReadOnly = Boolean(data.readOnly || data.metadata?.readOnly);
  const isLayoutEditable = Boolean(data.metadata?.["layoutEditable"]);
  const opts = getOptionsForGraph(g);
  const resolvedConnector = data.metadata?.defaultConnector ?? opts?.defaultConnector;
  const resolvedMetadata = data.metadata as Record<string, unknown> | undefined;

  gs.readOnly = isReadOnly;
  gs.layoutEditable = isLayoutEditable;
  gs.defaultConnector = resolvedConnector;
  gs.metadata = resolvedMetadata;
  g.setReadOnly?.(isReadOnly && !isLayoutEditable);

  setIsCurrentDiagramReadOnly(isReadOnly);
  setActiveDefaultConnector(resolvedConnector);
  setActiveDiagramMetadata(resolvedMetadata);
  if (g?.container && containerInstances.has(g.container)) {
    containerInstances.get(g.container)!.metadata = resolvedMetadata;
  }

  // Resolve and apply language-adaptive edge selection style
  const lang = (data.metadata?.["language"] as string | undefined) ?? (data.diagramType as string) ?? opts?.language;
  const userEdgePref = (resolvedMetadata?.["edgeSelectionStyle"] as EdgeSelectionStyle) ?? opts?.edgeSelectionStyle;
  const resolvedEdgeStyle = resolveEdgeSelectionStyle(lang, userEdgePref);
  if (g.container) {
    g.container.setAttribute("data-edge-selection", resolvedEdgeStyle);
  }

  // Dynamically configure canvas grid from coordinateSystem if specified
  if (data.coordinateSystem?.grid) {
    const gridConfig = data.coordinateSystem.grid;
    if (Array.isArray(gridConfig)) {
      if (typeof gridConfig[0] === "number" && gridConfig[0] > 0) {
        graphBaseGridSizes.set(g, gridConfig[0]);
        g.setGridSize?.(gridConfig[0]);
      }
    } else if (typeof gridConfig === "object") {
      if (gridConfig.visible === false) {
        g.hideGrid?.();
      } else {
        g.showGrid?.();
        if (typeof gridConfig.x === "number" && gridConfig.x > 0) {
          graphBaseGridSizes.set(g, gridConfig.x);
          g.setGridSize?.(gridConfig.x);
        }
        if (gridConfig.type) {
          const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
          if (gridConfig.type === "dot") {
            g.drawGrid({ type: "dot", args: { color: gridConfig.color ?? gridColor, thickness: 1.5 } });
          } else if (gridConfig.type === "mesh") {
            g.drawGrid({ type: "mesh", args: { color: gridConfig.color ?? gridColor, thickness: 1 } });
          } else if (gridConfig.type === "doubleMesh") {
            g.drawGrid({
              type: "doubleMesh",
              args: [
                { color: "transparent", thickness: 0 },
                { color: gridConfig.color ?? gridColor, thickness: 1, factor: 10 },
              ],
            });
          }
        }
      }
    }
  }

  // Clean up any remaining drop placeholder or placement ghost when real diagram data arrives.
  const existingPlaceholder = g.getCellById("__drop_placeholder__");
  const activeDrop = getActiveDropPlaceholder();

  const currentCells = g.getCells();
  const existingNonEphemeralNodeIds = new Set<string>();
  for (const c of currentCells) {
    if (c.isNode() && !isEphemeralDiagramNode(c.id)) {
      existingNonEphemeralNodeIds.add(c.id);
    }
  }

  const isSafetyTimeout = activeDrop ? Date.now() - activeDrop.timestamp > 3000 : false;
  const isComponentPresentInData =
    !activeDrop ||
    isSafetyTimeout ||
    data?.nodes?.some((n: RenderDiagramNodeInput) => {
      if (isEphemeralDiagramNode(n.id)) return false;
      if (!existingNonEphemeralNodeIds.has(n.id)) return true;
      const nDataProps = (n.data as { properties?: { className?: string | undefined } | undefined } | undefined)
        ?.properties;
      const typeMatch =
        (nDataProps?.className && nDataProps.className === activeDrop.className) ||
        (n.properties?.className && n.properties.className === activeDrop.className);
      if (typeMatch) return true;
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const dx = Math.abs(nx - activeDrop.x);
      const dy = Math.abs(ny - activeDrop.y);
      const dyInverted = Math.abs(-ny - activeDrop.y);
      return dx < 40 && (dy < 40 || dyInverted < 40);
    });

  if (activeDrop && !isComponentPresentInData) {
    // Keep __drop_placeholder__ visible while the language server is indexing
  } else {
    if (existingPlaceholder) {
      g.removeCell(existingPlaceholder);
    }
    clearActiveDropPlaceholder();
  }

  const ghost = g.getCellById("placement-ghost");
  if (ghost) g.removeCell(ghost);

  // Normalize nodes/edges, synthesize coordinate-system nodes, and run layout
  const { nodes, edges, relations } = prepareDiagramRenderModel(g, data, isDark);
  const cs = data.coordinateSystem;

  const myRenderGeneration = nextRenderFitGeneration();
  const isCurrentLoading = Boolean(data.isLoading);
  const rootNodeId = nodes.find((n) => !n.parent)?.id ?? null;
  const currentModule =
    data.metadata?.currentModule ??
    data.className ??
    (data.diagramType ? `${data.diagramType}:${rootNodeId ?? ""}` : null);
  const { moduleChanged, loadingCompleted } = beginGraphRenderState(g, {
    readOnly: isReadOnly,
    defaultConnector: resolvedConnector,
    metadata: resolvedMetadata,
    currentModule,
    isLoading: isCurrentLoading,
  });
  if (moduleChanged) {
    getDefaultPropertyCache().clear();
    setSelectedNodeIdState(null);
  }

  // ── Diff-based incremental update ──
  const existingCells = g.getCells();
  const isFirstRender = existingCells.length === 0;
  const csAny = data.coordinateSystem as { extent?: unknown } | null | undefined;
  const isYUp =
    Boolean(csAny) &&
    (data.metadata?.["language"] === "modelica" || (!data.metadata?.["language"] && Array.isArray(csAny?.extent)));
  yUpCoordsByGraph.set(g, isYUp);

  if (!isFirstRender && !moduleChanged && !loadingCompleted) {
    const newNodeIds = new Set(
      nodes.filter((n: { id: string }) => !isEphemeralDiagramNode(n.id)).map((n: { id: string }) => n.id),
    );
    const newEdgeIds = new Set(
      edges.filter((e: { id: string }) => !isEphemeralDiagramNode(e.id)).map((e: { id: string }) => e.id),
    );

    if (activeDrop && isComponentPresentInData) {
      const ph = g.getCellById("__drop_placeholder__");
      if (ph) g.removeCell(ph);
      clearActiveDropPlaceholder();
    }

    // ── Keyed Differential Cell Reconciler (Zero-Flicker) ──
    g.batchUpdate("diagram-diff", () => {
      if (!data.coordinateSystem) {
        const bg = g.getCellById("__diagram_background__");
        if (bg) g.removeCell(bg);
        const axes = g.getCellById("__diagram_axes__");
        if (axes) g.removeCell(axes);
      }

      // 1. Remove deleted nodes and edges
      for (const cell of existingCells) {
        if (isEphemeralDiagramNode(cell.id)) continue;
        if (cell.isNode() && !newNodeIds.has(cell.id)) {
          g.removeCell(cell);
        } else if (cell.isEdge() && !newEdgeIds.has(cell.id)) {
          g.removeCell(cell);
        }
      }

      for (const nodeData of nodes) {
        const cell = g.getCellById(nodeData.id);
        if (!cell || !cell.isNode()) {
          g.addNode(nodeData);
          continue;
        }

        // Update position if changed
        const pos = cell.getPosition();
        if (Math.abs(pos.x - nodeData.x) > 0.5 || Math.abs(pos.y - nodeData.y) > 0.5) {
          cell.setPosition(nodeData.x, nodeData.y, { silent: false });
        }

        // Update size if changed
        const size = cell.getSize();
        const sizeChanged =
          Math.abs(size.width - nodeData.width) > 0.5 || Math.abs(size.height - nodeData.height) > 0.5;
        if (sizeChanged) {
          cell.setSize(nodeData.width, nodeData.height);
          updateNodeVisualOnResize(cell, g, nodeData.width, nodeData.height, size.width, size.height);
        }

        // Update angle if changed
        const angle = cell.getAngle();
        if (Math.abs(angle - (nodeData.angle ?? 0)) > 0.5) {
          cell.rotate(nodeData.angle ?? 0, { absolute: true });
        }

        // Update data (properties)
        if (nodeData.data) {
          const prevData = (cell.getData?.() || {}) as Record<string, unknown>;
          const prevFlipX = Boolean(prevData["flipX"]);
          const prevFlipY = Boolean(prevData["flipY"]);
          const nextFlipX = Boolean(nodeData.data["flipX"]);
          const nextFlipY = Boolean(nodeData.data["flipY"]);
          cell.setData(nodeData.data, { overwrite: true });
          if (prevFlipX !== nextFlipX || prevFlipY !== nextFlipY) {
            applyNodeFlipVisuals(cell, g, nextFlipX, nextFlipY);
          }
        }

        // Update markup and attrs (e.g. parameter ratings, breaker open/closed color, labels)
        if (nodeData.markup && JSON.stringify(cell.getMarkup?.()) !== JSON.stringify(nodeData.markup)) {
          cell.setMarkup(nodeData.markup);
          const view = g.findViewByCell(cell);
          const viewWithRender = view as unknown as { render?: () => void };
          if (viewWithRender && typeof viewWithRender.render === "function") {
            try {
              viewWithRender.render();
            } catch {
              // fallback if headless or view render fails
            }
          }
        }
        if (nodeData.attrs && JSON.stringify(cell.getAttrs?.()) !== JSON.stringify(nodeData.attrs)) {
          cell.setAttrs(nodeData.attrs);
        }

        // Update ports if changed (e.g. conditional ports like heatPort toggled via parameters, or theme color adaptation)
        interface DiagramPortLike {
          id?: string;
          name?: string;
          args?: { x?: number; y?: number; angle?: number };
          markup?: unknown;
          attrs?: unknown;
        }
        const currentPorts = (cell.getPorts?.() || []) as DiagramPortLike[];
        const newPortItems: DiagramPortLike[] = nodeData.ports
          ? Array.isArray(nodeData.ports)
            ? (nodeData.ports as DiagramPortLike[])
            : (nodeData.ports as { items?: DiagramPortLike[] })?.items || []
          : [];
        const currentSig = currentPorts
          .map((p) => `${p.id}:${p.args?.x ?? ""},${p.args?.y ?? ""},${p.args?.angle ?? ""}`)
          .join(";");
        const newSig = newPortItems
          .map((p) => `${p.id || p.name}:${p.args?.x ?? ""},${p.args?.y ?? ""},${p.args?.angle ?? ""}`)
          .join(";");
        const currentGroups = (cell.prop?.("ports") as { groups?: unknown } | undefined)?.groups;
        const newGroups =
          nodeData.ports && !Array.isArray(nodeData.ports)
            ? (nodeData.ports as { groups?: unknown }).groups
            : undefined;
        const portVisualChanged =
          currentSig === newSig &&
          (JSON.stringify(currentGroups ?? null) !== JSON.stringify(newGroups ?? null) ||
            JSON.stringify(currentPorts.map((p) => ({ markup: p.markup ?? null, attrs: p.attrs ?? null }))) !==
              JSON.stringify(newPortItems.map((p) => ({ markup: p.markup ?? null, attrs: p.attrs ?? null }))));
        if (currentSig !== newSig || portVisualChanged) {
          if (currentSig !== newSig) {
            const cellData = (cell.getData?.() || {}) as { __portRatios?: unknown };
            if (cellData.__portRatios) {
              delete cellData.__portRatios;
            }
          }
          cell.prop?.("ports", nodeData.ports ?? { items: [], groups: {} }, { rewrite: true });
        }
      }

      // Update edge vertices, endpoints, attrs, labels, router, and data
      for (const edgeData of edges) {
        const cell = g.getCellById(edgeData.id);
        if (!cell || !cell.isEdge()) {
          g.addEdge(edgeData);
          continue;
        }

        const nextVerts = edgeData.vertices ?? [];
        const curVerts = cell.getVertices() || [];
        const vertsChanged =
          curVerts.length !== nextVerts.length ||
          curVerts.some(
            (v: PointLike, idx: number) =>
              Math.abs(v.x - (nextVerts[idx]?.x ?? 0)) > 0.5 || Math.abs(v.y - (nextVerts[idx]?.y ?? 0)) > 0.5,
          );
        if (vertsChanged) {
          cell.setVertices(nextVerts, { ignoreSnap: true });
        }
        if (edgeData.source && typeof edgeData.source === "object") {
          const curSrc = cell.getSource();
          if (curSrc?.cell !== edgeData.source.cell || curSrc?.port !== edgeData.source.port) {
            cell.setSource(edgeData.source);
          }
        }
        if (edgeData.target && typeof edgeData.target === "object") {
          const curTgt = cell.getTarget();
          if (curTgt?.cell !== edgeData.target.cell || curTgt?.port !== edgeData.target.port) {
            cell.setTarget(edgeData.target);
          }
        }
        if (edgeData.router) {
          cell.setRouter?.(edgeData.router);
        } else {
          cell.removeRouter?.();
        }
        if (edgeData.connector) {
          cell.setConnector?.(edgeData.connector);
        }
        if (edgeData.labels) {
          cell.setLabels?.(edgeData.labels);
        }
        if (edgeData.attrs) {
          cell.setAttrs(edgeData.attrs);
        }
        if (edgeData.data) {
          cell.setData(edgeData.data, { overwrite: true });
        }
      }

      // 4. Update embedding relationships
      for (const [childId, parentId] of relations) {
        const parentCell = g.getCellById(parentId);
        const childCell = g.getCellById(childId);
        if (parentCell && childCell && parentCell.isNode() && childCell.isNode()) {
          parentCell.addChild(childCell);
        }
      }
    });

    // Restore property panel for previously selected node after re-render only if cached properties exist.
    const curSelectedId = getSelectedNodeIdForGraph(g);
    if (curSelectedId && !isEphemeralDiagramNode(curSelectedId)) {
      const restoredNode = g.getCellById(curSelectedId);
      if (restoredNode && restoredNode.isNode()) {
        const cached = getPropertyCacheForGraph(g).get(curSelectedId);
        if (cached) {
          showProperties({ id: restoredNode.id, properties: cached, isLoading: false }, g);
        }
      }
    }

    updateSolderDots(g);
    scheduleUpdateSolderDots(g);
    scheduleViewportCulling(g);
    updateBreadcrumbs(data.breadcrumbs || data.metadata?.breadcrumbs);
    const hud = (g.container as HTMLElement | undefined)?.querySelector?.(
      "#modelscript-minimap-hud",
    ) as HTMLElement | null;
    if (hud) {
      updateMinimapHud(hud, g);
    }
    return;
  }

  // ── Full render path (first render or topology changed) ──
  const prevZoom = isFirstRender || typeof g.zoom !== "function" ? null : g.zoom();
  const prevTrans = isFirstRender || typeof g.translate !== "function" ? null : g.translate();

  // 2. Load the flat graph with verified edge endpoints
  const validNodeIds = new Set(nodes.map((n) => n.id));
  const verifiedEdges = edges.filter((e) => {
    const src = typeof e.source === "string" ? e.source : e.source?.cell;
    const tgt = typeof e.target === "string" ? e.target : e.target?.cell;
    return Boolean(src && tgt && validNodeIds.has(src) && validNodeIds.has(tgt));
  });
  g.fromJSON({ nodes, edges: verifiedEdges });

  for (const nodeData of nodes) {
    if (nodeData.data?.["flipX"] || nodeData.data?.["flipY"]) {
      const cell = g.getCellById(nodeData.id);
      if (cell && cell.isNode()) {
        applyNodeFlipVisuals(cell, g, Boolean(nodeData.data["flipX"]), Boolean(nodeData.data["flipY"]));
      }
    }
  }

  if (activeDrop && !isComponentPresentInData) {
    const { width, height } = getTypicalNodeSize(g);
    dropComponentGhost(g, activeDrop.x, activeDrop.y, activeDrop.className, activeDrop.iconSvg, isDark, width, height);
  } else if (activeDrop && isComponentPresentInData) {
    clearActiveDropPlaceholder();
  }

  // 3. Programmatically establish all embedding relationships via standard API
  for (const [childId, parentId] of relations) {
    const parentCell = g.getCellById(parentId);
    const childCell = g.getCellById(childId);
    if (parentCell && childCell && parentCell.isNode() && childCell.isNode()) {
      parentCell.addChild(childCell);
    }
  }

  updateBreadcrumbs(data.breadcrumbs || data.metadata?.breadcrumbs);

  // Only fit view on first non-loading render, when switching modules, or when loading completes
  if (!isCurrentLoading && (isFirstRender || moduleChanged || loadingCompleted)) {
    const parent = g.container?.parentElement;
    const parentW = parent?.clientWidth ?? 0;
    const parentH = parent?.clientHeight ?? 0;
    const clientW = g.container.clientWidth > 0 ? g.container.clientWidth : 0;
    const clientH = g.container.clientHeight > 0 ? g.container.clientHeight : 0;
    const containerW = parentW > 0 ? parentW : clientW > 0 ? clientW : 800;
    const containerH = parentH > 0 ? parentH : clientH > 0 ? clientH : 600;
    g.resize(containerW, containerH);
    const fitViewportWithInsets = (cw: number, ch: number) => {
      const insets = getOptionsForGraph(g)?.fitInsets;
      const top = insets?.top ?? 0;
      const right = insets?.right ?? 0;
      const bottom = insets?.bottom ?? 0;
      const left = insets?.left ?? 0;
      const vw = Math.max(120, cw - left - right);
      const vh = Math.max(120, ch - top - bottom);
      const viewportArea = { x: left, y: top, width: vw, height: vh };
      const shiftX = (left - right) / 2;
      const shiftY = (top - bottom) / 2;

      const hasExplicitCoordBounds = Boolean(
        cs && (cs.boundsStyle?.visible !== false || cs.axesStyle?.visible !== false),
      );
      if (hasExplicitCoordBounds && cs) {
        const expandedRect = {
          x: cs.x - cs.width * 0.125,
          y: cs.y - cs.height * 0.125,
          width: cs.width * 1.25,
          height: cs.height * 1.25,
        };
        g.zoomToRect(expandedRect, { viewportArea });
        const ox = cs.axesStyle?.origin?.[0] ?? 0;
        const oy = cs.axesStyle?.origin?.[1] ?? 0;
        const gWithCenter = g as unknown as { centerPoint?: (x: number, y: number) => void };
        if (typeof gWithCenter.centerPoint === "function") {
          gWithCenter.centerPoint(ox, oy);
        } else if (typeof g.centerContent === "function") {
          g.centerContent();
        }
      } else {
        try {
          g.zoomToFit({ padding: 40, maxScale: 1.0, minScale: 0.2, viewportArea });
          g.centerContent();
        } catch {
          // ignore
        }
      }

      if ((shiftX !== 0 || shiftY !== 0) && typeof g.translate === "function") {
        const cur = g.translate();
        if (cur && typeof cur.tx === "number" && typeof cur.ty === "number") {
          g.translate(cur.tx + shiftX, cur.ty + shiftY);
        }
      }
    };

    fitViewportWithInsets(containerW, containerH);

    // Ensure the diagram is properly sized and centered once initial webview layout completes.
    const checkAndRecenter = () => {
      try {
        if (myRenderGeneration !== getRenderFitGeneration()) return;
        if (g && (typeof g.isDisposed === "function" ? !g.isDisposed() : true)) {
          const p = g.container?.parentElement;
          const pw = p?.clientWidth ?? 0;
          const ph = p?.clientHeight ?? 0;
          const cw = pw > 0 ? pw : (g.container?.clientWidth ?? 0);
          const ch = ph > 0 ? ph : (g.container?.clientHeight ?? 0);
          if (cw > 0 && ch > 0) {
            g.resize(cw, ch);
          }
          fitViewportWithInsets(cw > 0 ? cw : containerW, ch > 0 ? ch : containerH);
        }
      } catch {
        // ignore
      }
    };
    setTimeout(checkAndRecenter, 60);
    setTimeout(checkAndRecenter, 300);
  } else if (prevZoom !== null && prevTrans !== null) {
    try {
      g.zoom(prevZoom, { absolute: true });
      g.translate(prevTrans.tx, prevTrans.ty);
    } catch {
      // ignore
    }
  }

  // Restore property panel for previously selected node after re-render
  const restoredSelectedId = getSelectedNodeIdForGraph(g);
  if (restoredSelectedId && !isEphemeralDiagramNode(restoredSelectedId)) {
    const restoredNode = g.getCellById(restoredSelectedId);
    if (restoredNode && restoredNode.isNode()) {
      const cached = getPropertyCacheForGraph(g).get(restoredSelectedId);
      if (cached) {
        showProperties({ id: restoredNode.id, properties: cached, isLoading: false }, g);
      } else {
        const restoredData = restoredNode.getData();
        showProperties({ id: restoredNode.id, properties: restoredData?.properties, isLoading: true }, g);
        postMessageToHost({ type: "getProperties", componentName: restoredNode.id }, g);
      }
    }
  }

  updateSolderDots(g);
  scheduleUpdateSolderDots(g);
  scheduleViewportCulling(g);
  const inst = (g.container && containerInstances.get(g.container)) || null;
  inst?.syncAlignmentToolbar?.();
  if (!inst) {
    getActiveSyncAlignmentToolbar()?.();
  }
  const hud = (g.container as HTMLElement | undefined)?.querySelector?.(
    "#modelscript-minimap-hud",
  ) as HTMLElement | null;
  if (hud) {
    updateMinimapHud(hud, g);
  }
  setTimeout(() => {
    if (getActiveGraph() === g && !g.disposed) {
      updateSolderDots(g);
      scheduleViewportCulling(g);
      const h = (g.container as HTMLElement | undefined)?.querySelector?.(
        "#modelscript-minimap-hud",
      ) as HTMLElement | null;
      if (h) {
        updateMinimapHud(h, g);
      }
    }
  }, 50);
}
