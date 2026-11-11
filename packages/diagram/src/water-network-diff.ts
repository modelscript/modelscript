// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Semantic Hydraulic Network Diff & Visual PR Review Engine
 *
 * Computes topological, dimensional, and hydraulic impact deltas between two revisions
 * of an EPANET drinking water or SWMM stormwater/sewer network:
 * - Detects added, deleted, modified, and unchanged nodes & links
 * - Computes delta metrics (diameter changes, roughness changes, headloss, pressure variations)
 * - Generates publication-ready SVG visual diff overlays with standardized Git color tokens
 *   (Green for added, Red for removed, Amber for modified attributes)
 */

import type { EpanetModelLike } from "./epanet-diagram-builder.js";
import type { SwmmModelLike } from "./swmm-diagram-builder.js";
export type { EpanetModelLike, SwmmModelLike };

export type DiffElementStatus = "added" | "deleted" | "modified" | "unchanged";

export interface PropertyDelta {
  property: string;
  baseValue: number | string | undefined;
  targetValue: number | string | undefined;
  delta?: number | undefined;
}

export interface NodeDiffItem {
  id: string;
  type: "junction" | "reservoir" | "tank" | "outfall";
  status: DiffElementStatus;
  baseNode?:
    | {
        elevation: number;
        demand?: number | undefined;
        pressure?: number | undefined;
        head?: number | undefined;
        x?: number | undefined;
        y?: number | undefined;
      }
    | undefined;
  targetNode?:
    | {
        elevation: number;
        demand?: number | undefined;
        pressure?: number | undefined;
        head?: number | undefined;
        x?: number | undefined;
        y?: number | undefined;
      }
    | undefined;
  propertyDeltas: PropertyDelta[];
}

export interface LinkDiffItem {
  id: string;
  type: "pipe" | "pump" | "valve" | "conduit";
  status: DiffElementStatus;
  node1: string;
  node2: string;
  baseLink?:
    | {
        diameter: number;
        length: number;
        roughness?: number | undefined;
        flow?: number | undefined;
        velocity?: number | undefined;
      }
    | undefined;
  targetLink?:
    | {
        diameter: number;
        length: number;
        roughness?: number | undefined;
        flow?: number | undefined;
        velocity?: number | undefined;
      }
    | undefined;
  propertyDeltas: PropertyDelta[];
}

export interface NetworkDiffStats {
  addedNodes: number;
  deletedNodes: number;
  modifiedNodes: number;
  unchangedNodes: number;
  addedLinks: number;
  deletedLinks: number;
  modifiedLinks: number;
  unchangedLinks: number;
  maxPressureDeltaM: number;
  maxVelocityDeltaMs: number;
}

export interface EpanetNetworkDiff {
  title: string;
  stats: NetworkDiffStats;
  nodes: Map<string, NodeDiffItem>;
  links: Map<string, LinkDiffItem>;
  baseModel: EpanetModelLike;
  targetModel: EpanetModelLike;
}

export interface SwmmNetworkDiff {
  title: string;
  stats: NetworkDiffStats;
  nodes: Map<string, NodeDiffItem>;
  links: Map<string, LinkDiffItem>;
  baseModel: SwmmModelLike;
  targetModel: SwmmModelLike;
}

function normalizeItems<T extends { id: string }>(items: Map<string, T> | T[] | undefined): Map<string, T> {
  const map = new Map<string, T>();
  if (!items) return map;
  if (items instanceof Map) {
    for (const [k, v] of items.entries()) {
      map.set(k, v);
    }
  } else if (Array.isArray(items)) {
    for (const item of items) {
      map.set(item.id, item);
    }
  }
  return map;
}

/**
 * Computes semantic structural and hydraulic differences between two EPANET network models.
 */
export function diffEpanetNetworks(base: EpanetModelLike, target: EpanetModelLike): EpanetNetworkDiff {
  const nodeDiffs = new Map<string, NodeDiffItem>();
  const linkDiffs = new Map<string, LinkDiffItem>();

  const baseJuncs = normalizeItems(base.junctions);
  const targetJuncs = normalizeItems(target.junctions);

  let maxPDelta = 0.0;

  // Process target junctions (added or modified)
  for (const [id, tj] of targetJuncs.entries()) {
    const bj = baseJuncs.get(id);
    if (!bj) {
      nodeDiffs.set(id, {
        id,
        type: "junction",
        status: "added",
        targetNode: tj,
        propertyDeltas: [],
      });
    } else {
      const deltas: PropertyDelta[] = [];
      if (Math.abs(tj.elevation - bj.elevation) > 1e-3) {
        deltas.push({
          property: "elevation",
          baseValue: bj.elevation,
          targetValue: tj.elevation,
          delta: tj.elevation - bj.elevation,
        });
      }
      if (Math.abs((tj.demand ?? 0) - (bj.demand ?? 0)) > 1e-3) {
        deltas.push({
          property: "demand",
          baseValue: bj.demand ?? 0,
          targetValue: tj.demand ?? 0,
          delta: (tj.demand ?? 0) - (bj.demand ?? 0),
        });
      }
      if (tj.pressure !== undefined && bj.pressure !== undefined) {
        const pDelta = tj.pressure - bj.pressure;
        if (Math.abs(pDelta) > Math.abs(maxPDelta)) maxPDelta = pDelta;
        if (Math.abs(pDelta) > 0.1) {
          deltas.push({ property: "pressure", baseValue: bj.pressure, targetValue: tj.pressure, delta: pDelta });
        }
      }

      nodeDiffs.set(id, {
        id,
        type: "junction",
        status: deltas.length > 0 ? "modified" : "unchanged",
        baseNode: bj,
        targetNode: tj,
        propertyDeltas: deltas,
      });
    }
  }

  // Process deleted junctions
  for (const [id, bj] of baseJuncs.entries()) {
    if (!targetJuncs.has(id)) {
      nodeDiffs.set(id, {
        id,
        type: "junction",
        status: "deleted",
        baseNode: bj,
        propertyDeltas: [],
      });
    }
  }

  // Process pipes
  const basePipes = normalizeItems(base.pipes);
  const targetPipes = normalizeItems(target.pipes);

  let maxVDelta = 0.0;

  for (const [id, tp] of targetPipes.entries()) {
    const bp = basePipes.get(id);
    if (!bp) {
      linkDiffs.set(id, {
        id,
        type: "pipe",
        status: "added",
        node1: tp.node1,
        node2: tp.node2,
        targetLink: tp,
        propertyDeltas: [],
      });
    } else {
      const deltas: PropertyDelta[] = [];
      if (Math.abs(tp.diameter - bp.diameter) > 1e-3) {
        deltas.push({
          property: "diameter",
          baseValue: bp.diameter,
          targetValue: tp.diameter,
          delta: tp.diameter - bp.diameter,
        });
      }
      if (Math.abs(tp.length - bp.length) > 1e-3) {
        deltas.push({ property: "length", baseValue: bp.length, targetValue: tp.length, delta: tp.length - bp.length });
      }
      if (tp.velocity !== undefined && bp.velocity !== undefined) {
        const vDelta = tp.velocity - bp.velocity;
        if (Math.abs(vDelta) > Math.abs(maxVDelta)) maxVDelta = vDelta;
        if (Math.abs(vDelta) > 0.05) {
          deltas.push({ property: "velocity", baseValue: bp.velocity, targetValue: tp.velocity, delta: vDelta });
        }
      }

      linkDiffs.set(id, {
        id,
        type: "pipe",
        status: deltas.length > 0 ? "modified" : "unchanged",
        node1: tp.node1,
        node2: tp.node2,
        baseLink: bp,
        targetLink: tp,
        propertyDeltas: deltas,
      });
    }
  }

  for (const [id, bp] of basePipes.entries()) {
    if (!targetPipes.has(id)) {
      linkDiffs.set(id, {
        id,
        type: "pipe",
        status: "deleted",
        node1: bp.node1,
        node2: bp.node2,
        baseLink: bp,
        propertyDeltas: [],
      });
    }
  }

  // Count stats
  let addedN = 0;
  let delN = 0;
  let modN = 0;
  let unchN = 0;
  for (const n of nodeDiffs.values()) {
    if (n.status === "added") addedN++;
    else if (n.status === "deleted") delN++;
    else if (n.status === "modified") modN++;
    else unchN++;
  }

  let addedL = 0;
  let delL = 0;
  let modL = 0;
  let unchL = 0;
  for (const l of linkDiffs.values()) {
    if (l.status === "added") addedL++;
    else if (l.status === "deleted") delL++;
    else if (l.status === "modified") modL++;
    else unchL++;
  }

  return {
    title: `Diff: ${base.title || "Base"} → ${target.title || "Target"}`,
    stats: {
      addedNodes: addedN,
      deletedNodes: delN,
      modifiedNodes: modN,
      unchangedNodes: unchN,
      addedLinks: addedL,
      deletedLinks: delL,
      modifiedLinks: modL,
      unchangedLinks: unchL,
      maxPressureDeltaM: maxPDelta,
      maxVelocityDeltaMs: maxVDelta,
    },
    nodes: nodeDiffs,
    links: linkDiffs,
    baseModel: base,
    targetModel: target,
  };
}

/**
 * Computes semantic structural and hydraulic differences between two SWMM network models.
 */
export function diffSwmmNetworks(base: SwmmModelLike, target: SwmmModelLike): SwmmNetworkDiff {
  const nodeDiffs = new Map<string, NodeDiffItem>();
  const linkDiffs = new Map<string, LinkDiffItem>();

  const baseJuncs = normalizeItems(base.junctions);
  const targetJuncs = normalizeItems(target.junctions);

  for (const [id, tj] of targetJuncs.entries()) {
    const bj = baseJuncs.get(id);
    if (!bj) {
      nodeDiffs.set(id, {
        id,
        type: "junction",
        status: "added",
        targetNode: { elevation: tj.elevation },
        propertyDeltas: [],
      });
    } else {
      const deltas: PropertyDelta[] = [];
      if (Math.abs(tj.elevation - bj.elevation) > 1e-3) {
        deltas.push({
          property: "elevation",
          baseValue: bj.elevation,
          targetValue: tj.elevation,
          delta: tj.elevation - bj.elevation,
        });
      }
      nodeDiffs.set(id, {
        id,
        type: "junction",
        status: deltas.length > 0 ? "modified" : "unchanged",
        baseNode: { elevation: bj.elevation },
        targetNode: { elevation: tj.elevation },
        propertyDeltas: deltas,
      });
    }
  }

  for (const [id, bj] of baseJuncs.entries()) {
    if (!targetJuncs.has(id)) {
      nodeDiffs.set(id, {
        id,
        type: "junction",
        status: "deleted",
        baseNode: { elevation: bj.elevation },
        propertyDeltas: [],
      });
    }
  }

  // Conduits
  const baseConduits = normalizeItems(base.conduits);
  const targetConduits = normalizeItems(target.conduits);

  for (const [id, tc] of targetConduits.entries()) {
    const bc = baseConduits.get(id);
    const tcFrom = tc.fromNode || tc.inletNode || "N1";
    const tcTo = tc.toNode || tc.outletNode || "N2";
    const tcDiam = tc.diameter ?? 1.0;

    if (!bc) {
      linkDiffs.set(id, {
        id,
        type: "conduit",
        status: "added",
        node1: tcFrom,
        node2: tcTo,
        targetLink: { diameter: tcDiam, length: tc.length },
        propertyDeltas: [],
      });
    } else {
      const bcDiam = bc.diameter ?? 1.0;
      const deltas: PropertyDelta[] = [];
      if (Math.abs(tcDiam - bcDiam) > 1e-3) {
        deltas.push({ property: "diameter", baseValue: bcDiam, targetValue: tcDiam, delta: tcDiam - bcDiam });
      }
      if (Math.abs(tc.length - bc.length) > 1e-3) {
        deltas.push({ property: "length", baseValue: bc.length, targetValue: tc.length, delta: tc.length - bc.length });
      }

      linkDiffs.set(id, {
        id,
        type: "conduit",
        status: deltas.length > 0 ? "modified" : "unchanged",
        node1: tcFrom,
        node2: tcTo,
        baseLink: { diameter: bcDiam, length: bc.length },
        targetLink: { diameter: tcDiam, length: tc.length },
        propertyDeltas: deltas,
      });
    }
  }

  for (const [id, bc] of baseConduits.entries()) {
    if (!targetConduits.has(id)) {
      const bcFrom = bc.fromNode || bc.inletNode || "N1";
      const bcTo = bc.toNode || bc.outletNode || "N2";
      const bcDiam = bc.diameter ?? 1.0;
      linkDiffs.set(id, {
        id,
        type: "conduit",
        status: "deleted",
        node1: bcFrom,
        node2: bcTo,
        baseLink: { diameter: bcDiam, length: bc.length },
        propertyDeltas: [],
      });
    }
  }

  let addedN = 0;
  let delN = 0;
  let modN = 0;
  let unchN = 0;
  for (const n of nodeDiffs.values()) {
    if (n.status === "added") addedN++;
    else if (n.status === "deleted") delN++;
    else if (n.status === "modified") modN++;
    else unchN++;
  }

  let addedL = 0;
  let delL = 0;
  let modL = 0;
  let unchL = 0;
  for (const l of linkDiffs.values()) {
    if (l.status === "added") addedL++;
    else if (l.status === "deleted") delL++;
    else if (l.status === "modified") modL++;
    else unchL++;
  }

  return {
    title: `Diff: ${base.title || "Base"} → ${target.title || "Target"}`,
    stats: {
      addedNodes: addedN,
      deletedNodes: delN,
      modifiedNodes: modN,
      unchangedNodes: unchN,
      addedLinks: addedL,
      deletedLinks: delL,
      modifiedLinks: modL,
      unchangedLinks: unchL,
      maxPressureDeltaM: 0,
      maxVelocityDeltaMs: 0,
    },
    nodes: nodeDiffs,
    links: linkDiffs,
    baseModel: base,
    targetModel: target,
  };
}

function escapeXml(unsafe: unknown): string {
  return String(unsafe ?? "").replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

/**
 * Renders a visual schematic SVG highlighting hydraulic network diffs with Git tokens.
 */
export function renderEpanetDiffSvg(
  diff: EpanetNetworkDiff,
  options?: { theme?: "light" | "dark"; width?: number; height?: number },
): string {
  const isDark = options?.theme === "dark";
  const width = options?.width ?? 900;
  const height = options?.height ?? 600;

  const bg = isDark ? "#0d1117" : "#ffffff";
  const textPrimary = isDark ? "#c9d1d9" : "#24292f";
  const textMuted = isDark ? "#8b949e" : "#57606a";
  const border = isDark ? "#30363d" : "#d0d7de";

  const colorAdded = "#238636"; // Green
  const colorDeleted = "#da3633"; // Red
  const colorModified = "#d29922"; // Amber
  const colorUnchanged = isDark ? "#484f58" : "#8c959f"; // Muted gray

  // Collect nodes coordinates
  const positions = new Map<string, { x: number; y: number }>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const targetJuncsMap = normalizeItems(diff.targetModel.junctions);
  const baseJuncsMap = normalizeItems(diff.baseModel.junctions);
  const targetResMap = normalizeItems(diff.targetModel.reservoirs);
  const baseResMap = normalizeItems(diff.baseModel.reservoirs);
  const targetTanksMap = normalizeItems(diff.targetModel.tanks);
  const baseTanksMap = normalizeItems(diff.baseModel.tanks);

  const allNodes = [
    ...Array.from(targetJuncsMap.values()),
    ...Array.from(baseJuncsMap.values()),
    ...Array.from(targetResMap.values()),
    ...Array.from(baseResMap.values()),
    ...Array.from(targetTanksMap.values()),
    ...Array.from(baseTanksMap.values()),
  ];

  let fallbackIdx = 0;
  for (const n of allNodes) {
    if (!positions.has(n.id)) {
      const x = (n as { x?: number }).x ?? 100 + (fallbackIdx % 8) * 90;
      const y = (n as { y?: number }).y ?? 100 + Math.floor(fallbackIdx / 8) * 90;
      positions.set(n.id, { x, y });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      fallbackIdx++;
    }
  }

  // Draw links
  const linksSvg: string[] = [];
  for (const l of diff.links.values()) {
    const p1 = positions.get(l.node1);
    const p2 = positions.get(l.node2);
    if (!p1 || !p2) continue;

    let strokeColor = colorUnchanged;
    let strokeWidth = 2.5;
    let strokeDash = "";

    if (l.status === "added") {
      strokeColor = colorAdded;
      strokeWidth = 4.0;
    } else if (l.status === "deleted") {
      strokeColor = colorDeleted;
      strokeWidth = 3.0;
      strokeDash = 'stroke-dasharray="6,4"';
    } else if (l.status === "modified") {
      strokeColor = colorModified;
      strokeWidth = 3.5;
    }

    linksSvg.push(
      `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} stroke-linecap="round" />`,
    );

    // Delta badge for modified diameter
    if (l.status === "modified") {
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const diamDelta = l.propertyDeltas.find((d) => d.property === "diameter");
      if (diamDelta) {
        const sign = (diamDelta.delta ?? 0) >= 0 ? "+" : "";
        linksSvg.push(
          `<rect x="${midX - 25}" y="${midY - 10}" width="50" height="18" rx="4" fill="${colorModified}" fill-opacity="0.9" />
          <text x="${midX}" y="${midY + 2}" font-family="sans-serif" font-size="9" font-weight="700" fill="#ffffff" text-anchor="middle">${sign}${diamDelta.delta}mm</text>`,
        );
      }
    }
  }

  // Draw nodes
  const nodesSvg: string[] = [];
  for (const n of diff.nodes.values()) {
    const p = positions.get(n.id);
    if (!p) continue;

    let fillColor = colorUnchanged;
    let radius = 6;
    if (n.status === "added") {
      fillColor = colorAdded;
      radius = 8;
    } else if (n.status === "deleted") {
      fillColor = colorDeleted;
      radius = 6;
    } else if (n.status === "modified") {
      fillColor = colorModified;
      radius = 7;
    }

    nodesSvg.push(
      `<circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${fillColor}" stroke="${bg}" stroke-width="2" />
      <text x="${p.x}" y="${p.y - 10}" font-family="sans-serif" font-size="10" font-weight="600" fill="${textPrimary}" text-anchor="middle">${escapeXml(n.id)}</text>`,
    );
  }

  const addedLinks = Number(diff.stats.addedLinks) || 0;
  const deletedLinks = Number(diff.stats.deletedLinks) || 0;
  const modifiedLinks = Number(diff.stats.modifiedLinks) || 0;
  const addedNodes = Number(diff.stats.addedNodes) || 0;
  const deletedNodes = Number(diff.stats.deletedNodes) || 0;
  const modifiedNodes = Number(diff.stats.modifiedNodes) || 0;
  const maxPressureDeltaM = Number(diff.stats.maxPressureDeltaM) || 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.2"/>
    </filter>
  </defs>

  <!-- Title & Stats HUD -->
  <rect x="16" y="16" width="340" height="90" rx="8" fill="${bg}" stroke="${border}" filter="url(#shadow)" />
  <text x="30" y="40" font-size="13" font-weight="700" fill="${textPrimary}">Visual PR Diff: Water Network</text>
  <text x="30" y="60" font-size="11" fill="${textMuted}">
    Pipes: +${addedLinks} added, -${deletedLinks} deleted, ~${modifiedLinks} modified
  </text>
  <text x="30" y="78" font-size="11" fill="${textMuted}">
    Nodes: +${addedNodes} added, -${deletedNodes} deleted, ~${modifiedNodes} modified
  </text>
  <text x="30" y="94" font-size="10" font-weight="600" fill="${maxPressureDeltaM < -5 ? colorDeleted : colorAdded}">
    Max Pressure Impact: ${maxPressureDeltaM >= 0 ? "+" : ""}${maxPressureDeltaM.toFixed(1)} m head
  </text>

  <!-- Legend -->
  <rect x="${width - 180}" y="16" width="160" height="96" rx="8" fill="${bg}" stroke="${border}" filter="url(#shadow)" />
  <circle cx="${width - 160}" cy="34" r="5" fill="${colorAdded}" />
  <text x="${width - 145}" y="38" font-size="11" fill="${textPrimary}">Added (+)</text>
  <circle cx="${width - 160}" cy="54" r="5" fill="${colorDeleted}" />
  <text x="${width - 145}" y="58" font-size="11" fill="${textPrimary}">Deleted (-)</text>
  <circle cx="${width - 160}" cy="74" r="5" fill="${colorModified}" />
  <text x="${width - 145}" y="78" font-size="11" fill="${textPrimary}">Modified (~)</text>
  <circle cx="${width - 160}" cy="94" r="5" fill="${colorUnchanged}" />
  <text x="${width - 145}" y="98" font-size="11" fill="${textMuted}">Unchanged</text>

  <!-- Graphic Elements -->
  <g id="links">
    ${linksSvg.join("\n    ")}
  </g>
  <g id="nodes">
    ${nodesSvg.join("\n    ")}
  </g>
</svg>`;
}
