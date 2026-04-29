// SPDX-License-Identifier: AGPL-3.0-or-later

import { disposeDiagram, initGraph, renderDiagram, setDiagramOptions } from "@modelscript/diagram-core";
import type { Theme } from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface DiagramEditorHandle {
  fitContent: () => void;
  layout: () => void;
}

interface DiagramEditorProps {
  diagramData: any | null;
  diagramClassName?: string | null;
  onSelect?: (componentName: string | null) => void;
  onDrop?: (className: string, x: number, y: number, iconSvg?: string | null) => void;
  onConnect?: (source: string, target: string, points?: { x: number; y: number }[]) => void;
  onMove?: (
    items: {
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      edges?: { source: string; target: string; points: { x: number; y: number }[] }[];
      connectedOnly?: boolean;
    }[],
  ) => void;
  onResize?: (
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    edges?: { source: string; target: string; points: { x: number; y: number }[] }[],
  ) => void;
  onEdgeMove?: (edges: { source: string; target: string; points: { x: number; y: number }[] }[]) => void;
  onEdgeDelete?: (source: string, target: string) => void;
  onComponentDelete?: (name: string) => void;
  onComponentsDelete?: (names: string[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  selectedName?: string | null;
  theme: Theme;
  isLoading?: boolean;
  onRenderComplete?: (diagramData: any) => void;
}

const DiagramEditor = forwardRef<DiagramEditorHandle, DiagramEditorProps>((props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Use a ref for props so callbacks in event listeners have access to latest props
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useImperativeHandle(ref, () => ({
    fitContent: () => {
      const g = initGraph(props.theme === "vs-dark");
      if (g) g.zoomToFit({ maxScale: 1, padding: 20 });
    },
    layout: () => {
      // Ignored for now
    },
  }));

  useEffect(() => {
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
        }
      },
      onSelect: (id) => {
        if (propsRef.current.onSelect) propsRef.current.onSelect(id);
      },
      onUndo: () => propsRef.current.onUndo?.(),
      onRedo: () => propsRef.current.onRedo?.(),
    });

    return () => {
      disposeDiagram();
    };
  }, []);

  useEffect(() => {
    if (props.diagramData && containerRef.current) {
      renderDiagram(props.diagramData, props.theme === "vs-dark");
      if (props.onRenderComplete) props.onRenderComplete(props.diagramData);
    }
  }, [props.diagramData, props.theme]);

  useEffect(() => {
    if (props.selectedName !== undefined && containerRef.current) {
      const g = initGraph(props.theme === "vs-dark");
      if (!g) return;
      if (!props.selectedName) {
        g.cleanSelection();
      } else {
        const cell = g.getCellById(props.selectedName);
        if (cell) {
          g.cleanSelection();
          g.select(cell);
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
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const className = e.dataTransfer.getData("application/vnd.modelscript.className");
          const iconSvg = e.dataTransfer.getData("application/vnd.modelscript.iconSvg");

          if (className && containerRef.current) {
            const g = initGraph(props.theme === "vs-dark");
            if (!g) return;
            const p = g.clientToLocal(e.clientX, e.clientY);
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
