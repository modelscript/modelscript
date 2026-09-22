// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Fault Tree Synthesis.
 *
 * Automatically generates standard Fault Tree Diagrams from Minimal Cut Sets (MCS),
 * conforming to the ModelScript Diagram Protocol for webview/X6 rendering.
 */

import type { CoordinateSystem, DiagramData, DiagramEdge, DiagramNode, X6Markup } from "./protocol.js";
export type { CoordinateSystem, DiagramData, DiagramEdge, DiagramNode };

export interface MinimalCutSetItem {
  order: number;
  faultIds: string[];
  faultNames: string[];
  probability?: number;
}

export interface FaultTreeInput {
  hazardName: string;
  hazardDescription?: string;
  minimalCutSets: MinimalCutSetItem[];
}

function createTextMarkup(text: string, fontSize = 12, fill = "#1e293b", fontWeight = "normal"): X6Markup {
  return {
    tagName: "text",
    attrs: {
      "font-size": fontSize,
      fill,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "font-family": "Inter, system-ui, sans-serif",
      "font-weight": fontWeight,
    },
    textContent: text,
  };
}

function createRectMarkup(fill: string, stroke: string, label: string, sublabel?: string, rx = 6): X6Markup {
  const children: X6Markup[] = [
    {
      tagName: "rect",
      attrs: {
        width: "100%",
        height: "100%",
        fill,
        stroke,
        "stroke-width": 2,
        rx,
        ry: rx,
      },
    },
    {
      tagName: "text",
      attrs: {
        x: "50%",
        y: sublabel ? "38%" : "50%",
        "font-size": 13,
        fill: "#0f172a",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-family": "Inter, system-ui, sans-serif",
        "font-weight": "600",
      },
      textContent: label,
    },
  ];

  if (sublabel) {
    children.push({
      tagName: "text",
      attrs: {
        x: "50%",
        y: "68%",
        "font-size": 10,
        fill: "#64748b",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-family": "Inter, system-ui, sans-serif",
      },
      textContent: sublabel,
    });
  }

  return {
    tagName: "g",
    children,
  };
}

function createGateMarkup(gateType: "OR" | "AND", label?: string): X6Markup {
  const isOr = gateType === "OR";
  const strokeColor = isOr ? "#2563eb" : "#059669";
  const fillColor = isOr ? "#eff6ff" : "#ecfdf5";

  return {
    tagName: "g",
    children: [
      {
        tagName: "path",
        attrs: {
          d: isOr
            ? "M 10,40 Q 30,35 50,40 Q 50,20 30,10 Q 10,20 10,40 Z"
            : "M 10,40 L 10,25 Q 10,10 30,10 Q 50,10 50,25 L 50,40 Z",
          fill: fillColor,
          stroke: strokeColor,
          "stroke-width": 2,
        },
      },
      {
        tagName: "text",
        attrs: {
          x: 30,
          y: 26,
          "font-size": 11,
          fill: strokeColor,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          "font-family": "Inter, system-ui, sans-serif",
          "font-weight": "bold",
        },
        textContent: gateType,
      },
    ],
  };
}

function createBasicEventMarkup(label: string, sublabel?: string): X6Markup {
  const children: X6Markup[] = [
    {
      tagName: "circle",
      attrs: {
        cx: 35,
        cy: 35,
        r: 30,
        fill: "#fef2f2",
        stroke: "#dc2626",
        "stroke-width": 2,
      },
    },
    {
      tagName: "text",
      attrs: {
        x: 35,
        y: sublabel ? 30 : 35,
        "font-size": 10,
        fill: "#991b1b",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-family": "Inter, system-ui, sans-serif",
        "font-weight": "600",
      },
      textContent: label.length > 12 ? label.slice(0, 11) + "…" : label,
    },
  ];

  if (sublabel) {
    children.push({
      tagName: "text",
      attrs: {
        x: 35,
        y: 44,
        "font-size": 8,
        fill: "#7f1d1d",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-family": "Inter, system-ui, sans-serif",
      },
      textContent: sublabel,
    });
  }

  return {
    tagName: "g",
    children,
  };
}

/**
 * Builds a complete DiagramData model from safety analysis Minimal Cut Sets.
 */
export function synthesizeFaultTreeDiagram(input: FaultTreeInput): DiagramData {
  const { hazardName, hazardDescription, minimalCutSets } = input;

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const topNodeId = "node_hazard_top";
  const orGateNodeId = "node_gate_root_or";

  // Level Y coordinates
  const yTop = 40;
  const yOrGate = 160;
  const yAndGates = 280;
  const yBasicEvents = 420;

  // Determine total layout width based on cut sets count
  const nCutSets = Math.max(1, minimalCutSets.length);
  const cutSetSpacing = 160;
  const totalWidth = Math.max(800, nCutSets * cutSetSpacing + 200);
  const centerX = totalWidth / 2;

  // 1. Top Event Node
  nodes.push({
    id: topNodeId,
    x: centerX - 110,
    y: yTop,
    width: 220,
    height: 64,
    angle: 0,
    opacity: 1,
    zIndex: 10,
    markup: createRectMarkup("#fef2f2", "#b91c1c", hazardName, hazardDescription || "Top Event (Hazard)", 8),
    ports: { items: [], groups: {} },
    data: { kind: "top-event", name: hazardName },
  });

  // If no cut sets, return standalone top event
  if (minimalCutSets.length === 0) {
    return {
      nodes,
      edges,
      coordinateSystem: { x: 0, y: 0, width: totalWidth, height: 400 },
      diagramBackground: null,
    };
  }

  // 2. Root OR Gate
  nodes.push({
    id: orGateNodeId,
    x: centerX - 30,
    y: yOrGate,
    width: 60,
    height: 50,
    angle: 0,
    opacity: 1,
    zIndex: 10,
    markup: createGateMarkup("OR"),
    ports: { items: [], groups: {} },
    data: { kind: "gate-or" },
  });

  // Edge: Top Event -> Root OR Gate
  edges.push(createDiagramEdge(`${topNodeId}->${orGateNodeId}`, topNodeId, orGateNodeId));

  // Map to deduplicate Basic Events across cut sets
  const basicEventNodesMap = new Map<string, { id: string; name: string }>();
  let nextEventIdx = 1;

  for (const cs of minimalCutSets) {
    for (let i = 0; i < cs.faultIds.length; i++) {
      const fId = cs.faultIds[i]!;
      const fName = cs.faultNames[i] ?? fId;
      if (!basicEventNodesMap.has(fId)) {
        basicEventNodesMap.set(fId, {
          id: `node_basic_event_${nextEventIdx++}`,
          name: fName,
        });
      }
    }
  }

  // 3. Create Cut Set Nodes & Connections
  const startX = centerX - ((nCutSets - 1) * cutSetSpacing) / 2;

  minimalCutSets.forEach((cs, csIdx) => {
    const csX = startX + csIdx * cutSetSpacing;

    if (cs.order === 1) {
      // Order-1 Single Point of Failure connects directly to basic event
      const fId = cs.faultIds[0]!;
      const eventMeta = basicEventNodesMap.get(fId)!;
      edges.push(createDiagramEdge(`${orGateNodeId}->${eventMeta.id}`, orGateNodeId, eventMeta.id, "#dc2626", 2));
    } else {
      // Order > 1: AND gate combining the multiple faults
      const andGateId = `node_gate_and_${csIdx + 1}`;
      nodes.push({
        id: andGateId,
        x: csX - 30,
        y: yAndGates,
        width: 60,
        height: 50,
        angle: 0,
        opacity: 1,
        zIndex: 10,
        markup: createGateMarkup("AND", `CS #${csIdx + 1}`),
        ports: { items: [], groups: {} },
        data: { kind: "gate-and", order: cs.order },
      });

      // Edge: OR Gate -> AND Gate
      edges.push(createDiagramEdge(`${orGateNodeId}->${andGateId}`, orGateNodeId, andGateId));

      // Edges: AND Gate -> Basic Events
      for (const fId of cs.faultIds) {
        const eventMeta = basicEventNodesMap.get(fId)!;
        edges.push(createDiagramEdge(`${andGateId}->${eventMeta.id}`, andGateId, eventMeta.id));
      }
    }
  });

  // 4. Place Basic Event Leaf Nodes at bottom
  const basicEvents = Array.from(basicEventNodesMap.values());
  const nEvents = basicEvents.length;
  const eventSpacing = Math.min(cutSetSpacing, (totalWidth - 200) / Math.max(1, nEvents));
  const eventsStartX = centerX - ((nEvents - 1) * eventSpacing) / 2;

  basicEvents.forEach((ev, idx) => {
    const evX = eventsStartX + idx * eventSpacing;
    nodes.push({
      id: ev.id,
      x: evX - 35,
      y: yBasicEvents,
      width: 70,
      height: 70,
      angle: 0,
      opacity: 1,
      zIndex: 10,
      markup: createBasicEventMarkup(ev.name, "Basic Event"),
      ports: { items: [], groups: {} },
      data: { kind: "basic-event", name: ev.name },
    });
  });

  const coordinateSystem: CoordinateSystem = {
    x: 0,
    y: 0,
    width: totalWidth,
    height: yBasicEvents + 150,
  };

  return {
    nodes,
    edges,
    coordinateSystem,
    diagramBackground: null,
  };
}

function createDiagramEdge(
  id: string,
  sourceCell: string,
  targetCell: string,
  stroke = "#475569",
  strokeWidth = 1.5,
): DiagramEdge {
  return {
    id,
    source: { cell: sourceCell, port: "", anchor: "bottom", connectionPoint: { name: "boundary" } },
    target: { cell: targetCell, port: "", anchor: "top", connectionPoint: { name: "boundary" } },
    zIndex: 5,
    attrs: {
      line: {
        stroke,
        strokeWidth,
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "visiblePainted",
      },
    },
  };
}
