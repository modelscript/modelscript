// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Aspen Plus Chemical Process Flow Diagram (PFD / P&ID) Builder.
 *
 * Translates Aspen simulation flowsheets into AntV X6 graph structures and standalone SVGs:
 * 1. Unit operation blocks: RadFrac columns, flash drums, heat exchangers, pumps, reactors, mixers.
 * 2. Process stream lines with phase color coding (vapor, liquid, slurry) and thermodynamic state flags.
 * 3. Topological feed-to-product layout with recycle loop routing.
 */

import { computeOrthogonalRoute } from "./port-router.js";

export interface AspenComponentLike {
  id?: string | undefined;
  name?: string | undefined;
  formula?: string | undefined;
}

export interface AspenBlockLike {
  id?: string | undefined;
  name?: string | undefined;
  type: string;
  inStreams?: string[] | undefined;
  outStreams?: string[] | undefined;
  properties?: Record<string, unknown> | undefined;
}

export interface AspenStreamLike {
  id?: string | undefined;
  name?: string | undefined;
  fromBlock?: string | undefined;
  toBlock?: string | undefined;
  temperature?: number | undefined; // K or C
  pressure?: number | undefined; // bar or Pa
  flowRate?: number | undefined; // kg/h or kmol/h
  moleFlow?: number | undefined;
  massFlow?: number | undefined;
  phase?: "vapor" | "liquid" | "mixed" | undefined;
}

export interface AspenModelLike {
  title?: string | undefined;
  components?: Map<string, AspenComponentLike> | AspenComponentLike[] | undefined;
  blocks: Map<string, AspenBlockLike> | AspenBlockLike[];
  streams: Map<string, AspenStreamLike> | AspenStreamLike[];
  flowsheet?: { blockId: string; inlets?: string[]; outlets?: string[] }[] | undefined;
}

export interface AspenDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface AspenDiagramGraph {
  title: string;
  cells: AspenDiagramCell[];
}

export interface AspenRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
  showStreamProperties?: boolean | undefined;
}

/**
 * Returns color coding for process streams based on thermodynamic state.
 */
export function getStreamColor(phase?: "vapor" | "liquid" | "mixed"): string {
  switch (phase) {
    case "vapor":
      return "#f59e0b"; // Amber / Gas
    case "liquid":
      return "#06b6d4"; // Cyan / Liquid
    case "mixed":
      return "#8b5cf6"; // Purple / 2-Phase
    default:
      return "#38bdf8"; // Standard Blue
  }
}

/**
 * Builds an interactive AntV X6 graph model for an Aspen flowsheet.
 */
export function buildAspenDiagram(model: AspenModelLike): AspenDiagramGraph {
  const cells: AspenDiagramCell[] = [];
  const blocksList: AspenBlockLike[] = Array.isArray(model.blocks) ? model.blocks : Array.from(model.blocks.values());
  const streamsList: AspenStreamLike[] = Array.isArray(model.streams)
    ? model.streams
    : Array.from(model.streams.values());

  const blockMap = new Map<string, AspenBlockLike>();
  for (const b of blocksList) {
    const bName = b.name ?? b.id ?? "BLOCK";
    blockMap.set(bName, b);
  }

  // Map flowsheet connections if present
  const fromMap = new Map<string, string>();
  const toMap = new Map<string, string>();
  if (model.flowsheet) {
    for (const entry of model.flowsheet) {
      for (const inS of entry.inlets ?? []) {
        toMap.set(inS, entry.blockId);
      }
      for (const outS of entry.outlets ?? []) {
        fromMap.set(outS, entry.blockId);
      }
    }
  }

  // 1. Arrange blocks using Sugiyama DAG layer assignment (Topological Ranking)
  const blockInDegree = new Map<string, number>();
  const blockSuccessors = new Map<string, string[]>();
  for (const b of blocksList) {
    const bName = b.name ?? b.id ?? "";
    blockInDegree.set(bName, 0);
    blockSuccessors.set(bName, []);
  }

  for (const s of streamsList) {
    const sName = s.name ?? s.id ?? "";
    const fromB = s.fromBlock ?? fromMap.get(sName);
    const toB = s.toBlock ?? toMap.get(sName);
    if (fromB && toB && fromB !== toB && blockSuccessors.has(fromB) && blockInDegree.has(toB)) {
      blockSuccessors.get(fromB)!.push(toB);
      blockInDegree.set(toB, (blockInDegree.get(toB) ?? 0) + 1);
    }
  }

  // Identify external feed roots (blocks receiving external feeds or zero internal in-degree)
  const feedRoots = new Set<string>();
  for (const s of streamsList) {
    const sName = s.name ?? s.id ?? "";
    const fromB = s.fromBlock ?? fromMap.get(sName);
    const toB = s.toBlock ?? toMap.get(sName);
    if (!fromB && toB) {
      feedRoots.add(toB);
    }
  }
  for (const b of blocksList) {
    const bName = b.name ?? b.id ?? "";
    if ((blockInDegree.get(bName) ?? 0) === 0) {
      feedRoots.add(bName);
    }
  }

  // Detect cycle back-edges using 3-color DFS to break recycle loops
  const visited = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  const forwardSuccessors = new Map<string, string[]>();
  for (const b of blocksList) {
    const bName = b.name ?? b.id ?? "";
    forwardSuccessors.set(bName, []);
  }

  function dfsFilterCycles(u: string) {
    visited.set(u, 1);
    for (const v of blockSuccessors.get(u) ?? []) {
      if (visited.get(v) === 1) {
        // Back-edge (recycle loop) detected! Exclude from forward layering
        continue;
      }
      forwardSuccessors.get(u)!.push(v);
      if (!visited.has(v) || visited.get(v) === 0) {
        dfsFilterCycles(v);
      }
    }
    visited.set(u, 2);
  }

  // Traverse feed roots first so recycles are accurately detected as back-edges
  for (const root of feedRoots) {
    if (!visited.has(root) || visited.get(root) === 0) {
      dfsFilterCycles(root);
    }
  }
  for (const b of blocksList) {
    const bName = b.name ?? b.id ?? "";
    if (!visited.has(bName) || visited.get(bName) === 0) {
      dfsFilterCycles(bName);
    }
  }

  // Assign ranks using longest path DAG layering
  const blockRank = new Map<string, number>();
  for (const b of blocksList) {
    const bName = b.name ?? b.id ?? "";
    blockRank.set(bName, 0);
  }

  const rankQueue: string[] = Array.from(feedRoots);
  if (rankQueue.length === 0 && blocksList.length > 0) {
    rankQueue.push(blocksList[0]!.name ?? blocksList[0]!.id ?? "");
  }

  const processedRank = new Set<string>();
  while (rankQueue.length > 0) {
    const u = rankQueue.shift()!;
    processedRank.add(u);
    const uRank = blockRank.get(u) ?? 0;
    for (const v of forwardSuccessors.get(u) ?? []) {
      const currentVRank = blockRank.get(v) ?? 0;
      if (uRank + 1 > currentVRank) {
        blockRank.set(v, uRank + 1);
      }
      if (!processedRank.has(v) && !rankQueue.includes(v)) {
        rankQueue.push(v);
      }
    }
  }

  // Group blocks by rank
  const rankGroups = new Map<number, string[]>();
  for (const b of blocksList) {
    const bName = b.name ?? b.id ?? "";
    const r = blockRank.get(bName) ?? 0;
    if (!rankGroups.has(r)) rankGroups.set(r, []);
    rankGroups.get(r)!.push(bName);
  }

  const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b);
  const blockCoords = new Map<string, { x: number; y: number; w: number; h: number }>();
  let currentX = 120;
  const rankSpacingX = 140;
  const centerY = 180;

  for (const r of sortedRanks) {
    const bNames = rankGroups.get(r)!;
    const totalBlocks = bNames.length;
    let maxColW = 80;

    for (let idx = 0; idx < totalBlocks; idx++) {
      const bName = bNames[idx]!;
      const b = blocksList.find((item) => (item.name ?? item.id) === bName)!;
      const typeUpper = b.type.toUpperCase();

      let w = 80;
      let h = 80;

      if (typeUpper.includes("RADFRAC") || typeUpper.includes("COLUMN") || typeUpper.includes("DIST")) {
        w = 60;
        h = 140;
      } else if (typeUpper.includes("FLASH") || typeUpper.includes("SEP")) {
        w = 60;
        h = 90;
      } else if (typeUpper.includes("HEAT") || typeUpper.includes("COOL") || typeUpper.includes("HX")) {
        w = 70;
        h = 70;
      } else if (typeUpper.includes("PUMP") || typeUpper.includes("COMP")) {
        w = 50;
        h = 50;
      } else if (typeUpper.includes("MIX") || typeUpper.includes("SPLIT")) {
        w = 40;
        h = 60;
      }

      maxColW = Math.max(maxColW, w);
      const yOffset = (idx - (totalBlocks - 1) / 2) * 110;
      const y = centerY + yOffset - h / 2;
      blockCoords.set(bName, { x: currentX, y, w, h });

      cells.push({
        id: `block_${bName}`,
        shape: "rect",
        x: currentX,
        y,
        width: w,
        height: h,
        label: `${bName}\n[${b.type}]`,
        attrs: {
          body: {
            fill: "#0f172a",
            stroke: "#38bdf8",
            strokeWidth: 2,
            rx: 4,
            ry: 4,
          },
          label: {
            fill: "#f8fafc",
            fontSize: 10,
            fontWeight: "600",
          },
        },
        data: {
          blockName: bName,
          blockType: b.type,
          inStreams: b.inStreams,
          outStreams: b.outStreams,
          rank: r,
        },
      });
    }

    currentX += maxColW + rankSpacingX;
  }

  // 2. Add Feed / Product boundary nodes for disconnected stream terminals
  const processedStreams = new Set<string>();

  for (const s of streamsList) {
    const sName = s.name ?? s.id ?? "STREAM";
    if (processedStreams.has(sName)) continue;
    processedStreams.add(sName);

    const fromBlockId = s.fromBlock ?? fromMap.get(sName);
    const toBlockId = s.toBlock ?? toMap.get(sName);
    const fromBlock = fromBlockId ? blockCoords.get(fromBlockId) : undefined;
    const toBlock = toBlockId ? blockCoords.get(toBlockId) : undefined;
    const streamColor = getStreamColor(s.phase);

    let srcCellId: string;
    let tgtCellId: string;

    // Source terminal
    if (fromBlock && fromBlockId) {
      srcCellId = `block_${fromBlockId}`;
    } else {
      const feedNodeId = `feed_${sName}`;
      const fx = (toBlock?.x ?? currentX) - 80;
      const fy = (toBlock?.y ?? centerY) + 20;
      cells.push({
        id: feedNodeId,
        shape: "circle",
        x: fx,
        y: fy,
        width: 24,
        height: 24,
        label: sName,
        attrs: {
          body: { fill: "#1e293b", stroke: streamColor, strokeWidth: 1.5 },
          label: { fill: streamColor, fontSize: 8 },
        },
      });
      srcCellId = feedNodeId;
    }

    // Target terminal
    if (toBlock && toBlockId) {
      tgtCellId = `block_${toBlockId}`;
    } else {
      const prodNodeId = `prod_${sName}`;
      const px = (fromBlock?.x ?? currentX) + (fromBlock?.w ?? 80) + 60;
      const py = (fromBlock?.y ?? centerY) + 20;
      cells.push({
        id: prodNodeId,
        shape: "circle",
        x: px,
        y: py,
        width: 24,
        height: 24,
        label: sName,
        attrs: {
          body: { fill: "#1e293b", stroke: streamColor, strokeWidth: 1.5 },
          label: { fill: streamColor, fontSize: 8 },
        },
      });
      tgtCellId = prodNodeId;
    }

    // Stream edge
    cells.push({
      id: `stream_${s.name}`,
      shape: "edge",
      source: { cell: srcCellId },
      target: { cell: tgtCellId },
      label: s.name,
      attrs: {
        line: {
          stroke: streamColor,
          strokeWidth: 2,
          targetMarker: {
            name: "block",
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
        streamName: s.name,
        temperature: s.temperature,
        pressure: s.pressure,
        flowRate: s.flowRate,
      },
    });
  }

  return {
    title: model.title ?? "Aspen Flowsheet",
    cells,
  };
}

/**
 * Emits a high-fidelity standalone SVG process flow diagram for an Aspen model.
 */
export function renderAspenSvg(model: AspenModelLike, options?: AspenRenderOptions): string {
  const diag = buildAspenDiagram(model);
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const cellMap = new Map<string, AspenDiagramCell>();
  for (const c of diag.cells) {
    cellMap.set(c.id, c);
    if (c.x !== undefined && c.y !== undefined) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + (c.width ?? 60));
      maxY = Math.max(maxY, c.y + (c.height ?? 60));
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
  svg += `    <marker id="stream-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `    <filter id="pfd-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feGaussianBlur stdDeviation="3" result="blur" />\n`;
  svg += `      <feComposite in="SourceGraphic" in2="blur" operator="over" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n`;

  svg += `  <style>\n`;
  svg += `    .pfd-block { transition: transform 0.2s ease; cursor: pointer; }\n`;
  svg += `    .pfd-block:hover rect { stroke: #38bdf8 !important; stroke-width: 3px !important; filter: drop-shadow(0 0 8px #38bdf8); }\n`;
  svg += `    .pfd-stream { transition: stroke-width 0.2s ease; cursor: pointer; }\n`;
  svg += `    .pfd-stream:hover { stroke-width: 3.5px !important; filter: drop-shadow(0 0 6px rgba(56,189,248,0.8)); }\n`;
  svg += `    .pfd-text { fill: ${textColor}; font-size: 11px; font-weight: 600; text-anchor: middle; pointer-events: none; }\n`;
  svg += `    .pfd-subtext { fill: ${subTextColor}; font-size: 9px; text-anchor: middle; pointer-events: none; }\n`;
  svg += `  </style>\n`;

  // Title Banner
  svg += `  <text x="${vbX + pad}" y="${vbY + 30}" fill="${textColor}" font-size="16" font-weight="700">${diag.title}</text>\n`;
  svg += `  <text x="${vbX + pad}" y="${vbY + 46}" fill="${subTextColor}" font-size="10">ModelScript Process Flow Diagram (PFD)</text>\n`;

  // 1. Streams Layer
  svg += `  <g id="streams-layer">\n`;
  for (const c of diag.cells) {
    if (c.shape === "edge" && c.source && c.target) {
      const srcId = typeof c.source === "object" && "cell" in c.source ? c.source.cell : null;
      const tgtId = typeof c.target === "object" && "cell" in c.target ? c.target.cell : null;
      if (!srcId || !tgtId) continue;

      const src = cellMap.get(srcId);
      const tgt = cellMap.get(tgtId);
      if (!src || !tgt || src.x === undefined || tgt.x === undefined) continue;

      const x1 = src.x + (src.width ?? 60);
      const y1 = src.y! + (src.height ?? 60) / 2;
      const x2 = tgt.x;
      const y2 = tgt.y! + (tgt.height ?? 60) / 2;

      const color = (c.attrs?.["line"]?.["stroke"] as string | undefined) ?? "#38bdf8";

      // Compute orthogonal A* route around intermediate unit op obstacles
      const obstacles = diag.cells
        .filter((node) => node.id !== srcId && node.id !== tgtId && node.x !== undefined && node.y !== undefined)
        .map((node) => ({
          x: node.x!,
          y: node.y!,
          width: node.width ?? 80,
          height: node.height ?? 80,
        }));

      const waypoints = computeOrthogonalRoute({ x: x1, y: y1 }, { x: x2, y: y2 }, obstacles);
      const points = [{ x: x1, y: y1 }, ...waypoints, { x: x2, y: y2 }];
      const d = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

      svg += `    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" class="pfd-stream" marker-end="url(#stream-arrow)">\n`;
      svg += `      <title>Stream: ${c.label ?? ""}</title>\n`;
      svg += `    </path>\n`;

      if (c.label) {
        const midIdx = Math.floor(points.length / 2);
        const lp = points[midIdx]!;
        svg += `    <text x="${lp.x.toFixed(1)}" y="${(lp.y - 4).toFixed(1)}" class="pfd-subtext">${c.label}</text>\n`;
      }
    }
  }
  svg += `  </g>\n`;

  // 2. Unit Operations Layer
  svg += `  <g id="blocks-layer">\n`;
  for (const c of diag.cells) {
    if (c.shape === "rect" && c.x !== undefined && c.y !== undefined) {
      const w = c.width ?? 80;
      const h = c.height ?? 80;
      const cx = c.x + w / 2;
      const cy = c.y + h / 2;

      svg += `    <g class="pfd-block">\n`;
      svg += `      <rect x="${c.x}" y="${c.y}" width="${w}" height="${h}" rx="6" ry="6" fill="${isDark ? "#1e293b" : "#ffffff"}" stroke="#38bdf8" stroke-width="2" />\n`;

      // Draw inner column trays if RadFrac
      const typeStr = String(c.data?.["blockType"] ?? "").toUpperCase();
      if (typeStr.includes("RADFRAC") || typeStr.includes("COLUMN")) {
        const trayCount = 4;
        const traySpacing = (h - 30) / (trayCount + 1);
        for (let t = 1; t <= trayCount; t++) {
          const ty = c.y + 15 + t * traySpacing;
          svg += `      <line x1="${c.x + 8}" y1="${ty}" x2="${c.x + w - 8}" y2="${ty}" stroke="#475569" stroke-width="1.5" stroke-dasharray="2,2" />\n`;
        }
      }

      svg += `      <text x="${cx}" y="${cy - 4}" class="pfd-text">${c.data?.["blockName"] ?? c.label}</text>\n`;
      svg += `      <text x="${cx}" y="${cy + 12}" class="pfd-subtext">${typeStr}</text>\n`;
      svg += `      <title>Unit Op: ${c.data?.["blockName"] ?? ""} (${typeStr})</title>\n`;
      svg += `    </g>\n`;
    } else if (c.shape === "circle" && c.x !== undefined && c.y !== undefined) {
      const r = (c.width ?? 24) / 2;
      const cx = c.x + r;
      const cy = c.y + r;
      const stroke = (c.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#38bdf8";

      svg += `    <g>\n`;
      svg += `      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${isDark ? "#0f172a" : "#e2e8f0"}" stroke="${stroke}" stroke-width="1.5" />\n`;
      svg += `      <text x="${cx}" y="${cy + 3}" class="pfd-subtext" font-size="8">${c.label ?? ""}</text>\n`;
      svg += `    </g>\n`;
    }
  }
  svg += `  </g>\n`;

  // 3. Legend Layer
  const legX = vbX + pad;
  const legY = vbY + vbH - 35;
  svg += `  <g id="legend" transform="translate(${legX}, ${legY})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Phases:</text>\n`;
  svg += `    <line x1="45" y1="-3" x2="65" y2="-3" stroke="#f59e0b" stroke-width="2.5" />\n`;
  svg += `    <text x="72" y="0" fill="${subTextColor}" font-size="9">Vapor</text>\n`;
  svg += `    <line x1="115" y1="-3" x2="135" y2="-3" stroke="#06b6d4" stroke-width="2.5" />\n`;
  svg += `    <text x="142" y="0" fill="${subTextColor}" font-size="9">Liquid</text>\n`;
  svg += `    <line x1="185" y1="-3" x2="205" y2="-3" stroke="#8b5cf6" stroke-width="2.5" />\n`;
  svg += `    <text x="212" y="0" fill="${subTextColor}" font-size="9">2-Phase</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
