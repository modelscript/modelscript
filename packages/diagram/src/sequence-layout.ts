// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Custom layout engine for SysML2 Sequence Diagrams.
//
// Sequence diagrams cannot use Dagre because they require a dual-axis layout:
//   - Horizontal axis: lifeline participants, ordered left-to-right
//   - Vertical axis: messages, ordered top-to-bottom by time
//
// This module takes PolyglotDiagramData (nodes + edges) and repositions them
// into a proper sequence diagram layout with lifelines, messages, and
// optional activation boxes.

// ── Layout Configuration ──

export interface SequenceLayoutConfig {
  /** Horizontal spacing between lifeline centers */
  lifelineSpacing: number;
  /** Vertical spacing between consecutive messages */
  messageSpacing: number;
  /** Starting Y position for the first message (below lifeline headers) */
  messageStartY: number;
  /** Width of lifeline header boxes */
  headerWidth: number;
  /** Height of lifeline header boxes */
  headerHeight: number;
  /** Width of the dashed lifeline stem */
  lifelineStemWidth: number;
  /** Margin at the top of the diagram */
  topMargin: number;
  /** Margin at the left of the diagram */
  leftMargin: number;
}

const DEFAULT_CONFIG: SequenceLayoutConfig = {
  lifelineSpacing: 200,
  messageSpacing: 50,
  messageStartY: 100,
  headerWidth: 140,
  headerHeight: 50,
  lifelineStemWidth: 2,
  topMargin: 30,
  leftMargin: 40,
};

// ── Layout Types ──

export interface SequenceLifeline {
  /** Node ID from the diagram data */
  nodeId: string;
  /** Display name */
  name: string;
  /** Center X position (computed by layout) */
  centerX: number;
  /** Header top-left Y (computed by layout) */
  headerY: number;
  /** Total lifeline height (header + stem, computed by layout) */
  totalHeight: number;
}

export interface SequenceMessage {
  /** Edge ID from the diagram data */
  edgeId: string;
  /** Source lifeline node ID */
  sourceId: string;
  /** Target lifeline node ID */
  targetId: string;
  /** Message label text */
  label: string;
  /** Y position of the message arrow */
  y: number;
  /** Type: sync (solid filled arrow), async (open arrow), reply (dashed) */
  type: "sync" | "async" | "reply";
  /** True if this is a self-message (source == target) */
  isSelf: boolean;
}

export interface SequenceLayoutResult {
  /** Repositioned lifeline data */
  lifelines: SequenceLifeline[];
  /** Message data with computed Y positions */
  messages: SequenceMessage[];
  /** Total diagram width */
  totalWidth: number;
  /** Total diagram height */
  totalHeight: number;
}

// ── Layout Algorithm ──

/**
 * Apply sequence diagram layout to a set of nodes and edges.
 *
 * @param nodes  Node data from PolyglotDiagramData (each has id, x, y, width, height, etc.)
 * @param edges  Edge data from PolyglotDiagramData (each has id, source, target, etc.)
 * @param config Optional layout configuration overrides
 * @returns      The layout result with lifeline and message positions
 */
export function computeSequenceLayout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[],
  config: Partial<SequenceLayoutConfig> = {},
): SequenceLayoutResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── Step 1: Identify lifelines (nodes) and determine ordering ──
  // Filter out background and system nodes
  const lifelineNodes = nodes.filter((n) => n.id && !n.id.startsWith("__diagram_") && !n.parent);

  // Sort lifelines by their original position (left-to-right) or textual order
  lifelineNodes.sort((a, b) => {
    // If both have explicit positions, use x-order
    if (a.x !== 0 && b.x !== 0) return a.x - b.x;
    // Otherwise preserve the array order (textual order from source)
    return 0;
  });

  // ── Step 2: Assign horizontal positions to lifelines ──
  const lifelines: SequenceLifeline[] = lifelineNodes.map((node, index) => ({
    nodeId: node.id,
    name: node.data?.properties?.description ?? node.id.replace(/^n_\d+$/, ""),
    centerX: cfg.leftMargin + index * cfg.lifelineSpacing + cfg.headerWidth / 2,
    headerY: cfg.topMargin,
    totalHeight: 0, // computed after messages
  }));

  // Build lookup: node ID → lifeline
  const lifelineMap = new Map<string, SequenceLifeline>();
  for (const ll of lifelines) {
    lifelineMap.set(ll.nodeId, ll);
  }

  // ── Step 3: Compute message positions (vertical ordering) ──
  // Edges become horizontal message arrows ordered top-to-bottom
  const messages: SequenceMessage[] = [];
  let currentY = cfg.topMargin + cfg.headerHeight + cfg.messageStartY;

  for (const edge of edges) {
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source?.cell;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target?.cell;
    if (!sourceId || !targetId) continue;
    if (!lifelineMap.has(sourceId) || !lifelineMap.has(targetId)) continue;

    // Determine message type from edge attrs
    let type: SequenceMessage["type"] = "sync";
    const strokeDash = edge.attrs?.line?.strokeDasharray;
    if (strokeDash) type = "reply";
    const marker = edge.attrs?.line?.targetMarker;
    if (marker === "none" || marker === "") type = "async";

    // Extract label from edge labels or attrs
    let label = "";
    if (edge.labels && edge.labels.length > 0) {
      label = edge.labels[0]?.attrs?.text?.text ?? "";
    }

    const isSelf = sourceId === targetId;
    messages.push({
      edgeId: edge.id,
      sourceId,
      targetId,
      label,
      y: currentY,
      type,
      isSelf,
    });

    // Self-messages take more vertical space (loop arc)
    currentY += isSelf ? cfg.messageSpacing * 1.5 : cfg.messageSpacing;
  }

  // ── Step 4: Compute total height and lifeline stem length ──
  const stemBottom =
    messages.length > 0
      ? messages[messages.length - 1].y + cfg.messageSpacing
      : cfg.topMargin + cfg.headerHeight + cfg.messageStartY + 60;

  for (const ll of lifelines) {
    ll.totalHeight = stemBottom - ll.headerY;
  }

  const totalWidth =
    lifelines.length > 0
      ? lifelines[lifelines.length - 1].centerX + cfg.headerWidth / 2 + cfg.leftMargin
      : cfg.leftMargin * 2 + cfg.headerWidth;
  const totalHeight = stemBottom + cfg.topMargin;

  return { lifelines, messages, totalWidth, totalHeight };
}

// ── Apply Layout to Diagram Data ──

/**
 * Modifies diagram node/edge data in-place to apply sequence diagram layout.
 * Converts generic block nodes into lifeline header boxes and adds dashed
 * lifeline stems as decoration. Repositions edges as horizontal message arrows.
 *
 * @param nodes  Mutable node array from diagram data
 * @param edges  Mutable edge array from diagram data
 * @param isDark Whether to use dark theme colors
 * @returns      The layout result for additional rendering
 */
export function applySequenceLayout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[],
  isDark: boolean,
): SequenceLayoutResult {
  const layout = computeSequenceLayout(nodes, edges);

  const textColor = isDark ? "#e0e0e0" : "#1a1a1a";
  const strokeColor = isDark ? "#888" : "#333";
  const headerFill = isDark ? "#2d2d30" : "#e3f2fd";
  const headerStroke = isDark ? "#555" : "#1565c0";

  // ── Reposition lifeline header nodes ──
  for (const ll of layout.lifelines) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = nodes.find((n: any) => n.id === ll.nodeId);
    if (!node) continue;

    // Override position to lifeline layout position
    node.x = ll.centerX - 70; // center the 140px header
    node.y = ll.headerY;
    node.width = 140;
    node.height = 50;
    node.autoLayout = false;

    // Override markup to be a sequence diagram lifeline header
    node.markup = [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "label" },
    ];
    node.attrs = {
      body: {
        fill: headerFill,
        stroke: headerStroke,
        strokeWidth: 1.5,
        rx: 4,
        ry: 4,
        refWidth: "100%",
        refHeight: "100%",
      },
      label: {
        text: ll.name,
        fill: textColor,
        fontSize: 13,
        fontWeight: "bold",
        textAnchor: "middle",
        textVerticalAnchor: "middle",
        refX: 0.5,
        refY: 0.5,
      },
    };
  }

  // ── Add lifeline stems (dashed vertical lines) as decoration nodes ──
  for (const ll of layout.lifelines) {
    const stemHeight = ll.totalHeight - 50; // subtract header height
    if (stemHeight <= 0) continue;

    nodes.push({
      id: `__seq_stem_${ll.nodeId}`,
      x: ll.centerX - 1,
      y: ll.headerY + 50, // starts below header
      width: 2,
      height: stemHeight,
      zIndex: -1,
      autoLayout: false,
      markup: [{ tagName: "rect", selector: "body" }],
      attrs: {
        body: {
          fill: "none",
          stroke: strokeColor,
          strokeWidth: 1.5,
          strokeDasharray: "8 4",
          refWidth: "100%",
          refHeight: "100%",
        },
      },
    });
  }

  // ── Reposition message edges ──
  // Build lifeline center-X lookup
  const centerXMap = new Map<string, number>();
  for (const ll of layout.lifelines) {
    centerXMap.set(ll.nodeId, ll.centerX);
  }

  for (const msg of layout.messages) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edge = edges.find((e: any) => e.id === msg.edgeId);
    if (!edge) continue;

    const srcX = centerXMap.get(msg.sourceId) ?? 0;
    const tgtX = centerXMap.get(msg.targetId) ?? 0;

    if (msg.isSelf) {
      // Self-message: loop arc to the right and back
      const loopWidth = 40;
      edge.vertices = [
        { x: srcX + loopWidth, y: msg.y },
        { x: srcX + loopWidth, y: msg.y + 25 },
      ];
      // Override source/target to be coordinate-based for the stem
      edge.source = { x: srcX, y: msg.y };
      edge.target = { x: srcX, y: msg.y + 25 };
    } else {
      // Normal message: horizontal arrow from source to target lifeline
      edge.source = { x: srcX, y: msg.y };
      edge.target = { x: tgtX, y: msg.y };
      edge.vertices = undefined;
    }

    // Override router — sequence messages are straight lines, not manhattan
    edge.router = { name: "normal" };
    edge.connector = undefined;

    // Apply message type styling
    if (msg.type === "reply") {
      edge.attrs = {
        line: {
          stroke: strokeColor,
          strokeWidth: 1,
          strokeDasharray: "6 3",
          targetMarker: { name: "classic", size: 6 },
          "vector-effect": "non-scaling-stroke",
          "pointer-events": "visibleStroke",
        },
      };
    } else if (msg.type === "async") {
      edge.attrs = {
        line: {
          stroke: strokeColor,
          strokeWidth: 1.5,
          targetMarker: { name: "classic", size: 6, fill: "none" },
          "vector-effect": "non-scaling-stroke",
          "pointer-events": "visibleStroke",
        },
      };
    } else {
      // Synchronous: filled arrowhead
      edge.attrs = {
        line: {
          stroke: strokeColor,
          strokeWidth: 1.5,
          targetMarker: { name: "classic", size: 8 },
          "vector-effect": "non-scaling-stroke",
          "pointer-events": "visibleStroke",
        },
      };
    }

    // Add message label above the arrow
    if (msg.label) {
      edge.labels = [
        {
          attrs: {
            text: { text: msg.label, fill: textColor, fontSize: 11, fontWeight: "normal" },
            rect: { fill: isDark ? "#1e1e1e" : "#fff", stroke: "none", rx: 3, ry: 3 },
          },
          position: { distance: 0.5, offset: -12 },
        },
      ];
    }
  }

  return layout;
}
