// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  autoLayoutDiagramAsync,
  disposeDiagram,
  dropComponentGhost,
  flipSelectedNodes,
  getGraph,
  hydrateDiagramWasm,
  initGraph,
  isEphemeralDiagramNode,
  isMinimapVisible,
  renderDiagram,
  rotateSelectedNodes,
  setDiagramGrid,
  setDiagramOptions,
  setDiagramSnap,
  toggleMinimap,
  updateParameterText,
  type DiagramGridMode,
} from "@modelscript/diagram";
import type { Theme } from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { clearPlacement, movePlacementGhost } from "./placement";

export interface DiagramEditorHandle {
  fitContent: () => void;
  layout: () => Promise<boolean>;
  zoomIn: (factor?: number) => number;
  zoomOut: (factor?: number) => number;
  zoomTo: (scale: number) => void;
  zoomToFit: () => void;
  getZoom: () => number;
  rotateSelected: (deltaDegrees?: number) => void;
  flipSelected?: (axis?: "x" | "y") => void;
  updateParameterText?: (nodeId: string, paramName: string, oldValue: string, newValue: string) => void;
  toggleMinimap: () => boolean;
  isMinimapOpen: () => boolean;
  setGridMode: (mode: DiagramGridMode) => void;
  setSnapToGrid: (enabled: boolean) => void;
  centerCell?: (cellId: string) => void;
}

interface DiagramEditorProps {
  diagramData: any | null;
  diagramClassName?: string | null | undefined;
  onZoomChange?: ((zoom: number) => void) | undefined;
  onSelect?: ((componentName: string | null) => void) | undefined;
  onDrop?: ((className: string, x: number, y: number, iconSvg?: string | null) => void) | undefined;
  onConnect?: ((source: string, target: string, points?: { x: number; y: number }[]) => void) | undefined;
  onMove?:
    | ((
        items: {
          name: string;
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
          edges?: { source: string; target: string; points: { x: number; y: number }[] }[] | undefined;
          connectedOnly?: boolean | undefined;
        }[],
      ) => void)
    | undefined;
  onResize?:
    | ((
        name: string,
        x: number,
        y: number,
        width: number,
        height: number,
        rotation: number,
        edges?: { source: string; target: string; points: { x: number; y: number }[] }[],
      ) => void)
    | undefined;
  onEdgeMove?: ((edges: { source: string; target: string; points: { x: number; y: number }[] }[]) => void) | undefined;
  onEdgeDelete?: ((source: string, target: string) => void) | undefined;
  onComponentDelete?: ((name: string) => void) | undefined;
  onComponentsDelete?: ((names: string[]) => void) | undefined;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  onAutoLayout?: (() => void) | undefined;
  selectedName?: string | null | undefined;
  theme: Theme;
  isLoading?: boolean | undefined;
  onRenderComplete?: ((diagramData: any) => void) | undefined;
  onInteractiveWrite?: ((variableName: string, value: any, nodeId: string) => void) | undefined;
  onAction?: ((action: any) => void) | undefined;
  onMessage?: ((msg: any) => void) | undefined;
  onShowProperties?: ((nodeId: string, cachedProps?: any, isLoading?: boolean) => void) | undefined;
  onNodeDoubleClick?: ((nodeId: string, nodeData?: any) => void) | undefined;
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
}

type DiagramGraphInstance = {
  cleanSelection?: () => void;
  select?: (cell: unknown) => void;
  centerCell?: (cell: unknown, opts?: { animation?: { duration?: number } }) => void;
  findViewByCell?: (cell: unknown) => { container?: HTMLElement | null } | null;
  off?: (event: string, fn: unknown) => void;
  on?: (event: string, fn: unknown) => void;
  getCellById?: (id: string) => unknown;
};

const DiagramEditor = forwardRef<DiagramEditorHandle, DiagramEditorProps>((props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInternalSelectionRef = useRef<string | null>(null);

  // Use a ref for props so callbacks in event listeners have access to latest props
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const handleNodeDblClick = useRef(({ node }: any) => {
    if (!node || isEphemeralDiagramNode(node.id)) return;
    const data = typeof node.getData === "function" ? node.getData() : undefined;
    propsRef.current.onNodeDoubleClick?.(node.id, data);
  }).current;

  const handleScale = useRef(({ sx }: any) => {
    if (typeof sx === "number" && !isNaN(sx)) {
      propsRef.current.onZoomChange?.(Math.round(sx * 100) / 100);
    }
  }).current;

  const attachGraphListeners = () => {
    const g = getGraph(containerRef.current) as DiagramGraphInstance | null;
    if (g && typeof g.on === "function") {
      g.off?.("node:dblclick", handleNodeDblClick);
      g.on("node:dblclick", handleNodeDblClick);
      g.off?.("scale", handleScale);
      g.on("scale", handleScale);
    }
  };

  const syncDiagramOptions = () => {
    if (!containerRef.current) return;

    setDiagramOptions({
      container: containerRef.current,
      isDark: props.theme === "vs-dark",
      onAction: (action: any) => {
        const p = propsRef.current;
        switch (action.type) {
          case "move":
            if (p.onMove) p.onMove(action.items);
            else p.onAction?.(action);
            break;
          case "resize":
            if (p.onResize)
              p.onResize(
                action.item.name,
                action.item.x,
                action.item.y,
                action.item.width,
                action.item.height,
                action.item.rotation,
                action.item.edges,
              );
            else p.onAction?.(action);
            break;
          case "connect":
            if (p.onConnect) p.onConnect(action.source, action.target, action.points);
            else p.onAction?.(action);
            break;
          case "disconnect":
            if (p.onEdgeDelete) p.onEdgeDelete(action.source, action.target);
            else p.onAction?.(action);
            break;
          case "moveEdge":
            if (p.onEdgeMove) p.onEdgeMove(action.edges);
            else p.onAction?.(action);
            break;
          case "deleteComponents":
            if (p.onComponentsDelete) p.onComponentsDelete(action.names);
            else if (p.onComponentDelete && action.names.length > 0) p.onComponentDelete(action.names[0]);
            else p.onAction?.(action);
            break;
          case "interactiveWrite":
            if (p.onInteractiveWrite) p.onInteractiveWrite(action.variableName, action.value, action.nodeId);
            else p.onAction?.(action);
            break;
          default:
            // Forward addComponent, reconnect, updateName, updateProperty, rotate, etc.
            p.onAction?.(action);
            break;
        }
      },
      onSelect: (id) => {
        isInternalSelectionRef.current = id;
        if (propsRef.current.onSelect) propsRef.current.onSelect(id);
      },
      onShowProperties: (id, cachedProps, isLoading) => {
        isInternalSelectionRef.current = id;
        if (propsRef.current.onShowProperties) {
          propsRef.current.onShowProperties(id, cachedProps, isLoading);
        }
      },
      onUndo: () => propsRef.current.onUndo?.(),
      onRedo: () => propsRef.current.onRedo?.(),
      onAutoLayout: () => propsRef.current.onAutoLayout?.(),
      onMessage: (msg) => propsRef.current.onMessage?.(msg),
      fitInsets: propsRef.current.fitInsets,
    });
    attachGraphListeners();
  };

  const applyDiagramViewportFit = (g: any, cw: number, ch: number, padding = 24) => {
    const insets = propsRef.current.fitInsets;
    const top = insets?.top ?? 0;
    const right = insets?.right ?? 0;
    const bottom = insets?.bottom ?? 0;
    const left = insets?.left ?? 0;
    const vw = Math.max(120, cw - left - right);
    const vh = Math.max(120, ch - top - bottom);
    const viewportArea = { x: left, y: top, width: vw, height: vh };
    const shiftX = (left - right) / 2;
    const shiftY = (top - bottom) / 2;

    const cs = propsRef.current.diagramData?.coordinateSystem;
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
      if (typeof g.zoomToRect === "function") {
        g.zoomToRect(expandedRect, { viewportArea });
      } else {
        g.zoomToFit?.({ maxScale: 1, padding, viewportArea });
      }
      const ox = cs.axesStyle?.origin?.[0] ?? 0;
      const oy = cs.axesStyle?.origin?.[1] ?? 0;
      if (typeof g.centerPoint === "function") {
        g.centerPoint(ox, oy);
      } else if (typeof g.centerContent === "function") {
        g.centerContent();
      }
    } else if (typeof g.zoomToFit === "function") {
      g.zoomToFit({ maxScale: 1, padding, viewportArea });
      g.centerContent?.();
    }

    if ((shiftX !== 0 || shiftY !== 0) && typeof g.translate === "function") {
      const cur = g.translate();
      if (cur && typeof cur.tx === "number" && typeof cur.ty === "number") {
        g.translate(cur.tx + shiftX, cur.ty + shiftY);
      }
    }
  };

  useImperativeHandle(ref, () => ({
    fitContent: () => {
      syncDiagramOptions();
      const container = containerRef.current;
      const g = getGraph(container) ?? (container ? initGraph(props.theme === "vs-dark", container) : null);
      if (g && container) {
        try {
          const parent = container.parentElement;
          const parentW = parent?.clientWidth ?? 0;
          const parentH = parent?.clientHeight ?? 0;
          const cw = parentW > 0 ? parentW : container.clientWidth > 0 ? container.clientWidth : 800;
          const ch = parentH > 0 ? parentH : container.clientHeight > 0 ? container.clientHeight : 600;
          if (typeof (g as any).resize === "function" && cw > 0 && ch > 0) {
            (g as any).resize(cw, ch);
          }
          applyDiagramViewportFit(g, cw, ch, 20);
          if (typeof (g as any).zoom === "function") {
            propsRef.current.onZoomChange?.(Math.round((g as any).zoom() * 100) / 100);
          }
        } catch {
          // ignore if zoom fails before layout
        }
      }
    },
    layout: async () => {
      const container = containerRef.current;
      const g = (getGraph(container) ?? getGraph()) as any;
      if (g) {
        return autoLayoutDiagramAsync(g);
      } else if (typeof window !== "undefined") {
        window.postMessage({ type: "autoLayout" }, "*");
        return true;
      }
      return false;
    },
    zoomIn: (factor = 0.15) => {
      const container = containerRef.current;
      const g = (getGraph(container) ?? getGraph()) as any;
      if (g && typeof g.zoom === "function") {
        const current = g.zoom();
        const next = Math.min(10.0, Math.round((current + factor) * 100) / 100);
        if (typeof g.zoomTo === "function") {
          g.zoomTo(next);
        } else {
          g.zoom(next, { absolute: true });
        }
        propsRef.current.onZoomChange?.(next);
        return next;
      }
      return 1;
    },
    zoomOut: (factor = 0.15) => {
      const container = containerRef.current;
      const g = (getGraph(container) ?? getGraph()) as any;
      if (g && typeof g.zoom === "function") {
        const current = g.zoom();
        const next = Math.max(0.1, Math.round((current - factor) * 100) / 100);
        if (typeof g.zoomTo === "function") {
          g.zoomTo(next);
        } else {
          g.zoom(next, { absolute: true });
        }
        propsRef.current.onZoomChange?.(next);
        return next;
      }
      return 1;
    },
    zoomTo: (scale: number) => {
      const container = containerRef.current;
      const g = (getGraph(container) ?? getGraph()) as any;
      if (g && (typeof g.zoomTo === "function" || typeof g.zoom === "function")) {
        const clamped = Math.max(0.1, Math.min(10.0, scale));
        if (typeof g.zoomTo === "function") {
          g.zoomTo(clamped);
        } else {
          g.zoom(clamped, { absolute: true });
        }
        propsRef.current.onZoomChange?.(clamped);
      }
    },
    zoomToFit: () => {
      syncDiagramOptions();
      const container = containerRef.current;
      const g = (getGraph(container) ?? getGraph()) as any;
      if (g && typeof g.zoomToFit === "function") {
        const parent = container?.parentElement;
        const parentW = parent?.clientWidth ?? 0;
        const parentH = parent?.clientHeight ?? 0;
        const cw =
          parentW > 0 ? parentW : container?.clientWidth && container.clientWidth > 0 ? container.clientWidth : 800;
        const ch =
          parentH > 0 ? parentH : container?.clientHeight && container.clientHeight > 0 ? container.clientHeight : 600;
        if (typeof g.resize === "function" && cw > 0 && ch > 0) {
          g.resize(cw, ch);
        }
        applyDiagramViewportFit(g, cw, ch, 24);
        if (typeof g.zoom === "function") {
          propsRef.current.onZoomChange?.(Math.round(g.zoom() * 100) / 100);
        }
      }
    },
    getZoom: () => {
      const g = (getGraph(containerRef.current) ?? getGraph()) as any;
      if (g && typeof g.zoom === "function") {
        return Math.round(g.zoom() * 100) / 100;
      }
      return 1;
    },
    rotateSelected: (deltaDegrees = 90) => {
      const g = (getGraph(containerRef.current) ?? getGraph()) as any;
      if (!g) return;
      rotateSelectedNodes(deltaDegrees, g);
    },
    flipSelected: (axis: "x" | "y" = "x") => {
      const g = (getGraph(containerRef.current) ?? getGraph()) as any;
      if (!g) return;
      flipSelectedNodes(axis, g);
    },
    updateParameterText: (nodeId: string, paramName: string, oldValue: string, newValue: string) => {
      updateParameterText(nodeId, paramName, oldValue, newValue, containerRef.current);
    },
    toggleMinimap: () => {
      return toggleMinimap(containerRef.current);
    },
    isMinimapOpen: () => {
      return isMinimapVisible(containerRef.current);
    },
    setGridMode: (mode: DiagramGridMode) => {
      setDiagramGrid(mode, (getGraph(containerRef.current) ?? getGraph()) as any);
    },
    setSnapToGrid: (enabled: boolean) => {
      setDiagramSnap(enabled, (getGraph(containerRef.current) ?? getGraph()) as any);
    },
    centerCell: (cellId: string) => {
      const g = (getGraph(containerRef.current) ?? getGraph()) as any;
      if (!g || !cellId) return;
      const cell = g.getCellById?.(cellId);
      if (cell) {
        try {
          const cellView = g.findViewByCell(cell);
          if (cellView?.container) {
            cellView.container.classList.add("modelscript-anchor-halo");
            setTimeout(() => {
              cellView.container?.classList.remove("modelscript-anchor-halo");
            }, 3000);
          }
          g.centerCell?.(cell, { animation: { duration: 300 } });
        } catch {
          // fallback if animation unsupported
        }
      }
    },
  }));

  useEffect(() => {
    syncDiagramOptions();
  }, [props.theme]);

  const hasFittedViewportRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    void hydrateDiagramWasm("/lsp/server/dist/release.wasm");

    const target = container.parentElement ?? container;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            if (width <= 0 || height <= 0) return;

            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              const g = getGraph(container);
              const zoomable = g as unknown as {
                isDisposed?: () => boolean;
                zoomToRect?: (rect: unknown, options?: unknown) => void;
                zoomToFit?: (options?: unknown) => void;
                centerContent?: () => void;
              };
              if (g && (typeof zoomable.isDisposed === "function" ? !zoomable.isDisposed() : true)) {
                g.resize(Math.round(width), Math.round(height));
                // Only fit/center automatically if the canvas had not yet been fitted in a visible viewport
                // (e.g., transitioning from a 0x0 hidden tab). Subsequent resizes such as opening/closing the
                // Properties panel on component selection must preserve the user's current pan and zoom.
                if (
                  !hasFittedViewportRef.current &&
                  propsRef.current.diagramData &&
                  !propsRef.current.diagramData.isLoading
                ) {
                  hasFittedViewportRef.current = true;
                  applyDiagramViewportFit(g, width, height, 24);
                }
                if (typeof (g as any).zoom === "function") {
                  propsRef.current.onZoomChange?.(Math.round((g as any).zoom() * 100) / 100);
                }
              }
            }, 60);
          })
        : null;

    ro?.observe(target);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      ro?.disconnect();
      disposeDiagram(container);
    };
  }, []);

  useEffect(() => {
    if (containerRef.current && getGraph(containerRef.current)) {
      syncDiagramOptions();
    }
  }, [props.fitInsets?.top, props.fitInsets?.right, props.fitInsets?.bottom, props.fitInsets?.left]);

  useEffect(() => {
    if (props.diagramData && containerRef.current) {
      try {
        syncDiagramOptions();
        renderDiagram(props.diagramData, props.theme === "vs-dark");
        attachGraphListeners();
        const rect = (containerRef.current.parentElement ?? containerRef.current).getBoundingClientRect();
        if (!props.diagramData.isLoading && rect.width > 0 && rect.height > 0) {
          hasFittedViewportRef.current = true;
        }
      } catch (err) {
        console.error("Failed to render diagram:", err);
      } finally {
        if (props.onRenderComplete) props.onRenderComplete(props.diagramData);
      }
    } else if (!props.diagramData && containerRef.current) {
      try {
        syncDiagramOptions();
        renderDiagram({ nodes: [], edges: [] } as unknown as DiagramData, props.theme === "vs-dark");
        attachGraphListeners();
      } catch {
        // ignore empty canvas initialization errors
      }
      hasFittedViewportRef.current = false;
      if (props.onRenderComplete) props.onRenderComplete(null);
    } else if (!props.diagramData && props.onRenderComplete) {
      hasFittedViewportRef.current = false;
      props.onRenderComplete(null);
    }
  }, [props.diagramData, props.theme]);

  useEffect(() => {
    if (props.selectedName !== undefined) {
      const g = getGraph(containerRef.current) as DiagramGraphInstance | null;
      if (!g) return;
      if (!props.selectedName || isEphemeralDiagramNode(props.selectedName)) {
        isInternalSelectionRef.current = null;
        g.cleanSelection?.();
      } else {
        const isInternal = isInternalSelectionRef.current === props.selectedName;
        isInternalSelectionRef.current = null;

        const cell = g.getCellById(props.selectedName);
        if (cell) {
          if (!isInternal) {
            g.cleanSelection?.();
            g.select?.(cell);
          }
        }
      }
    }
  }, [props.selectedName, props.theme]);

  const [scrubbedPoint, setScrubbedPoint] = useState<{
    time: number | null;
    values: Record<string, number> | null;
  }>({ time: null, values: null });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleTimeScrub = (e: Event) => {
      const detail = (e as CustomEvent<{ time?: number | null; values?: Record<string, number> | null }>).detail;
      if (detail && detail.time != null && Number.isFinite(detail.time)) {
        setScrubbedPoint({ time: detail.time, values: detail.values ?? null });
      } else {
        setScrubbedPoint({ time: null, values: null });
      }
    };
    window.addEventListener("morsel:time-scrub", handleTimeScrub);
    return () => window.removeEventListener("morsel:time-scrub", handleTimeScrub);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let currentHighlightedContainer: HTMLElement | null = null;
    let currentGlowElement: SVGElement | null = null;

    const clearHighlight = () => {
      if (currentGlowElement) {
        currentGlowElement.remove();
        currentGlowElement = null;
      }
      if (currentHighlightedContainer) {
        currentHighlightedContainer.classList.remove("modelscript-hover-halo");
        currentHighlightedContainer = null;
      }
    };

    const handleHighlight = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string | null }>).detail;
      const targetName = detail?.name;

      clearHighlight();

      if (targetName && containerRef.current) {
        const g = getGraph(containerRef.current) as DiagramGraphInstance | null;
        if (g) {
          const cell = g.getCellById?.(targetName);
          if (cell) {
            const cellView = g.findViewByCell?.(cell);
            if (cellView?.container) {
              const svgNs = "http://www.w3.org/2000/svg";
              const size = (cell as { getSize?: () => { width?: number; height?: number } }).getSize?.();
              const width = size?.width && size.width > 0 ? size.width : 40;
              const height = size?.height && size.height > 0 ? size.height : 40;
              const cx = width / 2;
              const cy = height / 2;
              const radius = Math.max(width, height) * 0.9;
              const gradId = "modelscript-hover-radial-glow";

              const glowGroup = document.createElementNS(svgNs, "g");
              glowGroup.setAttribute("class", "modelscript-hover-glow");
              glowGroup.setAttribute("pointer-events", "none");

              const defs = document.createElementNS(svgNs, "defs");
              const grad = document.createElementNS(svgNs, "radialGradient");
              grad.setAttribute("id", gradId);
              grad.setAttribute("cx", "50%");
              grad.setAttribute("cy", "50%");
              grad.setAttribute("r", "50%");

              const stops: Array<[string, string]> = [
                ["0%", "0.45"],
                ["45%", "0.24"],
                ["75%", "0.08"],
                ["100%", "0"],
              ];
              for (const [offset, opacity] of stops) {
                const stop = document.createElementNS(svgNs, "stop");
                stop.setAttribute("offset", offset);
                stop.setAttribute("stop-color", "#0ea5e9");
                stop.setAttribute("stop-opacity", opacity);
                grad.appendChild(stop);
              }
              defs.appendChild(grad);
              glowGroup.appendChild(defs);

              const circle = document.createElementNS(svgNs, "circle");
              circle.setAttribute("cx", String(cx));
              circle.setAttribute("cy", String(cy));
              circle.setAttribute("r", String(radius));
              circle.setAttribute("fill", `url(#${gradId})`);
              circle.setAttribute("pointer-events", "none");
              glowGroup.appendChild(circle);

              cellView.container.insertBefore(glowGroup, cellView.container.firstChild);
              cellView.container.classList.add("modelscript-hover-halo");
              currentHighlightedContainer = cellView.container;
              currentGlowElement = glowGroup;
            }
          }
        }
      }
    };

    window.addEventListener("morsel:highlight-component", handleHighlight);
    return () => {
      clearHighlight();
      window.removeEventListener("morsel:highlight-component", handleHighlight);
    };
  }, []);

  useEffect(() => {
    const highlightedContainers: Element[] = [];
    const clearPsseHighlights = () => {
      for (const el of highlightedContainers) {
        (el as HTMLElement).style.filter = "";
        (el as HTMLElement).style.outline = "";
      }
      highlightedContainers.length = 0;
    };
    const handler = (ev: Event) => {
      clearPsseHighlights();
      const detail = (ev as CustomEvent<{ buses?: number[]; branches?: string[] }>).detail;
      const g = getGraph(containerRef.current) as
        | (DiagramGraphInstance & {
            getNodes?: () => Array<{ id?: string }>;
            getEdges?: () => Array<{ id?: string }>;
            findViewByCell?: (cellId: string) => { container?: Element } | null;
          })
        | null;
      if (!g || !detail) return;
      const busIds = new Set((detail.buses ?? []).map((b) => `bus_${b}`));
      const branchSet = new Set((detail.branches ?? []).map((s) => s.trim()));
      for (const id of busIds) {
        const view = g.findViewByCell?.(id);
        if (view?.container) {
          (view.container as HTMLElement).style.filter = "drop-shadow(0 0 8px #f85149)";
          highlightedContainers.push(view.container);
        }
      }
      if (branchSet.size > 0) {
        for (const edge of g.getEdges?.() ?? []) {
          const eid = String(edge.id ?? "");
          for (const br of branchSet) {
            if (eid.includes(br) || br.includes(eid)) {
              const view = g.findViewByCell?.(eid);
              if (view?.container) {
                (view.container as HTMLElement).style.filter = "drop-shadow(0 0 6px #f85149)";
                highlightedContainers.push(view.container);
              }
              break;
            }
          }
        }
      }
    };
    window.addEventListener("modelscript:psse-highlight", handler);
    return () => {
      clearPsseHighlights();
      window.removeEventListener("modelscript:psse-highlight", handler);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", outline: "none" }}
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const g = getGraph(containerRef.current);
          if (g && containerRef.current) {
            const p = g.clientToLocal(e.clientX, e.clientY);
            movePlacementGhost(p.x, p.y);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          let className = e.dataTransfer.getData("application/vnd.modelscript.classname");
          let iconSvg = e.dataTransfer.getData("application/vnd.modelscript.iconsvg");
          if (!className) {
            try {
              const json = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
              if (json) {
                const parsed = JSON.parse(json);
                if (parsed.className) {
                  className = parsed.className;
                  if (parsed.iconSvg) iconSvg = parsed.iconSvg;
                }
              }
            } catch {
              // ignore json parse error
            }
          }

          if (className && containerRef.current) {
            syncDiagramOptions();
            const g = getGraph(containerRef.current) ?? initGraph(props.theme === "vs-dark", containerRef.current);
            if (!g) return;
            const p = g.clientToLocal(e.clientX, e.clientY);

            // Clear drag placement ghost without dispatching Escape (which would destroy the drop placeholder)
            clearPlacement();

            // Render the pop & bounce animation placeholder while the action queues
            dropComponentGhost(g, p.x, p.y, className, iconSvg, props.theme === "vs-dark");

            if (props.onDrop) {
              props.onDrop(className, p.x, p.y, iconSvg);
            }
          }
        }}
      />
      {scrubbedPoint.time != null && (
        <div
          data-testid="diagram-time-scrub-hud"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 20,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px 12px",
            padding: "6px 12px",
            borderRadius: "999px",
            fontSize: "11px",
            fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
            backgroundColor: "var(--ms-surface-glass)",
            color: "var(--fgColor-default, var(--ms-text-1))",
            border: "1px solid var(--borderColor-default, var(--ms-border))",
            boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
            backdropFilter: "blur(8px)",
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--fgColor-accent, var(--ms-brand))" }}>
            t = {scrubbedPoint.time.toFixed(3)}s
          </span>
          {scrubbedPoint.values &&
            Object.entries(scrubbedPoint.values)
              .slice(0, 4)
              .map(([varName, val]) => (
                <span key={varName} style={{ display: "inline-flex", gap: 4 }}>
                  <span style={{ opacity: 0.75 }}>{varName}:</span>
                  <span style={{ fontWeight: 600, color: "var(--ms-status-pass-fg, #34d399)" }}>
                    {typeof val === "number" && Number.isFinite(val) ? val.toFixed(3) : String(val)}
                  </span>
                </span>
              ))}
        </div>
      )}
      {props.isLoading &&
        (() => {
          const g = getGraph(containerRef.current) as {
            scale?: () => { sx: number; sy: number };
            translate?: () => { tx: number; ty: number };
          } | null;
          const cs = props.diagramData?.coordinateSystem;
          const ox = cs?.axesStyle?.origin?.[0] ?? 0;
          const oy = cs?.axesStyle?.origin?.[1] ?? 0;
          let originScreenPos: { x: number; y: number } | null = null;
          if (g && hasFittedViewportRef.current && typeof g.scale === "function" && typeof g.translate === "function") {
            const s = g.scale();
            const t = g.translate();
            if (s && t && typeof s.sx === "number" && typeof t.tx === "number") {
              originScreenPos = { x: ox * s.sx + t.tx, y: oy * s.sy + t.ty };
            }
          }
          return (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                paddingTop: originScreenPos ? 0 : (props.fitInsets?.top ?? 0),
                paddingRight: originScreenPos ? 0 : (props.fitInsets?.right ?? 0),
                paddingBottom: originScreenPos ? 0 : (props.fitInsets?.bottom ?? 0),
                paddingLeft: originScreenPos ? 0 : (props.fitInsets?.left ?? 0),
                boxSizing: "border-box",
                backgroundColor: props.theme === "vs-dark" ? "rgba(18, 18, 20, 0.72)" : "rgba(248, 250, 252, 0.72)",
                zIndex: 1000,
                pointerEvents: "none",
              }}
            >
              <div
                style={
                  originScreenPos
                    ? {
                        position: "absolute",
                        left: originScreenPos.x,
                        top: originScreenPos.y,
                        transform: "translate(-50%, -50%)",
                      }
                    : undefined
                }
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    border: `3px solid ${props.theme === "vs-dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}`,
                    borderTopColor: props.theme === "vs-dark" ? "#ccc" : "#333",
                    borderRadius: "50%",
                    animation: "diagram-spin 0.7s linear infinite",
                  }}
                />
              </div>
            </div>
          );
        })()}
      <style>{`
        @keyframes diagram-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
});

export default DiagramEditor;
