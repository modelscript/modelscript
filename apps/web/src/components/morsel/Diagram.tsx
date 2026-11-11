// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  autoLayoutDiagramAsync,
  disposeDiagram,
  dropComponentGhost,
  flipSelectedNodes,
  getGraph,
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
import { movePlacementGhost } from "./placement";

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
  onShowProperties?: ((nodeId: string, cachedProps?: any, isLoading?: boolean) => void) | undefined;
  onNodeDoubleClick?: ((nodeId: string, nodeData?: any) => void) | undefined;
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
            break;
          case "connect":
            if (p.onConnect) p.onConnect(action.source, action.target, action.points);
            break;
          case "disconnect":
            if (p.onEdgeDelete) p.onEdgeDelete(action.source, action.target);
            break;
          case "moveEdge":
            if (p.onEdgeMove) p.onEdgeMove(action.edges);
            break;
          case "deleteComponents":
            if (p.onComponentsDelete) p.onComponentsDelete(action.names);
            else if (p.onComponentDelete && action.names.length > 0) p.onComponentDelete(action.names[0]);
            break;
          case "interactiveWrite":
            if (p.onInteractiveWrite) p.onInteractiveWrite(action.variableName, action.value, action.nodeId);
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
    });
    attachGraphListeners();
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
          if (propsRef.current.diagramData?.coordinateSystem) {
            const cs = propsRef.current.diagramData.coordinateSystem;
            const expandedRect = {
              x: cs.x - cs.width * 0.125,
              y: cs.y - cs.height * 0.125,
              width: cs.width * 1.25,
              height: cs.height * 1.25,
            };
            const zoomable = g as unknown as {
              zoomToRect?: (rect: unknown, options?: unknown) => void;
            };
            zoomable.zoomToRect?.(expandedRect, { viewportArea: { x: 0, y: 0, width: cw, height: ch } });
            const ox = cs.axesStyle?.origin?.[0] ?? 0;
            const oy = cs.axesStyle?.origin?.[1] ?? 0;
            if (typeof (g as any).centerPoint === "function") {
              (g as any).centerPoint(ox, oy);
            } else if (typeof (g as any).centerContent === "function") {
              (g as any).centerContent();
            }
          } else {
            g.zoomToFit({ maxScale: 1, padding: 20 });
            (g as any).centerContent?.();
          }
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
        if (propsRef.current.diagramData?.coordinateSystem) {
          const cs = propsRef.current.diagramData.coordinateSystem;
          const expandedRect = {
            x: cs.x - cs.width * 0.125,
            y: cs.y - cs.height * 0.125,
            width: cs.width * 1.25,
            height: cs.height * 1.25,
          };
          if (typeof g.zoomToRect === "function") {
            g.zoomToRect(expandedRect, { viewportArea: { x: 0, y: 0, width: cw, height: ch } });
          } else {
            g.zoomToFit({ maxScale: 1, padding: 24 });
            g.centerContent?.();
          }
          const ox = cs.axesStyle?.origin?.[0] ?? 0;
          const oy = cs.axesStyle?.origin?.[1] ?? 0;
          if (typeof g.centerPoint === "function") {
            g.centerPoint(ox, oy);
          } else if (typeof g.centerContent === "function") {
            g.centerContent();
          }
        } else {
          g.zoomToFit({ maxScale: 1, padding: 24 });
          g.centerContent?.();
        }
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
                if (propsRef.current.diagramData?.coordinateSystem) {
                  const cs = propsRef.current.diagramData.coordinateSystem;
                  const expandedRect = {
                    x: cs.x - cs.width * 0.125,
                    y: cs.y - cs.height * 0.125,
                    width: cs.width * 1.25,
                    height: cs.height * 1.25,
                  };
                  zoomable.zoomToRect?.(expandedRect, { viewportArea: { x: 0, y: 0, width, height } });
                  const ox = cs.axesStyle?.origin?.[0] ?? 0;
                  const oy = cs.axesStyle?.origin?.[1] ?? 0;
                  if (typeof (g as any).centerPoint === "function") {
                    (g as any).centerPoint(ox, oy);
                  } else if (typeof zoomable.centerContent === "function") {
                    zoomable.centerContent();
                  }
                } else if (typeof zoomable.zoomToFit === "function") {
                  zoomable.zoomToFit({ maxScale: 1, padding: 24 });
                  zoomable.centerContent?.();
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
    if (props.diagramData && containerRef.current) {
      try {
        syncDiagramOptions();
        renderDiagram(props.diagramData, props.theme === "vs-dark");
        attachGraphListeners();
      } catch (err) {
        console.error("Failed to render diagram:", err);
      } finally {
        if (props.onRenderComplete) props.onRenderComplete(props.diagramData);
      }
    } else if (!props.diagramData && props.onRenderComplete) {
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

    const handleHighlight = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string | null }>).detail;
      const targetName = detail?.name;

      if (currentHighlightedContainer) {
        currentHighlightedContainer.classList.remove("modelscript-hover-halo");
        currentHighlightedContainer = null;
      }

      if (targetName && containerRef.current) {
        const g = getGraph(containerRef.current) as DiagramGraphInstance | null;
        if (g) {
          const cell = g.getCellById(targetName);
          if (cell) {
            const cellView = g.findViewByCell(cell);
            if (cellView?.container) {
              cellView.container.classList.add("modelscript-hover-halo");
              currentHighlightedContainer = cellView.container;
            }
          }
        }
      }
    };

    window.addEventListener("morsel:highlight-component", handleHighlight);
    return () => {
      if (currentHighlightedContainer) {
        currentHighlightedContainer.classList.remove("modelscript-hover-halo");
      }
      window.removeEventListener("morsel:highlight-component", handleHighlight);
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
            backgroundColor: props.theme === "vs-dark" ? "rgba(22, 27, 34, 0.88)" : "rgba(255, 255, 255, 0.92)",
            color: props.theme === "vs-dark" ? "#e6edf3" : "#1f2328",
            border: `1px solid ${props.theme === "vs-dark" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"}`,
            boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
            backdropFilter: "blur(8px)",
          }}
        >
          <span style={{ fontWeight: 700, color: props.theme === "vs-dark" ? "#58a6ff" : "#0969da" }}>
            t = {scrubbedPoint.time.toFixed(3)}s
          </span>
          {scrubbedPoint.values &&
            Object.entries(scrubbedPoint.values)
              .slice(0, 4)
              .map(([varName, val]) => (
                <span key={varName} style={{ display: "inline-flex", gap: 4 }}>
                  <span style={{ opacity: 0.75 }}>{varName}:</span>
                  <span style={{ fontWeight: 600, color: props.theme === "vs-dark" ? "#3fb950" : "#1a7f37" }}>
                    {typeof val === "number" && Number.isFinite(val) ? val.toFixed(3) : String(val)}
                  </span>
                </span>
              ))}
        </div>
      )}
      {props.isLoading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: props.theme === "vs-dark" ? "rgba(30,30,30,0.6)" : "rgba(255,255,255,0.6)",
            zIndex: 1000,
            pointerEvents: "none",
          }}
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
      )}
      <style>{`
        @keyframes diagram-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
});

export default DiagramEditor;
