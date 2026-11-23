// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { KgEdge, KgNode, KgSubgraph } from "../sparql-kb.js";

export type KgLayoutKind = "force" | "hierarchy" | "circle";

export interface Owl2KnowledgeGraphProps {
  graph: KgSubgraph;
  colorMode: "dark" | "light";
  showInferred: boolean;
  onSelectNode?: ((node: KgNode) => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  emptyMessage?: string | undefined;
}

interface NodePos {
  x: number;
  y: number;
}

const NODE_STYLE: Record<
  KgNode["kind"],
  { fillDark: string; fillLight: string; stroke: string; textDark: string; textLight: string }
> = {
  Class: { fillDark: "#2b2110", fillLight: "#fef3c7", stroke: "#f59e0b", textDark: "#fde68a", textLight: "#92400e" },
  Individual: {
    fillDark: "#271738",
    fillLight: "#f3e8ff",
    stroke: "#a855f7",
    textDark: "#e9d5ff",
    textLight: "#6b21a8",
  },
  ObjectProperty: {
    fillDark: "#12243d",
    fillLight: "#dbeafe",
    stroke: "#3b82f6",
    textDark: "#bfdbfe",
    textLight: "#1e40af",
  },
  DataProperty: {
    fillDark: "#0f2c24",
    fillLight: "#d1fae5",
    stroke: "#10b981",
    textDark: "#a7f3d0",
    textLight: "#065f46",
  },
  Literal: { fillDark: "#1e293b", fillLight: "#f1f5f9", stroke: "#64748b", textDark: "#cbd5e1", textLight: "#334155" },
  External: { fillDark: "#1e293b", fillLight: "#e2e8f0", stroke: "#94a3b8", textDark: "#e2e8f0", textLight: "#1e293b" },
};

function computeInitialLayout(nodes: KgNode[], edges: KgEdge[], layout: KgLayoutKind): Map<string, NodePos> {
  const pos = new Map<string, NodePos>();
  const n = nodes.length;
  if (n === 0) return pos;

  const cx = 420;
  const cy = 260;

  if (layout === "circle") {
    const radius = Math.max(120, Math.min(260, n * 24));
    nodes.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / n - Math.PI / 2;
      pos.set(node.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
    return pos;
  }

  if (layout === "hierarchy") {
    // Topological layering based on outgoing edges (target above source for subClassOf / rdf:type)
    const parentsOf = new Map<string, string[]>();
    for (const e of edges) {
      const arr = parentsOf.get(e.source) ?? [];
      arr.push(e.target);
      parentsOf.set(e.source, arr);
    }
    const depthMap = new Map<string, number>();
    const getDepth = (id: string, visiting = new Set<string>()): number => {
      if (depthMap.has(id)) return depthMap.get(id)!;
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const parents = (parentsOf.get(id) ?? []).filter((p) => p !== id);
      const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p) => getDepth(p, visiting)));
      depthMap.set(id, d);
      return d;
    };
    const layers = new Map<number, KgNode[]>();
    for (const node of nodes) {
      const d = getDepth(node.id);
      const arr = layers.get(d) ?? [];
      arr.push(node);
      layers.set(d, arr);
    }
    const gapX = 170;
    const gapY = 104;
    for (const [depth, arr] of layers.entries()) {
      const rowW = (arr.length - 1) * gapX;
      arr.forEach((node, idx) => {
        pos.set(node.id, { x: cx - rowW / 2 + idx * gapX, y: 70 + depth * gapY });
      });
    }
    return pos;
  }

  // Deterministic Force-directed layout (Cytoscape cose-style spring embedder)
  const radius = Math.max(110, Math.min(240, n * 18));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const indexById = new Map<string, number>();
  nodes.forEach((node, i) => {
    indexById.set(node.id, i);
    const angle = (2 * Math.PI * i) / n;
    xs[i] = cx + radius * Math.cos(angle);
    ys[i] = cy + radius * Math.sin(angle);
  });

  const edgePairs: Array<[number, number]> = [];
  for (const e of edges) {
    const si = indexById.get(e.source);
    const ti = indexById.get(e.target);
    if (si !== undefined && ti !== undefined && si !== ti) {
      edgePairs.push([si, ti]);
    }
  }

  const iterations = Math.min(110, Math.max(45, 140 - n));
  const repulsion = 9500;
  const springLen = 145;
  const springK = 0.045;
  const gravity = 0.018;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;
    for (let i = 0; i < n; i++) {
      vx[i] = (cx - xs[i]!) * gravity;
      vy[i] = (cy - ys[i]!) * gravity;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = xs[i]! - xs[j]!;
        const dy = ys[i]! - ys[j]!;
        const distSq = Math.max(400, dx * dx + dy * dy);
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        vx[i] = vx[i]! + fx;
        vy[i] = vy[i]! + fy;
        vx[j] = vx[j]! - fx;
        vy[j] = vy[j]! - fy;
      }
    }
    for (const [si, ti] of edgePairs) {
      const dx = xs[ti]! - xs[si]!;
      const dy = ys[ti]! - ys[si]!;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const delta = (dist - springLen) * springK;
      const fx = (dx / dist) * delta;
      const fy = (dy / dist) * delta;
      vx[si] = vx[si]! + fx;
      vy[si] = vy[si]! + fy;
      vx[ti] = vx[ti]! - fx;
      vy[ti] = vy[ti]! - fy;
    }
    const maxStep = 28 * temp + 2;
    for (let i = 0; i < n; i++) {
      const mag = Math.sqrt(vx[i]! * vx[i]! + vy[i]! * vy[i]!);
      if (mag > 0.01) {
        const step = Math.min(maxStep, mag);
        xs[i] = xs[i]! + (vx[i]! / mag) * step;
        ys[i] = ys[i]! + (vy[i]! / mag) * step;
      }
    }
  }

  nodes.forEach((node, i) => {
    pos.set(node.id, { x: xs[i]!, y: ys[i]! });
  });
  return pos;
}

export const Owl2KnowledgeGraph: React.FC<Owl2KnowledgeGraphProps> = ({
  graph,
  colorMode,
  showInferred,
  onSelectNode,
  onRevealLine,
  emptyMessage = "No knowledge graph triples to display.",
}) => {
  const isDark = colorMode === "dark";
  const [layout, setLayout] = useState<KgLayoutKind>("force");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [positions, setPositions] = useState<Map<string, NodePos>>(new Map());
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<
    | { mode: "pan"; startX: number; startY: number; origX: number; origY: number }
    | { mode: "node"; nodeId: string; startX: number; startY: number; origX: number; origY: number }
    | null
  >(null);

  const visibleEdges = useMemo(
    () => (showInferred ? graph.edges : graph.edges.filter((e) => !e.inferred)),
    [graph.edges, showInferred],
  );

  const visibleNodes = useMemo(() => {
    if (showInferred) return graph.nodes;
    const connected = new Set<string>();
    for (const e of visibleEdges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    return graph.nodes.filter((n) => connected.has(n.id) || graph.edges.length === 0);
  }, [graph.nodes, graph.edges.length, visibleEdges, showInferred]);

  useEffect(() => {
    const nextPos = computeInitialLayout(visibleNodes, visibleEdges, layout);
    setPositions(nextPos);
    setTransform({ x: 0, y: 0, scale: 1 });
  }, [visibleNodes, visibleEdges, layout]);

  const neighborhood = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const e of visibleEdges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [selectedId, visibleEdges]);

  const selectedNode = useMemo(
    () => (selectedId ? (visibleNodes.find((n) => n.id === selectedId) ?? null) : null),
    [selectedId, visibleNodes],
  );

  const fitToView = () => {
    if (positions.size === 0 || !svgRef.current) {
      setTransform({ x: 0, y: 0, scale: 1 });
      return;
    }
    const rect = svgRef.current.getBoundingClientRect();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x - 80);
      maxX = Math.max(maxX, p.x + 80);
      minY = Math.min(minY, p.y - 30);
      maxY = Math.max(maxY, p.y + 30);
    }
    const bw = Math.max(100, maxX - minX);
    const bh = Math.max(100, maxY - minY);
    const scale = Math.max(0.35, Math.min(1.3, Math.min((rect.width - 40) / bw, (rect.height - 40) / bh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setTransform({
      x: rect.width / 2 - cx * scale,
      y: rect.height / 2 - cy * scale,
      scale,
    });
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.25, Math.min(3.0, prev.scale * factor)),
    }));
  };

  const handlePointerDownCanvas = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest("[data-kg-node]")) return;
    setSelectedId(null);
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: transform.x,
      origY: transform.y,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerDownNode = (e: React.PointerEvent, node: KgNode) => {
    e.stopPropagation();
    setSelectedId(node.id);
    onSelectNode?.(node);
    const p = positions.get(node.id) ?? { x: 0, y: 0 };
    dragRef.current = {
      mode: "node",
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: p.x,
      origY: p.y,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "pan") {
      setTransform((prev) => ({ ...prev, x: d.origX + dx, y: d.origY + dy }));
    } else {
      const nextX = d.origX + dx / transform.scale;
      const nextY = d.origY + dy / transform.scale;
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(d.nodeId, { x: nextX, y: nextY });
        return next;
      });
    }
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  if (visibleNodes.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontSize: 12,
          color: "var(--ms-text-2)",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  const q = searchText.trim().toLowerCase();

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top Graph Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--ms-border)",
          background: "var(--ms-bg-alt)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {(["force", "hierarchy", "circle"] as KgLayoutKind[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              style={{
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: layout === l ? 700 : 500,
                borderRadius: 5,
                cursor: "pointer",
                textTransform: "capitalize",
                border: layout === l ? "1px solid var(--ms-brand, #0969da)" : "1px solid var(--ms-border)",
                background: layout === l ? "rgba(56, 189, 248, 0.14)" : "transparent",
                color: "var(--ms-text)",
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Highlight node..."
          style={{
            width: 150,
            padding: "3px 7px",
            fontSize: 11,
            borderRadius: 5,
            border: "1px solid var(--ms-border)",
            background: "var(--ms-bg)",
            color: "var(--ms-text)",
            outline: "none",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--ms-text-2)", marginRight: 4 }}>
            {visibleNodes.length} nodes • {visibleEdges.length} edges
          </span>
          <button
            type="button"
            onClick={() => setTransform((p) => ({ ...p, scale: Math.min(3, p.scale * 1.2) }))}
            style={{
              padding: "2px 7px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid var(--ms-border)",
              background: "var(--ms-bg)",
              color: "var(--ms-text)",
              cursor: "pointer",
            }}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setTransform((p) => ({ ...p, scale: Math.max(0.25, p.scale * 0.82) }))}
            style={{
              padding: "2px 7px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid var(--ms-border)",
              background: "var(--ms-bg)",
              color: "var(--ms-text)",
              cursor: "pointer",
            }}
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={fitToView}
            style={{
              padding: "2px 7px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid var(--ms-border)",
              background: "var(--ms-bg)",
              color: "var(--ms-text)",
              cursor: "pointer",
            }}
            title="Fit graph to viewport"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <svg
        ref={svgRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDownCanvas}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          minHeight: 260,
          cursor: dragRef.current?.mode === "pan" ? "grabbing" : "grab",
          background: isDark ? "#0d1117" : "#f8fafc",
          userSelect: "none",
        }}
      >
        <defs>
          <marker
            id="kg-arrow-asserted"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill={isDark ? "#64748b" : "#475569"} />
          </marker>
          <marker
            id="kg-arrow-inferred"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
          </marker>
        </defs>

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {visibleEdges.map((edge) => {
            const p1 = positions.get(edge.source);
            const p2 = positions.get(edge.target);
            if (!p1 || !p2) return null;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const pad = 34;
            const sx = p1.x + (dx / dist) * Math.min(pad, dist * 0.35);
            const sy = p1.y + (dy / dist) * Math.min(pad, dist * 0.35);
            const tx = p2.x - (dx / dist) * Math.min(pad + 6, dist * 0.35);
            const ty = p2.y - (dy / dist) * Math.min(pad + 6, dist * 0.35);
            const mx = (sx + tx) / 2;
            const my = (sy + ty) / 2;
            const isDimmed = neighborhood ? !(edge.source === selectedId || edge.target === selectedId) : false;

            return (
              <g key={edge.id} opacity={isDimmed ? 0.16 : 0.92}>
                <line
                  x1={sx}
                  y1={sy}
                  x2={tx}
                  y2={ty}
                  stroke={edge.inferred ? "#f59e0b" : isDark ? "#64748b" : "#475569"}
                  strokeWidth={edge.inferred ? 1.8 : 1.4}
                  strokeDasharray={edge.inferred ? "5 3" : undefined}
                  markerEnd={edge.inferred ? "url(#kg-arrow-inferred)" : "url(#kg-arrow-asserted)"}
                />
                <rect
                  x={mx - edge.label.length * 3.2 - 5}
                  y={my - 8}
                  width={edge.label.length * 6.4 + 10}
                  height={15}
                  rx={4}
                  fill={edge.inferred ? (isDark ? "#2d1f07" : "#fef3c7") : isDark ? "#161b22" : "#ffffff"}
                  stroke={edge.inferred ? "rgba(245, 158, 11, 0.55)" : isDark ? "#30363d" : "#cbd5e1"}
                  strokeWidth={0.8}
                />
                <text
                  x={mx}
                  y={my + 3}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={edge.inferred ? 700 : 500}
                  fill={edge.inferred ? "#d97706" : isDark ? "#94a3b8" : "#475569"}
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {visibleNodes.map((node) => {
            const p = positions.get(node.id);
            if (!p) return null;
            const style = NODE_STYLE[node.kind];
            const isSelected = selectedId === node.id;
            const isSearchMatch = Boolean(
              q && (node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)),
            );
            const isDimmed = (neighborhood && !neighborhood.has(node.id)) || (Boolean(q) && !isSearchMatch);
            const label = node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label;
            const boxW = Math.max(76, label.length * 7.2 + 22);
            const boxH = 28;

            return (
              <g
                key={node.id}
                data-kg-node="true"
                transform={`translate(${p.x}, ${p.y})`}
                onPointerDown={(e) => handlePointerDownNode(e, node)}
                style={{ cursor: "pointer" }}
                opacity={isDimmed ? 0.22 : 1}
              >
                <rect
                  x={-boxW / 2}
                  y={-boxH / 2}
                  width={boxW}
                  height={boxH}
                  rx={node.kind === "Class" ? 14 : node.kind === "Individual" ? 6 : 4}
                  fill={
                    node.unsatisfiable ? (isDark ? "#3b1219" : "#fee2e2") : isDark ? style.fillDark : style.fillLight
                  }
                  stroke={isSelected || isSearchMatch ? "#38bdf8" : node.unsatisfiable ? "#ef4444" : style.stroke}
                  strokeWidth={isSelected || isSearchMatch ? 2.4 : 1.5}
                  strokeDasharray={node.kind === "Literal" ? "3 2" : undefined}
                />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  fill={node.unsatisfiable ? "#ef4444" : isDark ? style.textDark : style.textLight}
                >
                  {node.unsatisfiable ? `⊥ ${label}` : label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Bottom Legend / Selected Node Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "5px 10px",
          borderTop: "1px solid var(--ms-border)",
          background: "var(--ms-bg-alt)",
          fontSize: 11,
        }}
      >
        {selectedNode ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontWeight: 700 }}>{selectedNode.label}</span>
            <span
              style={{
                fontFamily: "var(--ms-font-mono)",
                fontSize: 10,
                color: "var(--ms-text-2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              ({selectedNode.kind}) {selectedNode.id}
            </span>
            {selectedNode.line && onRevealLine && (
              <button
                type="button"
                onClick={() => onRevealLine(selectedNode.line!, selectedNode.label)}
                style={{
                  padding: "2px 7px",
                  fontSize: 10,
                  borderRadius: 4,
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg)",
                  color: "var(--ms-text)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Reveal L{selectedNode.line}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ms-text-2)", flexWrap: "wrap" }}>
            <span>● Class</span>
            <span>◆ Individual</span>
            <span>▬ Solid: Asserted</span>
            <span style={{ color: "#d97706" }}>┄ Dashed: Inferred</span>
            <span>• Drag nodes / Scroll to zoom</span>
          </div>
        )}
      </div>
    </div>
  );
};
