// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraController } from "../../core/camera.js";
import type { WorldPoint } from "../../schema/canvas-document.js";
import type { CanvasPointerFSM } from "../pointer-fsm.js";
import type { SoaSceneGraph } from "../soa-scene.js";
import type { UnifiedCell, UnifiedGraphOptions } from "./cell.js";
import type { ActiveWidgetInteraction, UnifiedCanvasWidgetSpec } from "./types.js";

export interface DomEventsHost {
  readonly container: HTMLElement;
  readonly options: UnifiedGraphOptions;
  readonly scene: SoaSceneGraph;
  readonly camera: CameraController;
  readonly fsm: CanvasPointerFSM;
  readonly cells: ReadonlyMap<string, UnifiedCell>;
  readonly widgets: ReadonlyMap<string, UnifiedCanvasWidgetSpec>;
  getActiveRenderModeInternal: () => "svg" | "canvas2d";
  getHoveredCellId: () => string | null;
  setHoveredCellId: (id: string | null) => void;
  getActiveWidgetInteraction: () => ActiveWidgetInteraction | null;
  setActiveWidgetInteraction: (inter: ActiveWidgetInteraction | null) => void;
  clientToLocal: (x: number, y: number) => WorldPoint;
  setWidgetPosition: (widgetId: string, x: number, y: number) => boolean;
  setWidgetSize: (widgetId: string, width: number, height: number) => boolean;
  brushPlotWidget: (
    widgetId: string,
    brushRect: { x0: number; y0: number; x1: number; y1: number } | undefined,
  ) => { indices: number[]; linkedIds: string[] };
  applyViewportTransformDom: (panOnly?: boolean) => void;
  syncHoveredPortDom?: ((hoveredPort: { nodeId: string; portId: string } | null) => void) | undefined;
  emit: (event: string, args?: unknown) => void;
}

export function hitTestWidget(
  widgets: ReadonlyMap<string, UnifiedCanvasWidgetSpec>,
  u: number,
  v: number,
): { widget: UnifiedCanvasWidgetSpec; mode: "drag" | "resize" | "brush" } | null {
  const list = Array.from(widgets.values()).reverse();
  for (const w of list) {
    const b = w.bounds;
    if (u < b.x || u > b.x + b.width || v < b.y || v > b.y + b.height) continue;
    // Bottom-right 14x14 corner = resize handle
    if (u >= b.x + b.width - 14 && v >= b.y + b.height - 14) {
      return { widget: w, mode: "resize" };
    }
    // Scatter / Pareto plot body below header = brush select
    if (w.kind === "plot" && w.plot && (w.plot.kind === "scatter" || w.plot.kind === "pareto") && v > b.y + 22) {
      return { widget: w, mode: "brush" };
    }
    // Title bar or sticky/table body = drag move
    return { widget: w, mode: "drag" };
  }
  return null;
}

export function attachGraphDomEventListeners(root: HTMLElement, host: DomEventsHost): () => void {
  const toLocal = (e: MouseEvent | PointerEvent): { u: number; v: number; sx: number; sy: number } => {
    const pt = host.clientToLocal(e.clientX, e.clientY);
    const rect = host.container.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    return { u: pt.x, v: pt.y, sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  let hoveredPort: { nodeId: string; portId: string } | null = null;

  const clearHoveredPort = (e?: Event) => {
    if (!hoveredPort) return;
    const prev = hoveredPort;
    hoveredPort = null;
    host.syncHoveredPortDom?.(null);
    const prevCell = host.cells.get(prev.nodeId);
    if (prevCell) {
      host.emit("port:mouseleave", { node: prevCell, cell: prevCell, port: prev.portId, e });
    }
  };

  const clearHover = (e?: Event) => {
    clearHoveredPort(e);
    const hoveredId = host.getHoveredCellId();
    if (!hoveredId) return;
    const prevCell = host.cells.get(hoveredId);
    host.setHoveredCellId(null);
    if (prevCell) {
      if (prevCell.isNode()) {
        host.emit("node:mouseleave", { node: prevCell, cell: prevCell, e });
      } else {
        host.emit("edge:mouseleave", { edge: prevCell, cell: prevCell, e });
      }
    }
  };

  const updateHover = (e: PointerEvent, u: number, v: number) => {
    if (host.fsm.mode !== "idle" || host.getActiveWidgetInteraction()) {
      clearHoveredPort(e);
      return;
    }
    const targetEl = e.target as Element | null;
    const portEl = targetEl?.closest?.(".ms-port, [data-port], [magnet='true']");
    let nextPort: { nodeId: string; portId: string } | null = null;
    if (portEl) {
      const pId = portEl.getAttribute("port-id") ?? portEl.getAttribute("port") ?? portEl.getAttribute("data-port");
      const nId = portEl.closest?.("[data-cell-id]")?.getAttribute("data-cell-id");
      if (nId && pId) {
        nextPort = { nodeId: nId, portId: pId };
      }
    }
    if (!nextPort) {
      const hoverRadius = Math.min(8, host.fsm.getPortSnapRadius?.() ?? 8);
      const hit = host.scene.hitTestPort(u, v, hoverRadius);
      if (hit) {
        nextPort = { nodeId: hit.nodeId, portId: hit.portId };
      }
    }
    if (nextPort?.nodeId !== hoveredPort?.nodeId || nextPort?.portId !== hoveredPort?.portId) {
      clearHoveredPort(e);
      if (nextPort) {
        hoveredPort = nextPort;
        host.syncHoveredPortDom?.(nextPort);
        const nextCell = host.cells.get(nextPort.nodeId);
        if (nextCell) {
          host.emit("port:mouseenter", { node: nextCell, cell: nextCell, port: nextPort.portId, x: u, y: v, e });
        }
      }
    }

    const cellEl = targetEl?.closest?.("[data-cell-id]");
    let nextId = cellEl?.getAttribute("data-cell-id") ?? null;
    if (!nextId && host.getActiveRenderModeInternal() === "canvas2d") {
      const hitNode = host.scene.hitTestNode(u, v);
      if (hitNode) nextId = hitNode.id;
    }
    if (nextId !== host.getHoveredCellId()) {
      const prevHoveredId = host.getHoveredCellId();
      if (prevHoveredId) {
        const prevCell = host.cells.get(prevHoveredId);
        host.setHoveredCellId(null);
        if (prevCell) {
          if (prevCell.isNode()) {
            host.emit("node:mouseleave", { node: prevCell, cell: prevCell, e });
          } else {
            host.emit("edge:mouseleave", { edge: prevCell, cell: prevCell, e });
          }
        }
      }
      if (nextId) {
        const nextCell = host.cells.get(nextId);
        if (nextCell) {
          host.setHoveredCellId(nextId);
          if (nextCell.isNode()) {
            host.emit("node:mouseenter", { node: nextCell, cell: nextCell, x: u, y: v, e });
          } else {
            host.emit("edge:mouseenter", { edge: nextCell, cell: nextCell, x: u, y: v, e });
          }
        }
      }
    }
    const curHoveredId = host.getHoveredCellId();
    if (curHoveredId) {
      const curCell = host.cells.get(curHoveredId);
      if (curCell) {
        if (curCell.isNode()) {
          host.emit("node:mousemove", { node: curCell, cell: curCell, x: u, y: v, e });
        } else {
          host.emit("edge:mousemove", { edge: curCell, cell: curCell, x: u, y: v, e });
        }
      }
    } else {
      host.emit("blank:mousemove", { x: u, y: v, e });
    }
  };

  const cancelActiveGestures = () => {
    if (host.getActiveWidgetInteraction()) {
      host.setActiveWidgetInteraction(null);
    }
    host.fsm.cancel();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.isPrimary === false) return;
    // Focus the container so scoped keyboard shortcuts work reliably
    if (typeof host.container?.focus === "function" && host.container.tabIndex >= 0) {
      host.container.focus({ preventScroll: true });
    }
    const { u, v, sx, sy } = toLocal(e);
    if (e.button === 0 && host.widgets.size > 0) {
      const hit = hitTestWidget(host.widgets, u, v);
      if (hit) {
        (root as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
        host.setActiveWidgetInteraction({
          mode: hit.mode,
          widgetId: hit.widget.id,
          startU: u,
          startV: v,
          origBounds: { ...hit.widget.bounds },
        });
        return;
      }
    }
    if (e.button === 0 || e.button === 1) {
      (root as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    }
    let pointerPortHit: { nodeId: string; portId: string } | null = null;
    const targetEl = e.target as Element | null;
    const portEl = targetEl?.closest?.(".ms-port, [data-port], [magnet='true']");
    if (portEl) {
      const portId = portEl.getAttribute("port-id") ?? portEl.getAttribute("port") ?? portEl.getAttribute("data-port");
      const nodeEl = portEl.closest?.("[data-cell-id]");
      const nodeId = nodeEl?.getAttribute("data-cell-id");
      if (nodeId && portId) {
        pointerPortHit = { nodeId, portId };
      }
    }
    host.fsm.handleEvent({
      planeId: "primary",
      u,
      v,
      screenX: sx,
      screenY: sy,
      pointerId: e.pointerId,
      isPrimary: e.isPrimary,
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      phase: "down",
      pointerPortHit,
    });
  };

  const onPointerMove = (e: PointerEvent) => {
    const { u, v, sx, sy } = toLocal(e);
    const inter = host.getActiveWidgetInteraction();
    if (inter) {
      if (inter.mode === "drag") {
        host.setWidgetPosition(
          inter.widgetId,
          Math.round(inter.origBounds.x + (u - inter.startU)),
          Math.round(inter.origBounds.y + (v - inter.startV)),
        );
      } else if (inter.mode === "resize") {
        host.setWidgetSize(
          inter.widgetId,
          Math.max(120, Math.round(inter.origBounds.width + (u - inter.startU))),
          Math.max(80, Math.round(inter.origBounds.height + (v - inter.startV))),
        );
      } else if (inter.mode === "brush") {
        host.brushPlotWidget(inter.widgetId, {
          x0: Math.min(inter.startU, u),
          y0: Math.min(inter.startV, v),
          x1: Math.max(inter.startU, u),
          y1: Math.max(inter.startV, v),
        });
      }
      return;
    }
    host.fsm.handleEvent({
      planeId: "primary",
      u,
      v,
      screenX: sx,
      screenY: sy,
      pointerId: e.pointerId,
      isPrimary: e.isPrimary,
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      phase: "move",
    });
    updateHover(e, u, v);
    host.emit("blank:pointermove", { x: u, y: v, e });
    host.emit("cell:pointermove", { x: u, y: v, e });
  };

  const onPointerUp = (e: PointerEvent) => {
    try {
      (root as { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(e.pointerId);
    } catch (err) {
      void err;
    }
    const { u, v, sx, sy } = toLocal(e);
    const finished = host.getActiveWidgetInteraction();
    if (finished) {
      host.setActiveWidgetInteraction(null);
      host.emit("widget:changed", { widgetId: finished.widgetId, mode: finished.mode });
      return;
    }
    const hitNode = host.scene.hitTestNode(u, v);
    const edgeTol = Math.max(4, Math.min(32, 8 / Math.max(0.1, host.camera.getState().zoom)));
    const hitEdge = hitNode ? null : host.scene.hitTestEdge(u, v, edgeTol);
    host.fsm.handleEvent({
      planeId: "primary",
      u,
      v,
      screenX: sx,
      screenY: sy,
      pointerId: e.pointerId,
      isPrimary: e.isPrimary,
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      phase: "up",
    });
    if (!hitNode && !hitEdge && e.button === 0) {
      host.emit("blank:mouseup", { x: u, y: v, e });
      if (host.fsm.wasLastUpCleanBlankClick()) {
        host.emit("blank:click", { x: u, y: v, e });
      }
    }
    host.emit("blank:pointerup", { x: u, y: v, e });
    host.emit("cell:pointerup", { x: u, y: v, e });
  };

  const onPointerCancel = (e: PointerEvent) => {
    try {
      (root as { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(e.pointerId);
    } catch (err) {
      void err;
    }
    cancelActiveGestures();
  };

  const onLostPointerCapture = () => {
    if (host.fsm.mode !== "idle" && host.fsm.mode !== "portal-focused") {
      cancelActiveGestures();
    }
  };

  const onPointerLeave = (e: PointerEvent) => {
    clearHover(e);
    host.emit("blank:mouseleave", { e });
  };

  const onWindowBlur = () => {
    clearHover();
    cancelActiveGestures();
  };

  const onDblClick = (e: MouseEvent) => {
    const { u, v } = toLocal(e);
    const hitNode = host.scene.hitTestNode(u, v);
    if (hitNode) {
      const cell = host.cells.get(hitNode.id);
      if (cell) host.emit("node:dblclick", { node: cell, cell, e });
    } else {
      const edgeTol = Math.max(4, Math.min(32, 8 / Math.max(0.1, host.camera.getState().zoom)));
      const hitEdge = host.scene.hitTestEdge(u, v, edgeTol);
      if (hitEdge) {
        const cell = host.cells.get(hitEdge.edge.id);
        if (cell) host.emit("edge:dblclick", { edge: cell, cell, e });
      }
    }
    host.fsm.handleEvent({
      planeId: "primary",
      u,
      v,
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      phase: "dblclick",
    });
  };

  const onContextMenu = (e: MouseEvent) => {
    const { u, v } = toLocal(e);
    const hitNode = host.scene.hitTestNode(u, v);
    if (hitNode) {
      const cell = host.cells.get(hitNode.id);
      if (cell) host.emit("node:contextmenu", { node: cell, cell, e });
      return;
    }
    const edgeTol = Math.max(4, Math.min(32, 8 / Math.max(0.1, host.camera.getState().zoom)));
    const hitEdge = host.scene.hitTestEdge(u, v, edgeTol);
    if (hitEdge) {
      const cell = host.cells.get(hitEdge.edge.id);
      if (cell) host.emit("edge:contextmenu", { edge: cell, cell, e });
      return;
    }
    host.emit("blank:contextmenu", { x: u, y: v, e });
  };

  const onWheel = (e: WheelEvent) => {
    const mw = host.options.mousewheel;
    const enabled = mw === true || (typeof mw === "object" && mw.enabled !== false);
    if (!enabled) return;

    // Normalize deltaMode (0 = pixels, 1 = lines, 2 = pages)
    const modeScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * modeScale;
    const dx = e.deltaX * modeScale;

    const mods = typeof mw === "object" ? mw.modifiers : undefined;
    const modsArr = Array.isArray(mods) ? mods : typeof mods === "string" ? [mods] : null;
    const zoomModPressed = modsArr
      ? modsArr.some((m) =>
          m === "ctrl"
            ? e.ctrlKey || e.metaKey
            : m === "meta"
              ? e.metaKey
              : m === "shift"
                ? e.shiftKey
                : m === "alt"
                  ? e.altKey
                  : false,
        )
      : e.ctrlKey || e.metaKey;

    if (zoomModPressed) {
      e.preventDefault();
      const rect = host.container.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const next = host.camera.zoomByWheelDelta(dy, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      host.applyViewportTransformDom();
      host.emit("scale", { sx: next.zoom, sy: next.zoom });
    } else if (dx !== 0 || dy !== 0) {
      // Two-finger trackpad scroll / plain wheel pans the canvas smoothly
      const panEnabled =
        host.options.panning === undefined ||
        host.options.panning === true ||
        (typeof host.options.panning === "object" && host.options.panning.enabled !== false);
      if (panEnabled) {
        e.preventDefault();
        const panDx = e.shiftKey && dx === 0 ? -dy : -dx;
        const panDy = e.shiftKey && dx === 0 ? 0 : -dy;
        const next = host.camera.panByScreenDelta(panDx, panDy);
        host.applyViewportTransformDom(true);
        host.emit("translate", { tx: next.tx, ty: next.ty });
      }
    }
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("lostpointercapture", onLostPointerCapture);
  root.addEventListener("pointerleave", onPointerLeave);
  root.addEventListener("dblclick", onDblClick);
  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("wheel", onWheel, { passive: false });
  if (typeof window !== "undefined") {
    window.addEventListener("blur", onWindowBlur);
  }

  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", onPointerUp);
    root.removeEventListener("pointercancel", onPointerCancel);
    root.removeEventListener("lostpointercapture", onLostPointerCapture);
    root.removeEventListener("pointerleave", onPointerLeave);
    root.removeEventListener("dblclick", onDblClick);
    root.removeEventListener("contextmenu", onContextMenu);
    root.removeEventListener("wheel", onWheel);
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", onWindowBlur);
    }
  };
}
