// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bond Graph & Block Diagram SVG renderer for `@modelscript/twentysim`.
 *
 * Renders power bonds with authentic Bond Graph half-arrows and perpendicular
 * SCAP causal stroke bars, plus signal arrows and node badges.
 */

import { runScap } from "../lints/scap.js";
import { parseTwentySim } from "../parser/emx-parser.js";
import type { BondCausality, BondGraphElementKind, TwentySimModel, TwentySimSubmodel } from "../types.js";

export interface BondGraphDiagramNode {
  id: string;
  label: string;
  elementKind: BondGraphElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BondGraphDiagramEdge {
  id: string;
  kind: "bond" | "signal";
  fromId: string;
  toId: string;
  causality: BondCausality;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BondGraphDiagramScene {
  modelName: string;
  width: number;
  height: number;
  nodes: BondGraphDiagramNode[];
  edges: BondGraphDiagramEdge[];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layoutSubmodels(sub: TwentySimSubmodel): Map<string, { x: number; y: number; w: number; h: number }> {
  const layout = new Map<string, { x: number; y: number; w: number; h: number }>();
  const cols = Math.max(1, Math.ceil(Math.sqrt(sub.submodels.length)));
  sub.submodels.forEach((child, idx) => {
    const isJunc = child.elementKind === "0" || child.elementKind === "1";
    const w = child.position?.width ?? (isJunc ? 36 : 72);
    const h = child.position?.height ?? (isJunc ? 36 : 44);
    const x = child.position?.x ?? 80 + (idx % cols) * 160;
    const y = child.position?.y ?? 80 + Math.floor(idx / cols) * 120;
    layout.set(child.name, { x, y, w, h });
  });
  return layout;
}

/**
 * Builds a structured Bond Graph diagram scene with SCAP-assigned causal strokes.
 */
export function buildBondGraphDiagram(modelOrSource: TwentySimModel | string): BondGraphDiagramScene {
  const model = typeof modelOrSource === "string" ? parseTwentySim(modelOrSource) : modelOrSource;
  const root = model.root;
  const scap = runScap(root);
  const posMap = layoutSubmodels(root);

  const nodes: BondGraphDiagramNode[] = root.submodels.map((s) => {
    const p = posMap.get(s.name)!;
    return {
      id: s.name,
      label: s.elementKind === "0" || s.elementKind === "1" ? s.elementKind : `${s.elementKind}:${s.name}`,
      elementKind: s.elementKind,
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
    };
  });

  const edges: BondGraphDiagramEdge[] = [];
  for (const conn of root.connections) {
    const a = posMap.get(conn.fromSubmodel);
    const b = posMap.get(conn.toSubmodel);
    if (!a || !b) continue;
    const causality = conn.causality ?? scap.bondCausality.get(conn.id) ?? "unassigned";
    edges.push({
      id: conn.id,
      kind: conn.kind,
      fromId: conn.fromSubmodel,
      toId: conn.toSubmodel,
      causality,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }

  let maxX = 400;
  let maxY = 260;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width + 60);
    maxY = Math.max(maxY, n.y + n.height + 60);
  }

  return {
    modelName: model.name,
    width: Math.ceil(maxX),
    height: Math.ceil(maxY),
    nodes,
    edges,
  };
}

/**
 * Renders a 20-sim Bond Graph diagram as a standalone SVG string.
 */
export function renderBondGraphSvg(modelOrSource: TwentySimModel | string): string {
  const scene = buildBondGraphDiagram(modelOrSource);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
    `  <rect width="100%" height="100%" fill="#0f172a"/>`,
    `  <text x="16" y="24" fill="#e2e8f0" font-family="monospace" font-size="14" font-weight="bold">20-sim: ${escapeXml(scene.modelName)}</text>`,
  ];

  // Edges (power bonds with half-arrow + causal stroke; signal arrows dashed)
  for (const e of scene.edges) {
    const dx = e.x2 - e.x1;
    const dy = e.y2 - e.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const sx = e.x1 + ux * 24;
    const sy = e.y1 + uy * 24;
    const ex = e.x2 - ux * 24;
    const ey = e.y2 - uy * 24;

    const strokeColor = e.causality === "conflict" ? "#ef4444" : e.kind === "signal" ? "#38bdf8" : "#f8fafc";
    const dash = e.kind === "signal" ? ' stroke-dasharray="5,4"' : "";
    parts.push(
      `  <line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${strokeColor}" stroke-width="2"${dash}/>`,
    );

    if (e.kind === "bond") {
      // Half-arrow (harpoon) at target end indicating positive power direction
      const hx = ex - ux * 10 + px * 6;
      const hy = ey - uy * 10 + py * 6;
      parts.push(
        `  <line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${strokeColor}" stroke-width="2"/>`,
      );

      // Perpendicular causal stroke bar
      if (e.causality === "effort-to-target" || e.causality === "effort-to-source") {
        const cx = e.causality === "effort-to-target" ? ex : sx;
        const cy = e.causality === "effort-to-target" ? ey : sy;
        const c1x = cx + px * 8;
        const c1y = cy + py * 8;
        const c2x = cx - px * 8;
        const c2y = cy - py * 8;
        parts.push(
          `  <line x1="${c1x.toFixed(1)}" y1="${c1y.toFixed(1)}" x2="${c2x.toFixed(1)}" y2="${c2y.toFixed(1)}" stroke="#f59e0b" stroke-width="2.5"/>`,
        );
      }
    }
  }

  // Nodes
  for (const n of scene.nodes) {
    const isJunc = n.elementKind === "0" || n.elementKind === "1";
    if (isJunc) {
      parts.push(
        `  <circle cx="${n.x}" cy="${n.y}" r="16" fill="#1e293b" stroke="#22c55e" stroke-width="2"/>`,
        `  <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" fill="#f8fafc" font-family="monospace" font-size="14" font-weight="bold">${escapeXml(n.elementKind)}</text>`,
      );
    } else {
      const rx = n.x - n.width / 2;
      const ry = n.y - n.height / 2;
      parts.push(
        `  <rect x="${rx}" y="${ry}" width="${n.width}" height="${n.height}" rx="6" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>`,
        `  <text x="${n.x}" y="${n.y + 4}" text-anchor="middle" fill="#f8fafc" font-family="monospace" font-size="11">${escapeXml(n.label)}</text>`,
      );
    }
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
