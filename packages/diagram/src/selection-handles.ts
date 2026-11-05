// SPDX-License-Identifier: AGPL-3.0-or-later

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeLike {
  id: string;
  isNode?(): boolean;
  getBBox?(): RectLike;
  getAngle?(): number;
}

export interface GraphLike {
  container?: HTMLElement | undefined;
  matrix?: (() => { a: number; d: number; e: number; f: number }) | undefined;
  coord?: { localToGraphRect?: (rect: RectLike) => RectLike } | undefined;
  getCellById?(id: string): unknown;
  zoom?: (() => number) | undefined;
}

/**
 * Synchronizes a node's selection box DOM element with its model position, size, and rotation angle.
 */
export function alignNodeSelectionBox(box: HTMLElement, node: NodeLike, graph: GraphLike): void {
  if (!box || !node) return;
  const bbox = typeof node.getBBox === "function" ? node.getBBox() : null;
  if (!bbox) return;

  let x: number;
  let y: number;
  let w: number;
  let h: number;

  if (graph.coord && typeof graph.coord.localToGraphRect === "function") {
    const rect = graph.coord.localToGraphRect(bbox);
    x = rect.x;
    y = rect.y;
    w = rect.width;
    h = rect.height;
  } else {
    const ctm = typeof graph.matrix === "function" ? graph.matrix() : { a: 1, d: 1, e: 0, f: 0 };
    x = bbox.x * ctm.a + ctm.e;
    y = bbox.y * ctm.d + ctm.f;
    w = bbox.width * ctm.a;
    h = bbox.height * ctm.d;
  }

  const rawAngle = typeof node.getAngle === "function" ? node.getAngle() : 0;
  const angle = ((rawAngle % 360) + 360) % 360;
  const transform = angle !== 0 ? `rotate(${angle}deg)` : "";

  box.style.position = "absolute";
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  box.style.margin = "-5px 0 0 -5px";
  box.style.padding = "4px";
  box.style.boxSizing = "content-box";
  box.style.transform = transform;
  box.style.transformOrigin = "center center";
}

/**
 * Iterates all active selection boxes and aligns any that belong to nodes.
 */
export function syncAllNodeSelectionBoxes(graph: GraphLike, selectionContainer?: HTMLElement | null): void {
  const container = selectionContainer || graph.container?.querySelector?.(".x6-widget-selection");
  if (!container) return;
  const boxes = container.querySelectorAll(".x6-widget-selection-box");
  boxes.forEach((elem) => {
    const el = elem as HTMLElement;
    const id = el.getAttribute("data-cell-id");
    if (!id) return;
    const cell = typeof graph.getCellById === "function" ? (graph.getCellById(id) as NodeLike | null) : null;
    if (cell && (typeof cell.isNode !== "function" || cell.isNode())) {
      alignNodeSelectionBox(el, cell, graph);
    }
  });
}

/**
 * Returns refined edge tool configurations for vertices and segments.
 * Dynamically scales handle dimensions based on graph zoom to prevent unsightly oversized handles.
 */
export function getEdgeToolConfig(_edge: unknown, graph: GraphLike, dark: boolean): unknown[] {
  const curZoom = typeof graph.zoom === "function" ? graph.zoom() : 1;
  // Scale handles to maintain a crisp, refined size on screen (~4px radius, 8px diameter)
  const vertexRadius = Math.max(1.2, Math.min(3, 3.5 / (curZoom || 1)));
  const segW = Math.max(4, Math.min(10, 10 / (curZoom || 1)));
  const segH = Math.max(1.2, Math.min(2.5, 3 / (curZoom || 1)));

  return [
    {
      name: "vertices",
      args: {
        attrs: {
          fill: dark ? "#1e293b" : "#ffffff",
          stroke: dark ? "#38bdf8" : "#0284c7",
          strokeWidth: 1.5,
          r: vertexRadius,
        },
        snapRadius: 10,
        removeRedundancies: true,
        stopPropagation: false,
      },
    },
    {
      name: "segments",
      args: {
        attrs: {
          fill: dark ? "#1e293b" : "#ffffff",
          stroke: dark ? "#38bdf8" : "#0284c7",
          strokeWidth: 1.5,
          width: segW,
          height: segH,
          rx: segH / 2,
          ry: segH / 2,
          x: -segW / 2,
          y: -segH / 2,
        },
        snapRadius: 10,
        removeRedundancies: true,
        stopPropagation: false,
      },
    },
  ];
}
