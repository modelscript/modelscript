// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applyNodeFlipVisuals,
  computeNodeAlignment,
  ensureAlignmentToolbar,
  showAlignmentToolbar,
  type AlignableNode,
  type AlignmentType,
} from "./alignment.js";
import { getConnectedEdges, rerouteEdgeOrthogonal, scheduleUpdateSolderDots } from "./canvas-edge-routing.js";
import {
  containerInstances,
  enqueueDiagramAction,
  getActiveGraph,
  getActiveSyncAlignmentToolbar,
  getGraph,
  getPropertyCacheForGraph,
  getReadOnlyForGraph,
  postMessageToHost,
  showProperties,
  toSchemaY,
} from "./canvas-state.js";
import type {
  CanvasInteractionFlags,
  Cell,
  ClipboardEdgeItem,
  ClipboardNodeItem,
  DiagramClipboardSnapshot,
  Edge,
  Graph,
  Node,
} from "./canvas-types.js";
import { isEphemeralDiagramNode } from "./drop-placeholder.js";
import { isGraphLayoutEditable } from "./graph-state.js";
import { translateConnectedEdgeStubs } from "./port-router.js";
import { syncAllNodeSelectionBoxes } from "./selection-handles.js";

/**
 * Replaces a standalone value token inside a parameter label (e.g. "100" or "100 Ω")
 * without corrupting unrelated identifiers or digits (e.g. "R1=10" when oldValue is "1").
 */
export function replaceExactParamValueText(
  content: string,
  paramName: string,
  oldValue: string,
  newValue: string,
): string | null {
  const eqIdx = content.indexOf("=");
  if (eqIdx !== -1) {
    const left = content.slice(0, eqIdx).trim();
    if (left === paramName || left.endsWith(`.${paramName}`)) {
      return `${paramName}=${newValue}`;
    }
    // Belongs to a different parameter ("otherParam=...") — never touch it
    return null;
  }
  const trimmed = content.trim();
  const oldTrimmed = oldValue.trim();
  if (!oldTrimmed) return null;
  if (trimmed === oldTrimmed) {
    return content.replace(oldTrimmed, newValue);
  }
  // Match value followed by whitespace/unit (e.g. "100 Ω", "100 uF") at the start of the label
  if (trimmed.startsWith(`${oldTrimmed} `) || trimmed.startsWith(`${oldTrimmed}\t`)) {
    return content.replace(oldTrimmed, newValue);
  }
  return null;
}

/**
 * Optimistically patch the SVG text label of a component in the diagram
 * when a parameter value changes. This avoids a full diagram re-render and
 * gives the user instant visual feedback as they type.
 *
 * The function walks all `<text>` elements inside the node's SVG and replaces
 * text content that matches the old parameter value pattern with the new one.
 */
export function updateParameterText(
  nodeId: string,
  paramName: string,
  oldValue: string,
  newValue: string,
  targetGraphOrContainer?: Graph | HTMLElement | null,
): void {
  const g =
    (targetGraphOrContainer &&
    typeof (targetGraphOrContainer as unknown as { getCellById?: unknown }).getCellById === "function"
      ? (targetGraphOrContainer as Graph)
      : targetGraphOrContainer && containerInstances.has(targetGraphOrContainer as HTMLElement)
        ? containerInstances.get(targetGraphOrContainer as HTMLElement)!.graph
        : getGraph(targetGraphOrContainer as HTMLElement)) ?? getActiveGraph();
  if (!g) return;
  const cell = g.getCellById(nodeId);
  if (!cell || !cell.isNode()) return;

  const view = g.findViewByCell(cell);
  if (!view) return;

  const svgEl = view.container;
  if (!svgEl) return;

  const texts = Array.from(svgEl.querySelectorAll("text"));
  for (const textEl of texts) {
    const content = textEl.textContent ?? "";
    if (!content) continue;
    const replaced = replaceExactParamValueText(content, paramName, oldValue, newValue);
    if (replaced !== null) {
      textEl.textContent = replaced;
    }
  }

  // Update cell's markup data structure so future getMarkup() is consistent
  const currentMarkup = cell.getMarkup?.();
  if (currentMarkup) {
    const patchMarkupText = (item: unknown) => {
      if (!item || typeof item !== "object") return;
      const rec = item as Record<string, unknown>;
      if (rec["tagName"] === "text") {
        const c = typeof rec["children"] === "string" ? rec["children"] : rec["textContent"];
        if (typeof c === "string") {
          const replaced = replaceExactParamValueText(c, paramName, oldValue, newValue);
          if (replaced !== null) {
            if (typeof rec["children"] === "string") rec["children"] = replaced;
            if (rec["textContent"]) rec["textContent"] = replaced;
          }
        }
      }
      if (Array.isArray(rec["children"])) {
        for (const ch of rec["children"]) {
          patchMarkupText(ch);
        }
      }
    };
    patchMarkupText(currentMarkup);
  }

  // Update propertyCache and cell data properties if present
  interface ParameterEntry {
    name?: string;
    value?: string;
  }
  const cached = getPropertyCacheForGraph(g).get(nodeId) as { parameters?: ParameterEntry[] } | undefined;
  if (cached?.parameters && Array.isArray(cached.parameters)) {
    const p = cached.parameters.find(
      (item: ParameterEntry) => item && (item.name === paramName || item.name === `${paramName}`),
    );
    if (p) {
      p.value = newValue;
    }
  }
  const curData = cell.getData?.();
  const curProps = curData?.["properties"] as { parameters?: ParameterEntry[] } | undefined;
  if (curProps?.parameters && Array.isArray(curProps.parameters)) {
    const p = curProps.parameters.find(
      (item: ParameterEntry) => item && (item.name === paramName || item.name === `${paramName}`),
    );
    if (p) {
      p.value = newValue;
    }
  }

  // Synchronize alignment toolbar if this node is currently selected
  const inst = (g.container && containerInstances.get(g.container)) || null;
  inst?.syncAlignmentToolbar?.();
  if (!inst) {
    getActiveSyncAlignmentToolbar()?.();
  }
}

/**
 * Extracts the primary parameter chip (e.g. `C=1e-4`, `R=100`) for a component node.
 */
export function extractNodePrimaryParam(
  targetGraph: Graph,
  node: Node,
): { label: string; paramName: string; paramValue: string } | undefined {
  const view = targetGraph.findViewByCell?.(node);
  const svgEl = view?.container;
  if (svgEl && typeof svgEl.querySelectorAll === "function") {
    const texts = Array.from(svgEl.querySelectorAll("text"));
    for (const t of texts) {
      const raw = (t.textContent ?? "").trim();
      const eqIdx = raw.indexOf("=");
      if (eqIdx > 0 && eqIdx < raw.length - 1) {
        const paramName = raw.slice(0, eqIdx).trim();
        const paramValue = raw.slice(eqIdx + 1).trim();
        if (/^[A-Za-z_]\w*$/.test(paramName)) {
          return { label: `${paramName}=${paramValue}`, paramName, paramValue };
        }
      }
    }
  }
  const cached = getPropertyCacheForGraph(targetGraph).get(node.id) as
    { parameters?: { name?: string; value?: string; defaultValue?: string }[] } | undefined;
  const firstParam = cached?.parameters?.find((p) => p.name && (p.value || p.defaultValue));
  if (firstParam?.name) {
    const val = String(firstParam.value || firstParam.defaultValue || "");
    return { label: `${firstParam.name}=${val}`, paramName: firstParam.name, paramValue: val };
  }
  const data = (typeof node.getData === "function" ? node.getData() : {}) || {};
  const propParams = (data["properties"]?.["parameters"] ?? data["parameters"]) as
    { name?: string; value?: string; defaultValue?: string }[] | undefined;
  const firstPropParam = propParams?.find?.((p) => p.name && (p.value || p.defaultValue));
  if (firstPropParam?.name) {
    const val = String(firstPropParam.value || firstPropParam.defaultValue || "");
    return { label: `${firstPropParam.name}=${val}`, paramName: firstPropParam.name, paramValue: val };
  }
  return undefined;
}

export interface NodeEditingController {
  alignmentToolbar: HTMLElement | null;
  rotateSelectedNodes: (deltaDegrees: number, targetGraph?: Graph) => void;
  flipSelectedNodes: (axis: "x" | "y", targetGraph?: Graph) => void;
  duplicateSelectedNodes: (targetGraph?: Graph) => void;
  copySelectedNodes: (targetGraph?: Graph) => boolean;
  pasteSelectedNodes: (targetGraph?: Graph) => boolean;
  deleteSelectedCells: (targetGraph?: Graph) => void;
  startInlineParamEdit: (node: Node, targetGraph?: Graph) => void;
  startInlineNodeEdit: (node: Node) => void;
  syncAlignmentToolbar: () => void;
  showNudgeHud: (targetGraph: Graph, nodes: Node[], deltaX: number, deltaY: number) => void;
  addNudgeDelta: (dx: number, dy: number) => { accumDx: number; accumDy: number };
  dispose: () => void;
}

export function createNodeEditingController(params: {
  graph: Graph;
  container: HTMLElement;
  isDark: boolean;
  getSelectionContainer: () => HTMLElement | undefined;
  flags: CanvasInteractionFlags;
}): NodeEditingController {
  const { graph: g, container, isDark, getSelectionContainer, flags } = params;

  let diagramClipboard: DiagramClipboardSnapshot = { format: "modelscript-diagram/v1", nodes: [], edges: [] };
  let diagramPasteCount = 1;

  // ── Live Coordinate & Delta Nudge HUD Pill ──
  let nudgeHudEl: HTMLElement | null = null;
  let nudgeHudFadeTimeout: ReturnType<typeof setTimeout> | null = null;
  let nudgeAccumDx = 0;
  let nudgeAccumDy = 0;

  const showNudgeHud = (targetGraph: Graph, nodes: Node[], deltaX: number, deltaY: number) => {
    if (!container || typeof document === "undefined" || nodes.length === 0) return;
    if (!nudgeHudEl || !container.contains(nudgeHudEl)) {
      nudgeHudEl = container.querySelector(".modelscript-nudge-hud") as HTMLElement | null;
      if (!nudgeHudEl) {
        nudgeHudEl = document.createElement("div");
        nudgeHudEl.className = "modelscript-nudge-hud";
        container.appendChild(nudgeHudEl);
      }
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const p = n.getPosition();
      const s = n.getSize();
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.width);
      maxY = Math.max(maxY, p.y + s.height);
    }

    const sc = typeof targetGraph.scale === "function" ? targetGraph.scale() : { sx: 1, sy: 1 };
    const tr = typeof targetGraph.translate === "function" ? targetGraph.translate() : { tx: 0, ty: 0 };
    const screenCenterX = ((minX + maxX) / 2) * sc.sx + tr.tx;
    const screenBottomY = maxY * sc.sy + tr.ty + 18;

    const modelX = Math.round((minX + maxX) / 2);
    const modelY = Math.round(-((minY + maxY) / 2));
    const signX = deltaX >= 0 ? `+${Math.round(deltaX)}` : `${Math.round(deltaX)}`;
    const signY = -deltaY >= 0 ? `+${Math.round(-deltaY)}` : `${Math.round(-deltaY)}`;

    nudgeHudEl.innerHTML = `<span class="nudge-coords">(${modelX}, ${modelY})</span><span class="nudge-delta">Δ(${signX}, ${signY})</span>`;
    nudgeHudEl.style.left = `${Math.round(screenCenterX)}px`;
    nudgeHudEl.style.top = `${Math.round(screenBottomY)}px`;
    nudgeHudEl.classList.add("visible");

    if (nudgeHudFadeTimeout) clearTimeout(nudgeHudFadeTimeout);
    nudgeHudFadeTimeout = setTimeout(() => {
      nudgeHudEl?.classList.remove("visible");
      nudgeAccumDx = 0;
      nudgeAccumDy = 0;
      nudgeHudFadeTimeout = null;
    }, 900);
  };

  const addNudgeDelta = (dx: number, dy: number) => {
    nudgeAccumDx += dx;
    nudgeAccumDy += dy;
    return { accumDx: nudgeAccumDx, accumDy: nudgeAccumDy };
  };

  const getSelectedNonEphemeralNodes = (targetGraph: Graph = g): Node[] =>
    targetGraph
      .getSelectedCells()
      .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];

  const snapshotNodesToClipboard = (nodes: Node[], targetGraph: Graph = g): DiagramClipboardSnapshot => {
    const items: ClipboardNodeItem[] = [];
    const indexByNodeId = new Map<string, number>();
    for (const node of nodes) {
      const data = node.getData?.() || {};
      const className = (data.properties?.className as string | undefined) || (data["className"] as string | undefined);
      if (!className) continue;
      const p = node.getPosition();
      const s = node.getSize();
      const angle = typeof node.getAngle === "function" ? node.getAngle() : 0;
      const rawParams = data["parameters"] as Record<string, unknown> | undefined;
      indexByNodeId.set(node.id, items.length);
      items.push({
        sourceId: node.id,
        className,
        centerX: p.x + s.width / 2,
        screenCenterY: p.y + s.height / 2,
        rotation: angle || undefined,
        parameters: rawParams ? { ...rawParams } : undefined,
      });
    }
    const internalEdges: ClipboardEdgeItem[] = [];
    for (const edge of targetGraph.getEdges()) {
      const srcId = edge.getSourceCellId?.();
      const tgtId = edge.getTargetCellId?.();
      if (!srcId || !tgtId) continue;
      const sourceIdx = indexByNodeId.get(srcId);
      const targetIdx = indexByNodeId.get(tgtId);
      if (sourceIdx === undefined || targetIdx === undefined) continue;
      internalEdges.push({
        sourceIdx,
        sourcePort: edge.getSourcePortId?.() ?? edge.getSource?.()?.port,
        targetIdx,
        targetPort: edge.getTargetPortId?.() ?? edge.getTarget?.()?.port,
      });
    }
    return { format: "modelscript-diagram/v1", nodes: items, edges: internalEdges };
  };

  const emitOffsetComponentCopies = (snapshot: DiagramClipboardSnapshot, offsetPx: number, targetGraph: Graph = g) => {
    if (snapshot.edges.length > 0 && snapshot.nodes.length >= 2) {
      enqueueDiagramAction(
        {
          type: "pasteSubgraph",
          nodes: snapshot.nodes.map((item) => ({
            className: item.className,
            x: Math.round(item.centerX + offsetPx),
            y: toSchemaY(targetGraph, item.screenCenterY + offsetPx),
            ...(item.rotation ? { rotation: item.rotation } : {}),
            ...(item.parameters ? { parameters: item.parameters } : {}),
          })),
          edges: snapshot.edges,
        },
        targetGraph,
      );
      return;
    }
    for (const item of snapshot.nodes) {
      enqueueDiagramAction(
        {
          type: "addComponent",
          className: item.className,
          x: Math.round(item.centerX + offsetPx),
          y: toSchemaY(targetGraph, item.screenCenterY + offsetPx),
          ...(item.rotation ? { rotation: item.rotation } : {}),
          ...(item.parameters ? { parameters: item.parameters } : {}),
        },
        targetGraph,
      );
    }
  };

  // ── Node Rotation Helper ──
  const rotateSelectedNodes = (deltaDegrees: number, targetGraph: Graph = g) => {
    if (getReadOnlyForGraph(targetGraph) && !isGraphLayoutEditable(targetGraph)) return;
    const selectedNodes = getSelectedNonEphemeralNodes(targetGraph);
    if (selectedNodes.length === 0) return;

    const moveItems: Record<string, unknown>[] = [];
    targetGraph.batchUpdate("rotate", () => {
      for (const node of selectedNodes) {
        const curAngle = node.getAngle?.() || 0;
        const newAngle = (((curAngle + deltaDegrees) % 360) + 360) % 360;
        node.rotate?.(newAngle, { absolute: true });
      }

      const touchedEdges = new Set<Edge>();
      for (const node of selectedNodes) {
        for (const edge of targetGraph.getConnectedEdges(node)) {
          touchedEdges.add(edge);
        }
      }
      for (const edge of touchedEdges) {
        rerouteEdgeOrthogonal(edge, targetGraph, { skipEnqueue: true });
      }

      for (const node of selectedNodes) {
        const p = node.getPosition();
        const s = node.getSize();
        const newAngle = node.getAngle?.() || 0;
        const edges = getConnectedEdges(targetGraph, node);
        const data = node.getData?.() || {};
        const name = (data["name"] as string) || node.id;
        moveItems.push({
          name,
          x: p.x,
          y: p.y,
          width: s.width,
          height: s.height,
          rotation: newAngle,
          ...(typeof data["flipX"] === "boolean" ? { flipX: data["flipX"] } : {}),
          ...(typeof data["flipY"] === "boolean" ? { flipY: data["flipY"] } : {}),
          edges,
        });
      }
    });

    syncAllNodeSelectionBoxes(targetGraph, getSelectionContainer());
    syncAlignmentToolbar();

    if (moveItems.length > 0) {
      enqueueDiagramAction({ type: "move", items: moveItems }, targetGraph);
      scheduleUpdateSolderDots(targetGraph);
    }
  };

  // ── Node Flip Helper (Horizontal / Vertical Mirror) ──
  const flipSelectedNodes = (axis: "x" | "y", targetGraph: Graph = g) => {
    if (getReadOnlyForGraph(targetGraph) && !isGraphLayoutEditable(targetGraph)) return;
    const selectedNodes = getSelectedNonEphemeralNodes(targetGraph);
    if (selectedNodes.length === 0) return;

    const moveItems: Record<string, unknown>[] = [];
    targetGraph.batchUpdate("flip", () => {
      for (const node of selectedNodes) {
        const curData = node.getData?.() || {};
        const curFlipX = Boolean(curData["flipX"]);
        const curFlipY = Boolean(curData["flipY"]);
        const nextFlipX = axis === "x" ? !curFlipX : curFlipX;
        const nextFlipY = axis === "y" ? !curFlipY : curFlipY;
        node.setData?.({ ...curData, flipX: nextFlipX, flipY: nextFlipY });
        applyNodeFlipVisuals(node, targetGraph, nextFlipX, nextFlipY);
      }

      const touchedEdges = new Set<Edge>();
      for (const node of selectedNodes) {
        for (const edge of targetGraph.getConnectedEdges(node)) {
          touchedEdges.add(edge);
        }
      }
      for (const edge of touchedEdges) {
        rerouteEdgeOrthogonal(edge, targetGraph, { skipEnqueue: true });
      }

      for (const node of selectedNodes) {
        const p = node.getPosition();
        const s = node.getSize();
        const curAngle = node.getAngle?.() || 0;
        const edges = getConnectedEdges(targetGraph, node);
        const curData = node.getData?.() || {};
        const name = (curData["name"] as string) || node.id;
        moveItems.push({
          name,
          x: p.x,
          y: p.y,
          width: s.width,
          height: s.height,
          rotation: curAngle,
          flipX: Boolean(curData["flipX"]),
          flipY: Boolean(curData["flipY"]),
          edges,
        });
      }
    });

    syncAllNodeSelectionBoxes(targetGraph, getSelectionContainer());
    syncAlignmentToolbar();

    if (moveItems.length > 0) {
      enqueueDiagramAction({ type: "move", items: moveItems }, targetGraph);
      scheduleUpdateSolderDots(targetGraph);
    }
  };

  // ── Node Duplicate / Copy / Cut / Paste Helpers (Ctrl+D/C/X/V) ──
  const duplicateSelectedNodes = (targetGraph: Graph = g) => {
    if (getReadOnlyForGraph(targetGraph)) return;
    const selectedNodes = getSelectedNonEphemeralNodes(targetGraph);
    if (selectedNodes.length === 0) return;
    const snapshot = snapshotNodesToClipboard(selectedNodes, targetGraph);
    if (snapshot.nodes.length === 0) return;
    emitOffsetComponentCopies(snapshot, 20, targetGraph);
  };

  const copySelectedNodes = (targetGraph: Graph = g): boolean => {
    const selectedNodes = getSelectedNonEphemeralNodes(targetGraph);
    const snapshot = snapshotNodesToClipboard(selectedNodes, targetGraph);
    if (snapshot.nodes.length === 0) return false;
    diagramClipboard = snapshot;
    diagramPasteCount = 1;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(JSON.stringify(snapshot)).catch(() => {
        // Ignore clipboard permission denials in sandboxed iframes/webviews
      });
    }
    return true;
  };

  const pasteSelectedNodes = (targetGraph: Graph = g): boolean => {
    if (getReadOnlyForGraph(targetGraph) || diagramClipboard.nodes.length === 0) return false;
    emitOffsetComponentCopies(diagramClipboard, 20 * diagramPasteCount, targetGraph);
    diagramPasteCount++;
    return true;
  };

  const startInlineNodeEdit = (node: Node) => {
    if (getReadOnlyForGraph(g) || isEphemeralDiagramNode(node.id)) return;
    const existingInput = document.getElementById("__diagram_inline_input__");
    if (existingInput) existingInput.remove();

    const view = g.findViewByCell(node);
    const containerEl = g.container;
    if (!view?.container || !containerEl) return;

    const rect = view.container.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const left = Math.max(8, rect.left - containerRect.left);
    const top = Math.max(8, rect.bottom - containerRect.top - 26);
    const width = Math.min(260, Math.max(90, rect.width));

    const data = node.getData();
    const currentName = String(data?.["name"] ?? data?.properties?.name ?? node.id);

    const input = document.createElement("input");
    input.id = "__diagram_inline_input__";
    input.type = "text";
    input.value = currentName;
    input.style.position = "absolute";
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${width}px`;
    input.style.height = "24px";
    input.style.boxSizing = "border-box";
    input.style.background = isDark ? "#18181b" : "#ffffff";
    input.style.color = isDark ? "#cccccc" : "#333333";
    input.style.border = "1.5px solid #007fd4";
    input.style.borderRadius = "3px";
    input.style.fontFamily = "inherit";
    input.style.fontSize = "12px";
    input.style.textAlign = "center";
    input.style.zIndex = "100000";
    input.style.outline = "none";
    input.style.padding = "0 6px";
    input.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        node.setData({ ...node.getData(), name: newName });
        enqueueDiagramAction({ type: "updateName", oldName: currentName, newName }, g);
        syncAlignmentToolbar();
      }
      input.remove();
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        committed = true;
        input.remove();
      }
    });

    input.addEventListener("blur", () => {
      commit();
    });

    containerEl.appendChild(input);
    input.focus();
    input.select();
  };

  // ── Quick Inline Parameter Value Editor in Floating Toolbar ──
  const startInlineParamEdit = (node: Node, targetGraph: Graph = g) => {
    if (getReadOnlyForGraph(targetGraph) || isEphemeralDiagramNode(node.id)) return;
    const paramInfo = extractNodePrimaryParam(targetGraph, node);
    if (!paramInfo) {
      const nodeName = (node.getData?.()?.["name"] as string) || node.id;
      postMessageToHost({ type: "getProperties", componentName: nodeName }, targetGraph);
      return;
    }

    const paramBtn = alignmentToolbar?.querySelector("[data-action='edit-param'], [data-align='edit-param']") as
      HTMLElement | null | undefined;
    if (!paramBtn) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "align-param-input";
    input.value = paramInfo.paramValue;
    input.title = `Edit ${paramInfo.paramName} (Enter to apply, Esc to cancel)`;
    paramBtn.replaceWith(input);

    let committed = false;
    const commit = (applyChange: boolean) => {
      if (committed) return;
      committed = true;
      const newVal = input.value.trim();
      input.remove();
      alignmentToolbar?.removeAttribute("data-mode-key");
      if (applyChange && newVal && newVal !== paramInfo.paramValue) {
        updateParameterText(node.id, paramInfo.paramName, paramInfo.paramValue, newVal);
        const nodeName = (node.getData?.()?.["name"] as string) || node.id;
        enqueueDiagramAction(
          {
            type: "updateProperty",
            name: nodeName,
            key: paramInfo.paramName,
            value: newVal,
            previousValue: paramInfo.paramValue,
          },
          targetGraph,
        );
      }
      syncAlignmentToolbar();
    };

    input.addEventListener("mousedown", (ev) => ev.stopPropagation());
    input.addEventListener("keydown", (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
    input.focus();
    input.select();
  };

  // ── Delete Selected Cells Helper (Del/Backspace / Floating Toolbar) ──
  const deleteSelectedCells = (targetGraph: Graph = g) => {
    if (getReadOnlyForGraph(targetGraph)) return;
    const cells = targetGraph.getSelectedCells();
    if (cells.length === 0) return;

    const edgesToDelete: { id?: string | undefined; source: string; target: string }[] = [];
    const componentNames: string[] = [];

    cells.forEach((cell: Cell) => {
      if (cell.isEdge()) {
        const source = cell.getSource();
        const target = cell.getTarget();
        const wireId = cell.getData()?.wireId;
        const idStr = wireId || cell.id ? String(wireId || cell.id) : undefined;
        if (source?.cell && source?.port && target?.cell && target?.port) {
          edgesToDelete.push({
            ...(idStr ? { id: idStr } : {}),
            source: `${source.cell}.${source.port}`,
            target: `${target.cell}.${target.port}`,
          });
        } else if (idStr) {
          edgesToDelete.push({
            id: idStr,
            source: idStr,
            target: idStr,
          });
        }
      } else if (cell.isNode() && !isEphemeralDiagramNode(cell.id)) {
        const name = (cell.getData?.()?.["name"] as string) || cell.id;
        componentNames.push(name);
      }
    });

    if (edgesToDelete.length > 0) {
      for (const edge of edgesToDelete) {
        enqueueDiagramAction({ type: "disconnect", ...edge }, targetGraph);
      }
    }
    if (componentNames.length > 0) {
      enqueueDiagramAction({ type: "deleteComponents", names: componentNames }, targetGraph);
    }
    targetGraph.removeCells(cells);
    showAlignmentToolbar(alignmentToolbar, container, [], { sx: 1, sy: 1 }, { tx: 0, ty: 0 });
    scheduleUpdateSolderDots(targetGraph);
  };

  // ── Contextual Floating Edit Bar (Single-Node & Multi-Node) ──
  const alignmentToolbar = ensureAlignmentToolbar(container, (type: AlignmentType) => {
    const currentSelected = getSelectedNonEphemeralNodes(g);
    if (currentSelected.length === 0) return;

    if (type === "rotate-cw") {
      rotateSelectedNodes(90, g);
      return;
    }
    if (type === "rotate-ccw") {
      rotateSelectedNodes(-90, g);
      return;
    }
    if (type === "flip-h") {
      flipSelectedNodes("x", g);
      return;
    }
    if (type === "flip-v") {
      flipSelectedNodes("y", g);
      return;
    }
    if (type === "duplicate") {
      duplicateSelectedNodes(g);
      return;
    }
    if (type === "delete") {
      deleteSelectedCells(g);
      return;
    }
    if (type === "properties") {
      const first = currentSelected[0]!;
      const nodeName = (first.getData?.()?.["name"] as string) || first.id;
      const cachedProps = getPropertyCacheForGraph(g).get(first.id);
      if (cachedProps) {
        showProperties({ id: first.id, properties: cachedProps }, g);
      } else {
        showProperties({ id: first.id, properties: first.getData?.()?.properties, isLoading: true }, g);
        postMessageToHost({ type: "getProperties", componentName: nodeName }, g);
      }
      return;
    }
    if (type === "rename") {
      const first = currentSelected[0];
      if (first) {
        startInlineNodeEdit(first);
      }
      return;
    }
    if (type === "edit-param") {
      const first = currentSelected[0];
      if (first) {
        startInlineParamEdit(first, g);
      }
      return;
    }

    if (getReadOnlyForGraph(g) && !isGraphLayoutEditable(g)) return;
    if (currentSelected.length < 2) return;
    const nodesToAlign: AlignableNode[] = currentSelected.map((n: Node) => {
      const pos = n.getPosition();
      const sz = n.getSize();
      return { id: n.id, x: pos.x, y: pos.y, width: sz.width, height: sz.height };
    });
    const snapGrid = 1;
    const updates = computeNodeAlignment(nodesToAlign, type, snapGrid);
    if (updates.length === 0) return;

    flags.isSnappingPortAlignment = true;
    try {
      g.batchUpdate("align", () => {
        for (const u of updates) {
          const node = g.getCellById(u.id) as Node;
          if (node && typeof node.isNode === "function" && node.isNode()) {
            const oldPos = node.getPosition();
            const dx = u.x - oldPos.x;
            const dy = u.y - oldPos.y;
            node.setPosition(u.x, u.y);
            translateConnectedEdgeStubs(g, node, dx, dy);
          }
        }
      });
    } finally {
      flags.isSnappingPortAlignment = false;
    }

    enqueueDiagramAction(
      {
        type: "move",
        items: updates.map((u) => {
          const node = g.getCellById(u.id) as Node | null;
          const name = (node?.getData?.()?.["name"] as string) || u.id;
          const sz = node?.getSize?.() ?? { width: 20, height: 20 };
          const rotation = node?.getAngle?.() ?? 0;
          const edges = node ? getConnectedEdges(g, node) : undefined;
          return { name, x: u.x, y: u.y, width: sz.width, height: sz.height, rotation, edges };
        }),
      },
      g,
    );

    syncAlignmentToolbar();
  });

  const syncAlignmentToolbar = () => {
    const selectedNodes = getSelectedNonEphemeralNodes(g);

    if (
      typeof document !== "undefined" &&
      document.activeElement &&
      alignmentToolbar?.contains(document.activeElement) &&
      document.activeElement.tagName === "INPUT"
    ) {
      const activeNodeId = alignmentToolbar.getAttribute?.("data-active-node-id");
      const isEditingCurrentSingle = selectedNodes.length === 1 && selectedNodes[0]?.id === activeNodeId;
      if (isEditingCurrentSingle) {
        return;
      }
      (document.activeElement as HTMLElement).blur();
    }
    if (selectedNodes.length >= 1) {
      const nodesToAlign: AlignableNode[] = selectedNodes.map((n: Node) => {
        const pos = n.getPosition();
        const sz = n.getSize();
        const data = n.getData?.() || {};
        const name = String(data["name"] ?? data["properties"]?.["name"] ?? n.id);
        const extractedParam = selectedNodes.length === 1 ? extractNodePrimaryParam(g, n) : undefined;
        const primaryParam = extractedParam
          ? { name: extractedParam.paramName, value: extractedParam.paramValue }
          : undefined;
        return {
          id: n.id,
          x: pos.x,
          y: pos.y,
          width: sz.width,
          height: sz.height,
          name,
          primaryParam,
        };
      });
      const sc = typeof g.scale === "function" ? g.scale() : { sx: 1, sy: 1 };
      const tr = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };
      showAlignmentToolbar(alignmentToolbar, container, nodesToAlign, sc, tr);
    } else {
      showAlignmentToolbar(alignmentToolbar, container, [], { sx: 1, sy: 1 }, { tx: 0, ty: 0 });
    }
  };

  const dispose = () => {
    if (nudgeHudFadeTimeout) {
      clearTimeout(nudgeHudFadeTimeout);
      nudgeHudFadeTimeout = null;
    }
    if (alignmentToolbar?.parentNode) alignmentToolbar.parentNode.removeChild(alignmentToolbar);
    if (nudgeHudEl?.parentNode) nudgeHudEl.parentNode.removeChild(nudgeHudEl);
  };

  return {
    alignmentToolbar,
    rotateSelectedNodes,
    flipSelectedNodes,
    duplicateSelectedNodes,
    copySelectedNodes,
    pasteSelectedNodes,
    deleteSelectedCells,
    startInlineParamEdit,
    startInlineNodeEdit,
    syncAlignmentToolbar,
    showNudgeHud,
    addNudgeDelta,
    dispose,
  };
}
