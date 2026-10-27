// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — EPA-SWMM Stormwater Conveyance & Hydraulic Profile Diagram Builder.
 *
 * Provides dual visualization modes:
 * 1. 2D Network Plan View: Junction manholes, outfalls, and conduits with flow capacity utilization.
 * 2. Longitudinal Hydraulic Grade Line (HGL) Elevation Profile: Ground rim elevation, conduit inverts/crowns,
 *    and water surface profile showing surcharge and flooding risks.
 */

export interface SwmmJunctionLike {
  id: string;
  elevation: number;
  maxDepth: number;
  initDepth?: number | undefined;
  surchargeDepth?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface SwmmOutfallLike {
  id: string;
  elevation: number;
  type: string;
  stage?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface SwmmConduitLike {
  id: string;
  fromNode?: string | undefined;
  toNode?: string | undefined;
  inletNode?: string | undefined;
  outletNode?: string | undefined;
  length: number;
  roughness: number;
  inletOffset?: number | undefined;
  outletOffset?: number | undefined;
  diameter?: number | undefined;
  flowRate?: number | undefined;
  capacityFraction?: number | undefined; // Q / Q_full
}

export interface SwmmModelLike {
  title?: string | undefined;
  junctions: Map<string, SwmmJunctionLike> | SwmmJunctionLike[];
  outfalls: Map<string, SwmmOutfallLike> | SwmmOutfallLike[];
  conduits: Map<string, SwmmConduitLike> | SwmmConduitLike[];
  flowUnits?: string | undefined;
}

export interface SwmmDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface SwmmDiagramGraph {
  title: string;
  cells: SwmmDiagramCell[];
}

export interface SwmmRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface SwmmProfileOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
  title?: string | undefined;
}

/**
 * Returns color coding for conduit hydraulic flow capacity utilization.
 */
export function getCapacityColor(capacityFraction?: number): string {
  if (capacityFraction === undefined) return "#38bdf8"; // Standard Blue
  if (capacityFraction >= 1.0) return "#ef4444"; // Surcharged / Overflow Red
  if (capacityFraction >= 0.8) return "#f59e0b"; // Near Capacity Amber
  if (capacityFraction >= 0.5) return "#10b981"; // Normal Flow Green
  return "#06b6d4"; // Low Flow Cyan
}

/**
 * Builds an interactive AntV X6 graph model for an EPA-SWMM drainage network.
 */
export function buildSwmmDiagram(model: SwmmModelLike): SwmmDiagramGraph {
  const cells: SwmmDiagramCell[] = [];
  const junctionsList: SwmmJunctionLike[] = Array.isArray(model.junctions)
    ? model.junctions
    : Array.from(model.junctions.values());
  const outfallsList: SwmmOutfallLike[] = Array.isArray(model.outfalls)
    ? model.outfalls
    : Array.from(model.outfalls.values());
  const conduitsList: SwmmConduitLike[] = Array.isArray(model.conduits)
    ? model.conduits
    : Array.from(model.conduits.values());

  const nodePositions = new Map<string, { x: number; y: number }>();

  const allNodesHaveCoords =
    junctionsList.every((j) => j.x !== undefined && j.y !== undefined) &&
    outfallsList.every((o) => o.x !== undefined && o.y !== undefined);

  if (!allNodesHaveCoords) {
    // Compute topological gravity drainage DAG layout from upstream inlets to downstream outfalls
    const allNodeIds = new Set<string>();
    for (const j of junctionsList) allNodeIds.add(j.id);
    for (const o of outfallsList) allNodeIds.add(o.id);

    const downstream = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const id of allNodeIds) {
      downstream.set(id, []);
      inDegree.set(id, 0);
    }

    for (const c of conduitsList) {
      const from = c.fromNode ?? c.inletNode ?? "";
      const to = c.toNode ?? c.outletNode ?? "";
      if (allNodeIds.has(from) && allNodeIds.has(to)) {
        downstream.get(from)!.push(to);
        inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
      }
    }

    // Topological ranks
    const rankMap = new Map<string, number>();
    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        rankMap.set(id, 0);
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currRank = rankMap.get(curr)!;
      for (const next of downstream.get(curr) || []) {
        rankMap.set(next, Math.max(rankMap.get(next) ?? 0, currRank + 1));
        const remDeg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, remDeg);
        if (remDeg === 0) {
          queue.push(next);
        }
      }
    }

    let maxRank = 0;
    for (const r of rankMap.values()) {
      if (r > maxRank) maxRank = r;
    }
    for (const id of allNodeIds) {
      if (!rankMap.has(id)) {
        rankMap.set(id, maxRank + 1);
      }
    }

    const rankGroups = new Map<number, string[]>();
    for (const [id, r] of rankMap.entries()) {
      if (!rankGroups.has(r)) rankGroups.set(r, []);
      rankGroups.get(r)!.push(id);
    }

    const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b);
    for (const r of sortedRanks) {
      const group = rankGroups.get(r)!;
      const rankX = 100 + r * 180;
      group.forEach((id, idx) => {
        const nodeY = 120 + idx * 110;
        nodePositions.set(id, { x: rankX, y: nodeY });
      });
    }
  } else {
    for (const j of junctionsList) {
      nodePositions.set(j.id, { x: j.x!, y: j.y! });
    }
    for (const o of outfallsList) {
      nodePositions.set(o.id, { x: o.x!, y: o.y! });
    }
  }

  for (const j of junctionsList) {
    const pos = nodePositions.get(j.id) ?? { x: 100, y: 150 };

    cells.push({
      id: `junction_${j.id}`,
      shape: "circle",
      x: pos.x - 15,
      y: pos.y - 15,
      width: 30,
      height: 30,
      label: j.id,
      attrs: {
        body: {
          fill: "#0f172a",
          stroke: "#38bdf8",
          strokeWidth: 2,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 9,
          fontWeight: "600",
        },
      },
      data: {
        nodeType: "JUNCTION",
        elevation: j.elevation,
        maxDepth: j.maxDepth,
      },
    });
  }

  for (const o of outfallsList) {
    const pos = nodePositions.get(o.id) ?? { x: 280, y: 150 };

    cells.push({
      id: `outfall_${o.id}`,
      shape: "polygon",
      x: pos.x - 18,
      y: pos.y - 18,
      width: 36,
      height: 36,
      label: o.id,
      attrs: {
        body: {
          fill: "#1e1b4b",
          stroke: "#818cf8",
          strokeWidth: 2,
        },
        label: {
          fill: "#a5b4fc",
          fontSize: 9,
          fontWeight: "700",
        },
      },
      data: {
        nodeType: "OUTFALL",
        elevation: o.elevation,
        outfallType: o.type,
      },
    });
  }

  for (const c of conduitsList) {
    const fromId = c.fromNode ?? c.inletNode ?? "";
    const toId = c.toNode ?? c.outletNode ?? "";
    const fromPos = nodePositions.get(fromId);
    const toPos = nodePositions.get(toId);
    if (!fromPos || !toPos) continue;

    const strokeColor = getCapacityColor(c.capacityFraction);

    cells.push({
      id: `conduit_${c.id}`,
      shape: "edge",
      source: { cell: junctionsList.some((j) => j.id === fromId) ? `junction_${fromId}` : `outfall_${fromId}` },
      target: { cell: junctionsList.some((j) => j.id === toId) ? `junction_${toId}` : `outfall_${toId}` },
      label: `${c.id}\n${c.length}m`,
      attrs: {
        line: {
          stroke: strokeColor,
          strokeWidth: Math.max(2, Math.min(6, (c.diameter ?? 0.5) * 4)),
          targetMarker: {
            name: "classic",
            width: 8,
            height: 6,
          },
        },
        label: {
          fill: "#94a3b8",
          fontSize: 9,
        },
      },
      data: {
        conduitId: c.id,
        length: c.length,
        roughness: c.roughness,
        flowRate: c.flowRate,
        capacityFraction: c.capacityFraction,
      },
    });
  }

  return {
    title: model.title ?? "SWMM Drainage Network",
    cells,
  };
}

/**
 * Emits a standalone SVG plan view of a SWMM conveyance network.
 */
export function renderSwmmSvg(model: SwmmModelLike, options?: SwmmRenderOptions): string {
  const diag = buildSwmmDiagram(model);
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const cellMap = new Map<string, SwmmDiagramCell>();
  for (const c of diag.cells) {
    cellMap.set(c.id, c);
    if (c.x !== undefined && c.y !== undefined) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + (c.width ?? 30));
      maxY = Math.max(maxY, c.y + (c.height ?? 30));
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const pad = 60;
  const vbX = Math.floor(minX - pad);
  const vbY = Math.floor(minY - pad);
  const vbW = Math.max(options?.width ?? 0, Math.ceil(maxX - minX + 2 * pad));
  const vbH = Math.max(options?.height ?? 0, Math.ceil(maxY - minY + 2 * pad));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <marker id="conduit-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;

  // Title Banner
  svg += `  <text x="${vbX + pad}" y="${vbY + 30}" fill="${textColor}" font-size="16" font-weight="700">${diag.title}</text>\n`;
  svg += `  <text x="${vbX + pad}" y="${vbY + 46}" fill="${subTextColor}" font-size="10">ModelScript 2D Conveyance Network</text>\n`;

  // 1. Conduits Layer
  svg += `  <g id="conduits-layer">\n`;
  for (const c of diag.cells) {
    if (c.shape === "edge" && c.source && c.target) {
      const srcId = typeof c.source === "object" && "cell" in c.source ? c.source.cell : null;
      const tgtId = typeof c.target === "object" && "cell" in c.target ? c.target.cell : null;
      if (!srcId || !tgtId) continue;

      const src = cellMap.get(srcId);
      const tgt = cellMap.get(tgtId);
      if (!src || !tgt || src.x === undefined || tgt.x === undefined) continue;

      const x1 = src.x + (src.width ?? 30) / 2;
      const y1 = src.y! + (src.height ?? 30) / 2;
      const x2 = tgt.x + (tgt.width ?? 30) / 2;
      const y2 = tgt.y! + (tgt.height ?? 30) / 2;

      const color = (c.attrs?.["line"]?.["stroke"] as string | undefined) ?? "#38bdf8";
      const strokeWidth = (c.attrs?.["line"]?.["strokeWidth"] as number | undefined) ?? 3;

      svg += `    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" marker-end="url(#conduit-arrow)">\n`;
      svg += `      <title>Conduit: ${c.label ?? ""}</title>\n`;
      svg += `    </line>\n`;

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      svg += `    <text x="${midX}" y="${midY - 6}" fill="${subTextColor}" font-size="9" text-anchor="middle">${c.data?.["conduitId"] ?? ""}</text>\n`;
    }
  }
  svg += `  </g>\n`;

  // 2. Nodes Layer
  svg += `  <g id="nodes-layer">\n`;
  for (const c of diag.cells) {
    if (c.shape === "circle" && c.x !== undefined && c.y !== undefined) {
      const r = (c.width ?? 30) / 2;
      const cx = c.x + r;
      const cy = c.y + r;
      svg += `    <g>\n`;
      svg += `      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${isDark ? "#0f172a" : "#ffffff"}" stroke="#38bdf8" stroke-width="2.5" />\n`;
      svg += `      <circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-dasharray="2,2" />\n`;
      svg += `      <text x="${cx}" y="${cy + r + 12}" fill="${textColor}" font-size="10" font-weight="600" text-anchor="middle">${c.label ?? ""}</text>\n`;
      svg += `      <title>Junction: ${c.label} (Elev: ${c.data?.["elevation"]}m)</title>\n`;
      svg += `    </g>\n`;
    } else if (c.shape === "polygon" && c.x !== undefined && c.y !== undefined) {
      const w = c.width ?? 36;
      const h = c.height ?? 36;
      const cx = c.x + w / 2;
      const cy = c.y + h / 2;
      // Triangular outfall flap
      const pts = `${c.x},${c.y} ${c.x + w},${cy} ${c.x},${c.y + h}`;
      svg += `    <g>\n`;
      svg += `      <polygon points="${pts}" fill="${isDark ? "#312e81" : "#c7d2fe"}" stroke="#818cf8" stroke-width="2" />\n`;
      svg += `      <text x="${cx}" y="${c.y + h + 12}" fill="#a5b4fc" font-size="10" font-weight="700" text-anchor="middle">${c.label ?? ""}</text>\n`;
      svg += `      <title>Outfall: ${c.label} (${c.data?.["outfallType"]})</title>\n`;
      svg += `    </g>\n`;
    }
  }
  svg += `  </g>\n`;

  // 3. Hydraulic Capacity Legend
  const legX = vbX + pad;
  const legY = vbY + vbH - 30;
  svg += `  <g id="swmm-legend" transform="translate(${legX}, ${legY})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Capacity (Q/Q_full):</text>\n`;
  svg += `    <circle cx="120" cy="-4" r="5" fill="#10b981" />\n`;
  svg += `    <text x="130" y="0" fill="${subTextColor}" font-size="9">&lt; 80%</text>\n`;
  svg += `    <circle cx="175" cy="-4" r="5" fill="#f59e0b" />\n`;
  svg += `    <text x="185" y="0" fill="${subTextColor}" font-size="9">80-100%</text>\n`;
  svg += `    <circle cx="240" cy="-4" r="5" fill="#ef4444" />\n`;
  svg += `    <text x="250" y="0" fill="${subTextColor}" font-size="9">&gt; 100% (Surcharge)</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}

/**
 * Emits a longitudinal hydraulic elevation profile SVG along a connected series of node IDs.
 */
export function renderSwmmProfileSvg(
  model: SwmmModelLike,
  pathNodeIds: string[],
  options?: SwmmProfileOptions,
): string {
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const juncMap = new Map<string, SwmmJunctionLike>();
  const outfallMap = new Map<string, SwmmOutfallLike>();
  const conduitMap = new Map<string, SwmmConduitLike>();

  if (Array.isArray(model.junctions)) model.junctions.forEach((j) => juncMap.set(j.id, j));
  else model.junctions.forEach((j, k) => juncMap.set(k, j));

  if (Array.isArray(model.outfalls)) model.outfalls.forEach((o) => outfallMap.set(o.id, o));
  else model.outfalls.forEach((o, k) => outfallMap.set(k, o));

  if (Array.isArray(model.conduits)) model.conduits.forEach((c) => conduitMap.set(`${c.fromNode}_${c.toNode}`, c));
  else model.conduits.forEach((c) => conduitMap.set(`${c.fromNode}_${c.toNode}`, c));

  const profilePoints: {
    nodeId: string;
    chainage: number;
    invertElev: number;
    rimElev: number;
    hglElev: number;
  }[] = [];

  let curChainage = 0;
  for (let i = 0; i < pathNodeIds.length; i++) {
    const id = pathNodeIds[i]!;
    const j = juncMap.get(id);
    const o = outfallMap.get(id);

    const invert = j ? j.elevation : o ? o.elevation : 100;
    const rim = j ? j.elevation + j.maxDepth : invert + 2;
    const hgl = j ? invert + (j.initDepth ?? j.maxDepth * 0.4) : invert + 0.5;

    profilePoints.push({
      nodeId: id,
      chainage: curChainage,
      invertElev: invert,
      rimElev: rim,
      hglElev: hgl,
    });

    if (i < pathNodeIds.length - 1) {
      const nextId = pathNodeIds[i + 1]!;
      const c = conduitMap.get(`${id}_${nextId}`) ?? conduitMap.get(`${nextId}_${id}`);
      curChainage += c ? c.length : 100;
    }
  }

  const width = options?.width ?? 900;
  const height = options?.height ?? 400;
  const margin = { top: 60, right: 60, bottom: 60, left: 70 };

  const totalLength = Math.max(1, curChainage);
  const minElev = Math.min(...profilePoints.map((p) => p.invertElev)) - 2;
  const maxElev = Math.max(...profilePoints.map((p) => p.rimElev)) + 3;
  const elevRange = Math.max(1, maxElev - minElev);

  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const mapX = (chainage: number) => margin.left + (chainage / totalLength) * plotW;
  const mapY = (elev: number) => margin.top + plotH - ((elev - minElev) / elevRange) * plotH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;

  // Title
  svg += `  <text x="${margin.left}" y="32" fill="${textColor}" font-size="16" font-weight="700">${options?.title ?? model.title ?? "Longitudinal Hydraulic Profile"}</text>\n`;
  svg += `  <text x="${margin.left}" y="48" fill="${subTextColor}" font-size="10">Ground Surface, Conduit Invert, and Hydraulic Grade Line (HGL)</text>\n`;

  // Draw Ground Surface Line
  const groundPts = profilePoints.map((p) => `${mapX(p.chainage)},${mapY(p.rimElev)}`).join(" ");
  svg += `  <polyline points="${groundPts}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="4,2" />\n`;

  // Draw Invert Line
  const invertPts = profilePoints.map((p) => `${mapX(p.chainage)},${mapY(p.invertElev)}`).join(" ");
  svg += `  <polyline points="${invertPts}" fill="none" stroke="#475569" stroke-width="3" />\n`;

  // Draw HGL Water Surface Line
  const hglPts = profilePoints.map((p) => `${mapX(p.chainage)},${mapY(p.hglElev)}`).join(" ");
  svg += `  <polyline points="${hglPts}" fill="none" stroke="#0284c7" stroke-width="2.5" />\n`;

  // Draw Vertical Manhole Shafts
  for (const p of profilePoints) {
    const x = mapX(p.chainage);
    const yTop = mapY(p.rimElev);
    const yBot = mapY(p.invertElev);

    svg += `  <line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="#38bdf8" stroke-width="1.5" />\n`;
    svg += `  <circle cx="${x}" cy="${yTop}" r="4" fill="#38bdf8" />\n`;
    svg += `  <circle cx="${x}" cy="${yBot}" r="4" fill="#0284c7" />\n`;
    svg += `  <text x="${x}" y="${yTop - 8}" fill="${textColor}" font-size="10" font-weight="600" text-anchor="middle">${p.nodeId}</text>\n`;
    svg += `  <text x="${x}" y="${height - 20}" fill="${subTextColor}" font-size="9" text-anchor="middle">${p.chainage.toFixed(0)}m</text>\n`;
  }

  // Profile Legend
  const legY = height - 20;
  svg += `  <g id="prof-legend" transform="translate(${margin.left}, ${legY})">\n`;
  svg += `    <line x1="0" y1="-4" x2="20" y2="-4" stroke="#64748b" stroke-width="2" stroke-dasharray="4,2" />\n`;
  svg += `    <text x="25" y="0" fill="${subTextColor}" font-size="9">Ground Rim</text>\n`;
  svg += `    <line x1="90" y1="-4" x2="110" y2="-4" stroke="#0284c7" stroke-width="2.5" />\n`;
  svg += `    <text x="115" y="0" fill="${subTextColor}" font-size="9">HGL Water Surface</text>\n`;
  svg += `    <line x1="210" y1="-4" x2="230" y2="-4" stroke="#475569" stroke-width="3" />\n`;
  svg += `    <text x="235" y="0" fill="${subTextColor}" font-size="9">Conduit Invert</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
