// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  disposeDiagram,
  dropComponentGhost,
  getGraph,
  initGraph,
  isEphemeralDiagramNode,
  renderDiagram,
  setDiagramOptions,
} from "@modelscript/diagram";
import type { Theme } from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { movePlacementGhost } from "./placement";

export interface DiagramEditorHandle {
  fitContent: () => void;
  layout: () => void;
}

interface DiagramEditorProps {
  diagramData: any | null;
  diagramClassName?: string | null | undefined;
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
  selectedName?: string | null | undefined;
  theme: Theme;
  isLoading?: boolean | undefined;
  onRenderComplete?: ((diagramData: any) => void) | undefined;
  onInteractiveWrite?: ((variableName: string, value: any, nodeId: string) => void) | undefined;
  onShowProperties?: ((nodeId: string, cachedProps?: any, isLoading?: boolean) => void) | undefined;
  onNodeDoubleClick?: ((nodeId: string, nodeData?: any) => void) | undefined;
}

const DiagramEditor = forwardRef<DiagramEditorHandle, DiagramEditorProps>((props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);

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

  const attachGraphListeners = () => {
    const g = getGraph(containerRef.current);
    if (g && typeof g.on === "function") {
      g.off?.("node:dblclick", handleNodeDblClick);
      g.on("node:dblclick", handleNodeDblClick);
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
        if (propsRef.current.onSelect) propsRef.current.onSelect(id);
      },
      onShowProperties: (id, cachedProps, isLoading) => {
        if (propsRef.current.onShowProperties) {
          propsRef.current.onShowProperties(id, cachedProps, isLoading);
        }
      },
      onUndo: () => propsRef.current.onUndo?.(),
      onRedo: () => propsRef.current.onRedo?.(),
    });
    attachGraphListeners();
  };

  useImperativeHandle(ref, () => ({
    fitContent: () => {
      syncDiagramOptions();
      const g =
        getGraph(containerRef.current) ??
        (containerRef.current ? initGraph(props.theme === "vs-dark", containerRef.current) : null);
      if (g) {
        try {
          g.zoomToFit({ maxScale: 1, padding: 20 });
        } catch {
          // ignore if zoom fails before layout
        }
      }
    },
    layout: () => {
      if (typeof window !== "undefined") {
        window.postMessage({ type: "autoLayout" }, "*");
      }
    },
  }));

  useEffect(() => {
    syncDiagramOptions();
  }, [props.theme]);

  useEffect(() => {
    const container = containerRef.current;
    return () => {
      disposeDiagram(container);
    };
  }, []);

  useEffect(() => {
    if (props.diagramData && containerRef.current) {
      syncDiagramOptions();
      renderDiagram(props.diagramData, props.theme === "vs-dark");
      attachGraphListeners();
      if (props.onRenderComplete) props.onRenderComplete(props.diagramData);
    }
  }, [props.diagramData, props.theme]);

  useEffect(() => {
    if (props.selectedName !== undefined) {
      const g = getGraph(containerRef.current);
      if (!g) return;
      if (!props.selectedName || isEphemeralDiagramNode(props.selectedName)) {
        g.cleanSelection();
      } else {
        const cell = g.getCellById(props.selectedName);
        if (cell) {
          g.cleanSelection();
          g.select(cell);
          try {
            const cellView = g.findViewByCell(cell);
            if (cellView?.container) {
              cellView.container.classList.add("modelscript-anchor-halo");
              setTimeout(() => {
                cellView.container?.classList.remove("modelscript-anchor-halo");
              }, 5400);
            }
            g.centerCell(cell, { animation: { duration: 300 } });
          } catch {
            // fallback if animation unsupported
          }
        }
      }
    }
  }, [props.selectedName, props.theme]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", outline: "none" }}
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
