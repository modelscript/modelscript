// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraController } from "../../core/camera.js";
import type { WorldBounds, WorldPoint } from "../../schema/canvas-document.js";
import type { CanvasPointerFSM, ResizeHandleKind } from "../pointer-fsm.js";
import { UnifiedTransform, type UnifiedCell, type UnifiedGraphOptions, type UnifiedTransformOptions } from "./cell.js";
import { escapeSelectorAttr, getResizeCursorForHandle, samplePointAlongPolyline } from "./geometry.js";
import { SVG_NS } from "./types.js";

export interface OverlayDomContext {
  rootEl: HTMLElement | null;
  edgeToolsG: SVGGElement | null;
  selectionOverlayEl: HTMLElement | null;
  cells: ReadonlyMap<string, UnifiedCell>;
  selectedIds: ReadonlySet<string>;
  camera: CameraController;
  fsm: CanvasPointerFSM;
  options: UnifiedGraphOptions;
  coord: { localToGraphRect: (rect: WorldBounds) => WorldBounds };
  getPlugin: (name: string) => unknown;
  clientToLocal: (x: number, y: number) => WorldPoint;
  emit: (event: string, args?: unknown) => void;
  removeCell: (cellOrId: unknown) => UnifiedCell | null;
}

export function canInteractWithCell(
  cell: UnifiedCell,
  fsm: CanvasPointerFSM,
  options: UnifiedGraphOptions,
): { nodeMovable: boolean; edgeMovable: boolean } {
  if (fsm.isReadOnly()) return { nodeMovable: false, edgeMovable: false };
  const inter = options.interacting;
  if (inter === false) return { nodeMovable: false, edgeMovable: false };
  if (typeof inter === "function") {
    const res = inter({ cell });
    if (typeof res === "boolean") return { nodeMovable: res, edgeMovable: res };
    if (res && typeof res === "object") {
      return {
        nodeMovable: res["nodeMovable"] !== false,
        edgeMovable: res["edgeMovable"] !== false,
      };
    }
  }
  return { nodeMovable: true, edgeMovable: true };
}

export function canResizeOrRotateNode(
  cell: UnifiedCell,
  fsm: CanvasPointerFSM,
  options: UnifiedGraphOptions,
  transformPlugin: unknown,
): { canResize: boolean; canRotate: boolean } {
  const { nodeMovable } = canInteractWithCell(cell, fsm, options);
  if (!nodeMovable) return { canResize: false, canRotate: false };
  const data = cell.getData();
  if (data["readOnly"] || data["isInherited"] || data["locked"]) {
    return { canResize: false, canRotate: false };
  }
  if (!(transformPlugin instanceof UnifiedTransform)) {
    return { canResize: true, canRotate: true };
  }
  const evalOpt = (opt: UnifiedTransformOptions["resizing"]): boolean => {
    if (opt === undefined) return true;
    if (typeof opt === "boolean") return opt;
    if (typeof opt.enabled === "function") return opt.enabled(cell);
    return opt.enabled !== false;
  };
  return {
    canResize: evalOpt(transformPlugin.options.resizing),
    canRotate: evalOpt(transformPlugin.options.rotating),
  };
}

/**
 * Renders interactive native SVG edge editing handles (orthogonal segment midpoint bars,
 * vertex dots with drag & right-click delete, and remove pill) directly inside `edgeToolsG`.
 */
export function syncEdgeToolsDom(edge: UnifiedCell, ctx: OverlayDomContext): void {
  if (!ctx.edgeToolsG || typeof document === "undefined") return;
  const escId = escapeSelectorAttr(edge.id);
  const existing = ctx.edgeToolsG.querySelector(`[data-edge-tools-id="${escId}"]`);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
  const tools = edge.getTools();
  const isSelected = ctx.selectedIds.has(edge.id);
  if ((!tools || tools.length === 0) && !isSelected) return;
  if (!ctx.cells.has(edge.id)) return;

  // Enforce read-only and interacting.edgeMovable before rendering any interactive edge tools
  const { edgeMovable } = canInteractWithCell(edge, ctx.fsm, ctx.options);
  if (!edgeMovable) return;

  const toolConfigs = new Map<string, Record<string, unknown>>();
  for (const t of tools) {
    if (typeof t === "string") {
      toolConfigs.set(t, {});
    } else if (t && typeof t === "object" && "name" in t) {
      const obj = t as { name: string; args?: Record<string, unknown> | undefined };
      toolConfigs.set(String(obj.name), obj.args ?? {});
    }
  }
  // Only add default tools when caller did not explicitly configure a custom tool set
  if (isSelected && toolConfigs.size === 0) {
    toolConfigs.set("button-remove", {});
    toolConfigs.set("segments", {});
    toolConfigs.set("vertices", {});
  }
  if (toolConfigs.size === 0) return;

  const zoom = Math.max(0.1, ctx.camera.getState().zoom);
  const invZoom = 1 / zoom;

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("data-edge-tools-id", edge.id);
  group.setAttribute("class", "ms-edge-tools-group");

  const sourcePt = edge.getSourcePoint();
  const targetPt = edge.getTargetPoint();
  const verts = edge.getVertices();
  const routePts = edge.view?.routePoints ?? [];
  const activePts = verts.length > 0 ? verts : routePts;
  const fullPoly = [sourcePt, ...activePts, targetPt];

  // 1. Orthogonal segment drag bars at each segment midpoint (screen-constant size + generous hit target)
  if (toolConfigs.has("segments")) {
    const segArgs = toolConfigs.get("segments") ?? {};
    const segAttrs = (segArgs["attrs"] as Record<string, unknown> | undefined) ?? {};
    const segFill = typeof segAttrs["fill"] === "string" ? segAttrs["fill"] : "#38bdf8";
    const segStroke = typeof segAttrs["stroke"] === "string" ? segAttrs["stroke"] : "#0f172a";
    const barLen = 14 * invZoom;
    const barThick = 6 * invZoom;
    const hitPad = 6 * invZoom;

    for (let i = 0; i < fullPoly.length - 1; i++) {
      const a = fullPoly[i]!;
      const b = fullPoly[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 16 * invZoom) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const isHoriz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

      const segG = document.createElementNS(SVG_NS, "g");
      segG.setAttribute("class", "ms-segment-handle");
      segG.style.cursor = isHoriz ? "ns-resize" : "ew-resize";

      // Transparent >=18px screen hit area
      const hitRect = document.createElementNS(SVG_NS, "rect");
      hitRect.setAttribute("x", String(mx - (isHoriz ? barLen / 2 : barThick / 2) - hitPad));
      hitRect.setAttribute("y", String(my - (isHoriz ? barThick / 2 : barLen / 2) - hitPad));
      hitRect.setAttribute("width", String((isHoriz ? barLen : barThick) + hitPad * 2));
      hitRect.setAttribute("height", String((isHoriz ? barThick : barLen) + hitPad * 2));
      hitRect.setAttribute("fill", "transparent");
      segG.appendChild(hitRect);

      const bar = document.createElementNS(SVG_NS, "rect");
      bar.setAttribute("x", String(mx - (isHoriz ? barLen / 2 : barThick / 2)));
      bar.setAttribute("y", String(my - (isHoriz ? barThick / 2 : barLen / 2)));
      bar.setAttribute("width", String(isHoriz ? barLen : barThick));
      bar.setAttribute("height", String(isHoriz ? barThick : barLen));
      bar.setAttribute("rx", String(2 * invZoom));
      bar.setAttribute("fill", segFill);
      bar.setAttribute("stroke", segStroke);
      bar.setAttribute("stroke-width", String(1 * invZoom));
      segG.appendChild(bar);

      segG.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (ctx.rootEl as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(e.pointerId);
        const pt = ctx.clientToLocal(e.clientX, e.clientY);
        ctx.fsm.startSegmentDrag(edge.id, i, pt.x, pt.y, e.pointerId);
      });
      group.appendChild(segG);
    }
  }

  // 2. Vertex drag dots (right-click or double-click removes vertex; screen-constant size + >=18px hit target)
  if (toolConfigs.has("vertices")) {
    const vArgs = toolConfigs.get("vertices") ?? {};
    const vAttrs = (vArgs["attrs"] as Record<string, unknown> | undefined) ?? {};
    const vFill = typeof vAttrs["fill"] === "string" ? vAttrs["fill"] : "#f8fafc";
    const vStroke = typeof vAttrs["stroke"] === "string" ? vAttrs["stroke"] : "#0284c7";
    const dotR = 4.5 * invZoom;
    const hitR = 9 * invZoom;

    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]!;
      const vG = document.createElementNS(SVG_NS, "g");
      vG.setAttribute("class", "ms-vertex-handle");
      vG.style.cursor = "move";

      const hitCircle = document.createElementNS(SVG_NS, "circle");
      hitCircle.setAttribute("cx", String(v.x));
      hitCircle.setAttribute("cy", String(v.y));
      hitCircle.setAttribute("r", String(hitR));
      hitCircle.setAttribute("fill", "transparent");
      vG.appendChild(hitCircle);

      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(v.x));
      dot.setAttribute("cy", String(v.y));
      dot.setAttribute("r", String(dotR));
      dot.setAttribute("fill", vFill);
      dot.setAttribute("stroke", vStroke);
      dot.setAttribute("stroke-width", String(1.5 * invZoom));
      vG.appendChild(dot);

      vG.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (ctx.rootEl as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(e.pointerId);
        const pt = ctx.clientToLocal(e.clientX, e.clientY);
        ctx.fsm.startVertexDrag(edge.id, i, pt.x, pt.y, e.pointerId);
      });
      const removeVertex = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const next = edge.getVertices();
        next.splice(i, 1);
        edge.setVertices(next);
        syncEdgeToolsDom(edge, ctx);
      };
      vG.addEventListener("contextmenu", removeVertex);
      vG.addEventListener("dblclick", removeVertex);
      group.appendChild(vG);
    }
  }

  // 3. Remove connection pill button with accessible tooltip (screen-constant size)
  if (toolConfigs.has("button-remove")) {
    const mid = samplePointAlongPolyline(fullPoly, 0.5);
    const btnG = document.createElementNS(SVG_NS, "g");
    btnG.setAttribute("class", "ms-edge-remove-btn");
    btnG.setAttribute("transform", `translate(${mid.x + 12 * invZoom}, ${mid.y - 12 * invZoom}) scale(${invZoom})`);
    btnG.setAttribute("role", "button");
    btnG.setAttribute("aria-label", "Delete connection");
    btnG.style.cursor = "pointer";
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = "Delete connection (Del)";
    btnG.appendChild(title);
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", "8");
    circle.setAttribute("fill", "#ef4444");
    circle.setAttribute("stroke", "#ffffff");
    circle.setAttribute("stroke-width", "1.5");
    const cross = document.createElementNS(SVG_NS, "path");
    cross.setAttribute("d", "M -2.8 -2.8 L 2.8 2.8 M 2.8 -2.8 L -2.8 2.8");
    cross.setAttribute("stroke", "#ffffff");
    cross.setAttribute("stroke-width", "1.6");
    cross.setAttribute("stroke-linecap", "round");
    btnG.appendChild(circle);
    btnG.appendChild(cross);
    btnG.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      ctx.emit("edge:remove-requested", { edge, cell: edge });
      ctx.removeCell(edge);
    });
    group.appendChild(btnG);
  }

  ctx.edgeToolsG.appendChild(group);
}

export function syncSelectionBoxesDom(ctx: OverlayDomContext, panOnly = false): void {
  if (!ctx.selectionOverlayEl || typeof document === "undefined") return;

  // Skip rebuilding edge tools during pan-only viewport updates (SVG edges move via viewportG matrix)
  if (!panOnly) {
    for (const cell of ctx.cells.values()) {
      if (cell.isEdge()) {
        const isSel = ctx.selectedIds.has(cell.id);
        const haloEl = cell.selectorElements.get("halo")?.[0] as SVGElement | undefined;
        if (haloEl) haloEl.style.display = isSel ? "" : "none";
        cell.view?.container?.classList?.toggle?.("ms-edge-selected", isSel);
        if (isSel || cell.getTools().length > 0) {
          syncEdgeToolsDom(cell, ctx);
        } else if (ctx.edgeToolsG) {
          const oldTools = ctx.edgeToolsG.querySelector(`[data-edge-tools-id="${escapeSelectorAttr(cell.id)}"]`);
          if (oldTools && oldTools.parentNode) oldTools.parentNode.removeChild(oldTools);
        }
      }
    }
  }

  const mode = ctx.fsm.mode;
  if (panOnly || mode === "resizing" || mode === "rotating") {
    let updatedAll = true;
    for (const id of ctx.selectedIds) {
      const cell = ctx.cells.get(id);
      if (!cell || !cell.isNode()) continue;
      const existingBox = ctx.selectionOverlayEl.querySelector(
        `.ms-selection-box[data-cell-id="${escapeSelectorAttr(cell.id)}"]`,
      ) as HTMLElement | null;
      if (existingBox) {
        const rect = ctx.coord.localToGraphRect(cell.getBBox());
        existingBox.style.left = `${rect.x}px`;
        existingBox.style.top = `${rect.y}px`;
        existingBox.style.width = `${rect.width}px`;
        existingBox.style.height = `${rect.height}px`;
        existingBox.style.transform = cell.angle !== 0 ? `rotate(${cell.angle}deg)` : "";
        if (mode === "rotating") {
          existingBox.querySelectorAll<HTMLElement>(".ms-resize-handle").forEach((hEl) => {
            const hk = hEl.getAttribute("data-handle") as ResizeHandleKind | null;
            if (hk) hEl.style.cursor = getResizeCursorForHandle(hk, cell.angle);
          });
        }
      } else {
        updatedAll = false;
      }
    }
    if (updatedAll) return;
  }

  ctx.selectionOverlayEl.innerHTML = "";
  const handles: ResizeHandleKind[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w", "rotate"];

  for (const id of ctx.selectedIds) {
    const cell = ctx.cells.get(id);
    if (!cell || !cell.isNode()) continue;
    const rect = ctx.coord.localToGraphRect(cell.getBBox());
    const { canResize, canRotate } = canResizeOrRotateNode(cell, ctx.fsm, ctx.options, ctx.getPlugin("transform"));

    const box = document.createElement("div");
    box.className = "ms-selection-box";
    box.setAttribute("data-cell-id", cell.id);
    box.style.position = "absolute";
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.border = "1.5px solid #0284c7";
    box.style.boxSizing = "content-box";
    box.style.margin = "-5px 0 0 -5px";
    box.style.padding = "4px";
    box.style.pointerEvents = "none";
    if (cell.angle !== 0) {
      box.style.transform = `rotate(${cell.angle}deg)`;
      box.style.transformOrigin = "center center";
    }

    if (canRotate) {
      // Vertical lollipop stem connecting rotate handle to top-center
      const stem = document.createElement("div");
      stem.className = "ms-rotate-stem";
      stem.style.position = "absolute";
      stem.style.left = "50%";
      stem.style.top = "-14px";
      stem.style.width = "1.5px";
      stem.style.height = "14px";
      stem.style.marginLeft = "-0.75px";
      stem.style.background = "#10b981";
      stem.style.pointerEvents = "none";
      box.appendChild(stem);
    }

    const cellW = cell.width || 1;
    const cellH = cell.height || 1;
    const isMidpointOccludingPort = (h: ResizeHandleKind): boolean => {
      if (h !== "n" && h !== "e" && h !== "s" && h !== "w") return false;
      if ((h === "n" || h === "s") && rect.width < 36) return true;
      if ((h === "e" || h === "w") && rect.height < 36) return true;
      const hx = h === "w" ? 0 : h === "e" ? cellW : cellW / 2;
      const hy = h === "n" ? 0 : h === "s" ? cellH : cellH / 2;
      const tol = Math.max(8, Math.min(cellW, cellH) * 0.25);
      for (const p of cell.getPorts()) {
        const px = p.args?.x ?? cellW / 2;
        const py = p.args?.y ?? cellH / 2;
        if (Math.hypot(px - hx, py - hy) <= tol) return true;
      }
      return false;
    };

    for (const h of handles) {
      if (h === "rotate" ? !canRotate : !canResize) continue;
      if (isMidpointOccludingPort(h)) continue;
      const dot = document.createElement("div");
      dot.className = `ms-resize-handle ms-handle-${h}`;
      dot.setAttribute("data-handle", h);
      dot.style.position = "absolute";
      dot.style.width = h === "rotate" ? "10px" : "8px";
      dot.style.height = h === "rotate" ? "10px" : "8px";
      dot.style.borderRadius = h === "rotate" ? "999px" : "2px";
      dot.style.background = h === "rotate" ? "#10b981" : "#ffffff";
      dot.style.border = h === "rotate" ? "1.5px solid #064e3b" : "1.5px solid #0284c7";
      dot.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.25)";
      dot.style.pointerEvents = "auto";
      dot.style.cursor = getResizeCursorForHandle(h, cell.angle);
      if (h === "nw") {
        dot.style.left = "-5px";
        dot.style.top = "-5px";
      } else if (h === "n") {
        dot.style.left = "50%";
        dot.style.top = "-5px";
        dot.style.marginLeft = "-5px";
      } else if (h === "ne") {
        dot.style.right = "-5px";
        dot.style.top = "-5px";
      } else if (h === "e") {
        dot.style.right = "-5px";
        dot.style.top = "50%";
        dot.style.marginTop = "-5px";
      } else if (h === "se") {
        dot.style.right = "-5px";
        dot.style.bottom = "-5px";
      } else if (h === "s") {
        dot.style.left = "50%";
        dot.style.bottom = "-5px";
        dot.style.marginLeft = "-5px";
      } else if (h === "sw") {
        dot.style.left = "-5px";
        dot.style.bottom = "-5px";
      } else if (h === "w") {
        dot.style.left = "-5px";
        dot.style.top = "50%";
        dot.style.marginTop = "-5px";
      } else if (h === "rotate") {
        dot.style.left = "50%";
        dot.style.top = "-22px";
        dot.style.marginLeft = "-6px";
        dot.title = "Drag to rotate (hold Shift for 15° snap)";
      }
      dot.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (ctx.rootEl as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(e.pointerId);
        const pt = ctx.clientToLocal(e.clientX, e.clientY);
        ctx.fsm.startResize(cell.id, h, pt.x, pt.y, e.pointerId);
      });
      box.appendChild(dot);
    }

    ctx.selectionOverlayEl.appendChild(box);
  }
}
