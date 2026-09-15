// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 2D Swimlane Partition Layout Engine for Activity and Process Diagrams.
// Arranges action nodes into explicit column or row partitions (swimlanes)
// corresponding to allocating parts or actors, constraining layout within
// lane boundaries and computing clean cross-lane control/object flow routing.

export interface SwimlaneConfig {
  orientation: "vertical" | "horizontal";
  laneWidth: number;
  headerHeight: number;
  laneSpacing: number;
  nodeSpacingY: number;
  nodePaddingX: number;
  topMargin: number;
  leftMargin: number;
}

const DEFAULT_SWIMLANE_CONFIG: SwimlaneConfig = {
  orientation: "vertical",
  laneWidth: 260,
  headerHeight: 40,
  laneSpacing: 20,
  nodeSpacingY: 60,
  nodePaddingX: 30,
  topMargin: 40,
  leftMargin: 40,
};

export interface SwimlanePartition {
  id: string;
  name: string;
  stereotype?: string;
  nodeIds: string[];
}

/**
 * Applies a 2D swimlane layout to diagram nodes and edges.
 * Groups action nodes by their partition and renders container lane boxes.
 */
export function applySwimlaneLayout(
  data: { nodes: any[]; edges: any[] },
  partitions: SwimlanePartition[],
  config: Partial<SwimlaneConfig> = {},
): void {
  if (!partitions || partitions.length === 0) return;

  const cfg: SwimlaneConfig = { ...DEFAULT_SWIMLANE_CONFIG, ...config };
  const nodeMap = new Map<string, any>(data.nodes.map((n) => [n.id, n]));

  let currentX = cfg.leftMargin;
  let maxTotalHeight = 300;

  // First pass: compute lane heights based on member nodes
  const laneMetrics = partitions.map((part) => {
    const memberNodes = part.nodeIds.map((id) => nodeMap.get(id)).filter(Boolean);
    const count = memberNodes.length;
    const requiredHeight = cfg.headerHeight + cfg.topMargin + count * (60 + cfg.nodeSpacingY) + 50;
    maxTotalHeight = Math.max(maxTotalHeight, requiredHeight);
    return {
      partition: part,
      members: memberNodes,
      width: cfg.laneWidth,
    };
  });

  // Second pass: position lane container nodes and member action nodes
  for (let i = 0; i < laneMetrics.length; i++) {
    const { partition, members, width } = laneMetrics[i];
    const laneX = currentX;
    const laneY = cfg.topMargin;
    const laneHeight = maxTotalHeight;

    // Create or update partition container node
    const laneNodeId = `swimlane_${partition.id}`;
    let laneNode = nodeMap.get(laneNodeId);
    if (!laneNode) {
      laneNode = {
        id: laneNodeId,
        shape: "rect",
        zIndex: -5,
        attrs: {
          body: {
            fill: "#fafafa",
            stroke: "#90a4ae",
            strokeWidth: 1.5,
            strokeDasharray: "4 4",
            rx: 6,
            ry: 6,
          },
          label: {
            text: partition.stereotype ? `«${partition.stereotype}»\n${partition.name}` : partition.name,
            fontSize: 13,
            fontWeight: "bold",
            fill: "#37474f",
            refY: 15,
          },
        },
      };
      data.nodes.unshift(laneNode);
      nodeMap.set(laneNodeId, laneNode);
    }

    laneNode.x = laneX;
    laneNode.y = laneY;
    laneNode.width = width;
    laneNode.height = laneHeight;

    // Position member actions inside the lane
    let memberY = laneY + cfg.headerHeight + 30;
    for (const member of members) {
      const memberWidth = member.width ?? 140;
      member.x = laneX + (width - memberWidth) / 2;
      member.y = memberY;
      const memberHeight = member.height ?? 45;
      memberY += memberHeight + cfg.nodeSpacingY;
    }

    currentX += width + cfg.laneSpacing;
  }

  // Ensure all edges between actions use port-orthogonal-astar router
  for (const edge of data.edges) {
    if (!edge.router) {
      edge.router = { name: "port-orthogonal-astar" };
    }
  }
}
