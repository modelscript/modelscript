// SPDX-License-Identifier: AGPL-3.0-or-later

import { isEphemeralDiagramNode } from "./drop-placeholder.js";

export interface GroupableCell {
  id: string;
  isNode?: () => boolean;
  getPosition?: () => { x: number; y: number };
  getSize?: () => { width: number; height: number };
  getChildren?: () => GroupableCell[] | null | undefined;
  addChild?: (child: GroupableCell) => void;
  removeChild?: (child: GroupableCell) => void;
  setParent?: (parent: GroupableCell | null) => void;
  setZIndex?: (z: number) => void;
  getData?: () => Record<string, unknown> | undefined;
}

export interface GroupableGraphLike {
  disposed?: boolean;
  getSelectedCells: () => GroupableCell[];
  addNode: (spec: Record<string, unknown>) => GroupableCell;
  removeCell: (cell: GroupableCell) => void;
  batchUpdate?: (name: string, fn: () => void) => void;
  cleanSelection?: () => void;
  select?: (cell: GroupableCell | GroupableCell[]) => void;
}

let groupSeq = 0;

function runBatch(g: GroupableGraphLike, name: string, fn: () => void): void {
  if (typeof g.batchUpdate === "function") {
    g.batchUpdate(name, fn);
  } else {
    fn();
  }
}

/**
 * Groups the currently selected non-ephemeral diagram nodes inside a styled container node.
 * Explicit alternative to implicit drag-to-reparent (`embedding: false`).
 */
export function groupSelectedNodesOnGraph(
  g?: GroupableGraphLike | null,
  options?: { label?: string; readOnly?: boolean },
): GroupableCell | null {
  if (!g || g.disposed || options?.readOnly) return null;

  const selectedNodes = g.getSelectedCells().filter((c) => (!c.isNode || c.isNode()) && !isEphemeralDiagramNode(c.id));
  if (selectedNodes.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of selectedNodes) {
    const pos = node.getPosition?.() ?? { x: 0, y: 0 };
    const size = node.getSize?.() ?? { width: 80, height: 60 };
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + size.width);
    maxY = Math.max(maxY, pos.y + size.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const pad = 24;
  const headerH = 26;
  const gx = Math.round(minX - pad);
  const gy = Math.round(minY - pad - headerH);
  const gw = Math.max(120, Math.round(maxX - minX + pad * 2));
  const gh = Math.max(80, Math.round(maxY - minY + pad * 2 + headerH));
  const id = `group_${Date.now()}_${++groupSeq}`;

  let createdGroup: GroupableCell | null = null;
  const groupLabel = options?.label ?? "Group";
  runBatch(g, "group-nodes", () => {
    const groupNode = g.addNode({
      id,
      shape: "rect",
      x: gx,
      y: gy,
      width: gw,
      height: gh,
      zIndex: -1,
      label: groupLabel,
      data: { isGroup: true },
      attrs: {
        body: {
          fill: "var(--ms-accent-soft, rgba(88, 166, 255, 0.08))",
          stroke: "var(--ms-accent, #58a6ff)",
          strokeWidth: 1.5,
          strokeDasharray: "6 3",
          rx: 8,
          ry: 8,
        },
        label: {
          text: groupLabel,
          fill: "var(--ms-text-2, #8b949e)",
          fontSize: 11,
          fontWeight: 600,
          refY: 12,
          textVerticalAnchor: "top",
        },
      },
    });
    for (const node of selectedNodes) {
      if (typeof groupNode.addChild === "function") {
        groupNode.addChild(node);
      } else if (typeof node.setParent === "function") {
        node.setParent(groupNode);
      }
      node.setZIndex?.(2);
    }
    createdGroup = groupNode;
  });

  if (createdGroup) {
    g.cleanSelection?.();
    g.select?.(createdGroup);
  }
  return createdGroup;
}

/**
 * Ungroups any selected container group nodes, detaching child components in place
 * while preserving their canvas coordinates.
 */
export function ungroupSelectedNodesOnGraph(
  g?: GroupableGraphLike | null,
  options?: { readOnly?: boolean },
): GroupableCell[] {
  if (!g || g.disposed || options?.readOnly) return [];

  const groups = g.getSelectedCells().filter((c) => {
    if (c.isNode && !c.isNode()) return false;
    const data = c.getData?.();
    const children = c.getChildren?.();
    return Boolean(data?.["isGroup"] || c.id.startsWith("group_") || (children && children.length > 0));
  });
  if (groups.length === 0) return [];

  const detached: GroupableCell[] = [];
  runBatch(g, "ungroup-nodes", () => {
    for (const grp of groups) {
      const children = [...(grp.getChildren?.() ?? [])];
      for (const child of children) {
        if (typeof grp.removeChild === "function") {
          grp.removeChild(child);
        } else if (typeof child.setParent === "function") {
          child.setParent(null);
        }
        detached.push(child);
      }
      g.removeCell(grp);
    }
  });

  if (detached.length > 0) {
    g.cleanSelection?.();
    g.select?.(detached);
  }
  return detached;
}
