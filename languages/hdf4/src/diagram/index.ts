// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeSdsStatistics, traverseVgroupHierarchy, type Hdf4HierarchyNode } from "../solver/index.js";
import { HDF4_DATA_TYPE_NAMES, type Hdf4Document, type Hdf4Sds } from "../types.js";

export interface Hdf4DiagramNode {
  id: string;
  label: string;
  kind: Hdf4HierarchyNode["kind"];
  x: number;
  y: number;
  width: number;
  height: number;
  detail: string;
}

export interface Hdf4DiagramEdge {
  from: string;
  to: string;
}

export interface Hdf4DiagramData {
  nodes: Hdf4DiagramNode[];
  edges: Hdf4DiagramEdge[];
  selectedSds?: Hdf4Sds | undefined;
}

export interface RenderHdf4DiagramOptions {
  /** Optional SDS name to render in the 2D heatmap panel (defaults to first 2D or first SDS). */
  sdsName?: string | undefined;
  /** Optional color scheme ("dark" | "light"). */
  colorMode?: "dark" | "light" | undefined;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Viridis-inspired perceptual color ramp for normalized value `t in [0, 1]`.
 */
function viridisColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: Array<[number, number, number]> = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = stops[idx] ?? [68, 1, 84];
  const c1 = stops[idx + 1] ?? [253, 231, 37];
  const r = Math.round(c0[0] + frac * (c1[0] - c0[0]));
  const g = Math.round(c0[1] + frac * (c1[1] - c0[1]));
  const b = Math.round(c0[2] + frac * (c1[2] - c0[2]));
  return `rgb(${r},${g},${b})`;
}

/**
 * Builds positioned Vgroup/SDS hierarchy nodes and edges for SVG rendering.
 */
export function buildHdf4DiagramData(doc: Hdf4Document, sdsName?: string): Hdf4DiagramData {
  const hierarchy = traverseVgroupHierarchy(doc);
  const nodes: Hdf4DiagramNode[] = [];
  const edges: Hdf4DiagramEdge[] = [];
  const sdsByName = new Map(doc.sdsList.map((s) => [s.name, s]));

  let rowCounter = 0;
  const nodeWidth = 148;
  const nodeHeight = 36;
  const xStep = 170;
  const yStep = 50;

  const visit = (node: Hdf4HierarchyNode, parentId?: string): void => {
    const id = `n_${rowCounter}`;
    const x = 24 + node.depth * xStep;
    const y = 48 + rowCounter * yStep;
    rowCounter++;

    let detail: string = node.kind;
    if (node.kind === "SDS") {
      const sds = sdsByName.get(node.name);
      if (sds) {
        const shape = sds.dims.map((d) => d.size).join("x") || "scalar";
        const dtype = HDF4_DATA_TYPE_NAMES[sds.dataType] ?? `T${sds.dataType}`;
        detail = `${dtype} [${shape}]`;
      }
    } else if (node.kind === "VGROUP" && node.vgroupClass) {
      detail = `VGROUP (${node.vgroupClass})`;
    } else if (node.ref !== undefined) {
      detail = `${node.kind} ref=${node.ref}`;
    }

    nodes.push({
      id,
      label: node.name,
      kind: node.kind,
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      detail,
    });
    if (parentId) {
      edges.push({ from: parentId, to: id });
    }
    for (const child of node.children) {
      visit(child, id);
    }
  };

  visit(hierarchy.root);

  const selectedSds =
    (sdsName ? doc.sdsList.find((s) => s.name === sdsName) : undefined) ??
    doc.sdsList.find((s) => s.dims.length >= 2 && s.data.length > 0) ??
    doc.sdsList[0];

  return { nodes, edges, selectedSds };
}

/**
 * Renders a pure SVG combining the Vgroup/SDS hierarchy tree (left) and a 2D SDS dataset heatmap (right).
 */
export function renderHdf4DiagramSvg(doc: Hdf4Document, options?: RenderHdf4DiagramOptions): string {
  const isLight = options?.colorMode === "light";
  const bg = isLight ? "#f8fafc" : "#0b1220";
  const panelBg = isLight ? "#ffffff" : "#111b2e";
  const border = isLight ? "#cbd5e1" : "#24344d";
  const textMain = isLight ? "#0f172a" : "#f1f5f9";
  const textMuted = isLight ? "#475569" : "#94a3b8";

  const data = buildHdf4DiagramData(doc, options?.sdsName);
  const treeRight = data.nodes.reduce((acc, n) => Math.max(acc, n.x + n.width), 360) + 32;
  const treeBottom = data.nodes.reduce((acc, n) => Math.max(acc, n.y + n.height), 260) + 32;

  const heatmapPanelX = treeRight + 16;
  const heatmapPanelW = 340;
  const totalWidth = heatmapPanelX + heatmapPanelW + 20;
  const totalHeight = Math.max(360, treeBottom);

  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const kindColors: Record<Hdf4DiagramNode["kind"], { fill: string; stroke: string }> = {
    FILE: { fill: isLight ? "#dbeafe" : "#1e3a5f", stroke: "#38bdf8" },
    VGROUP: { fill: isLight ? "#e0e7ff" : "#26285a", stroke: "#818cf8" },
    SDS: { fill: isLight ? "#d1fae5" : "#143d32", stroke: "#34d399" },
    VDATA: { fill: isLight ? "#fef3c7" : "#422f14", stroke: "#fbbf24" },
    RASTER8: { fill: isLight ? "#fce7f3" : "#471d38", stroke: "#f472b6" },
    PALETTE: { fill: isLight ? "#ede9fe" : "#35214f", stroke: "#c084fc" },
    TAGREF: { fill: isLight ? "#f1f5f9" : "#1e293b", stroke: "#94a3b8" },
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">`,
  );
  parts.push(`  <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="${bg}"/>`);

  // Left section: Vgroup/SDS Hierarchy
  parts.push(
    `  <rect x="12" y="12" width="${treeRight - 12}" height="${totalHeight - 24}" rx="8" fill="${panelBg}" stroke="${border}" stroke-width="1"/>`,
  );
  parts.push(
    `  <text x="24" y="34" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="${textMain}">HDF4 Hierarchy — ${escapeXml(doc.name)}</text>`,
  );

  // Edges
  for (const edge of data.edges) {
    const src = nodeById.get(edge.from);
    const dst = nodeById.get(edge.to);
    if (!src || !dst) continue;
    const x1 = src.x + src.width;
    const y1 = src.y + src.height / 2;
    const x2 = dst.x;
    const y2 = dst.y + dst.height / 2;
    const midX = (x1 + x2) / 2;
    parts.push(
      `  <path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="${border}" stroke-width="1.6"/>`,
    );
  }

  // Nodes
  for (const n of data.nodes) {
    const colors = kindColors[n.kind];
    parts.push(
      `  <g data-hdf4-node="${escapeXml(n.label)}" data-kind="${n.kind}">`,
      `    <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>`,
      `    <text x="${n.x + 8}" y="${n.y + 15}" font-family="monospace" font-size="11" font-weight="700" fill="${textMain}">${escapeXml(n.label.slice(0, 18))}</text>`,
      `    <text x="${n.x + 8}" y="${n.y + 28}" font-family="monospace" font-size="9" fill="${textMuted}">${escapeXml(n.detail.slice(0, 22))}</text>`,
      `  </g>`,
    );
  }

  // Right section: 2D SDS Dataset Heatmap
  parts.push(
    `  <rect x="${heatmapPanelX}" y="12" width="${heatmapPanelW}" height="${totalHeight - 24}" rx="8" fill="${panelBg}" stroke="${border}" stroke-width="1"/>`,
  );

  const sds = data.selectedSds;
  if (sds && sds.data.length > 0) {
    const stats = computeSdsStatistics(sds.data);
    const rows = sds.dims.length >= 2 ? Math.max(1, sds.dims[0]?.size ?? 1) : 1;
    const cols = sds.dims.length >= 2 ? Math.max(1, sds.dims[1]?.size ?? 1) : Math.max(1, sds.data.length);

    parts.push(
      `  <text x="${heatmapPanelX + 14}" y="34" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="${textMain}">2D SDS Heatmap: ${escapeXml(sds.name)}</text>`,
      `  <text x="${heatmapPanelX + 14}" y="50" font-family="monospace" font-size="10" fill="${textMuted}">shape=[${rows}x${cols}] min=${stats.min.toFixed(3)} max=${stats.max.toFixed(3)} mean=${stats.mean.toFixed(3)}</text>`,
    );

    const gridX = heatmapPanelX + 16;
    const gridY = 64;
    const gridW = heatmapPanelW - 56;
    const gridH = Math.min(220, totalHeight - 120);
    const cellW = gridW / cols;
    const cellH = gridH / rows;
    const span = stats.max - stats.min || 1;

    parts.push(`  <g data-hdf4-heatmap="${escapeXml(sds.name)}">`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = sds.data[r * cols + c] ?? stats.min;
        const norm = (val - stats.min) / span;
        const fill = Number.isFinite(val) ? viridisColor(norm) : "#ef4444";
        parts.push(
          `    <rect x="${(gridX + c * cellW).toFixed(2)}" y="${(gridY + r * cellH).toFixed(2)}" width="${Math.max(1, cellW).toFixed(2)}" height="${Math.max(1, cellH).toFixed(2)}" fill="${fill}" stroke="${panelBg}" stroke-width="0.4"/>`,
        );
      }
    }
    parts.push(`  </g>`);

    // Colorbar legend
    const barX = gridX + gridW + 10;
    const barW = 14;
    const steps = 12;
    const stepH = gridH / steps;
    for (let s = 0; s < steps; s++) {
      const t = 1 - s / (steps - 1);
      parts.push(
        `  <rect x="${barX}" y="${(gridY + s * stepH).toFixed(2)}" width="${barW}" height="${(stepH + 0.5).toFixed(2)}" fill="${viridisColor(t)}"/>`,
      );
    }
    parts.push(
      `  <text x="${gridX}" y="${gridY + gridH + 18}" font-family="monospace" font-size="10" fill="${textMuted}">std=${stats.std.toFixed(4)}  rms=${stats.rms.toFixed(4)}${sds.unit ? `  unit=${escapeXml(sds.unit)}` : ""}</text>`,
    );
  } else {
    parts.push(
      `  <text x="${heatmapPanelX + 14}" y="34" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="${textMain}">2D SDS Heatmap</text>`,
      `  <text x="${heatmapPanelX + 14}" y="64" font-family="monospace" font-size="11" fill="${textMuted}">No SDS numeric dataset available.</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}
