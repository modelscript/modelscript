// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — OLGA Flow Assurance & Multiphase Diagram Builder.
 *
 * Provides dual-view rendering for OLGA models:
 * 1. Topological P&ID Schematic (Wells, Flowpaths, Valves, Chokes, Separators)
 * 2. Spatial Elevation Bathymetry Profile Z(X) with dynamic liquid holdup (alpha_L)
 *    heatmaps and hydrate equilibrium temperature curves.
 */

export interface OlgaPipeLike {
  label: string;
  length: number;
  diameter: number;
  elevation: number;
  roughness?: number | undefined;
  discretization?: number | undefined;
}

export interface OlgaValveLike {
  name: string;
  position: number;
  diameter: number;
  opening: number;
  cd?: number | undefined;
}

export interface OlgaNodeLike {
  name: string;
  type: string;
  flowpath: string;
  boundaryPosition: number;
  pressure?: number | undefined;
  temperature?: number | undefined;
  massRate?: number | undefined;
}

export interface OlgaPigLike {
  name: string;
  diameter?: number | undefined;
  mass?: number | undefined;
  launchTime?: number | undefined;
  wallFriction?: number | undefined;
}

export interface OlgaActiveSlugLike {
  id: number;
  frontPosition: number;
  tailPosition: number;
  length: number;
  holdup: number;
  velocity: number;
}

export interface OlgaActivePigLike {
  name: string;
  position: number;
  velocity: number;
  differentialPressure: number;
  sweptLiquidVolume: number;
  isStuck: boolean;
}

export interface OlgaFlowpathLike {
  name: string;
  pipes: OlgaPipeLike[];
  valves: OlgaValveLike[];
  pigs?: OlgaPigLike[] | undefined;
}

export interface OlgaModelLike {
  title: string;
  flowpaths: OlgaFlowpathLike[];
  nodes: OlgaNodeLike[];
}

export interface OlgaSpatialSnapshotLike {
  time: number;
  x: number[];
  pressure: number[];
  temperature: number[];
  liquidHoldup: number[];
  flowRegimes?: string[] | undefined;
  activeSlugs?: OlgaActiveSlugLike[] | undefined;
  pigs?: OlgaActivePigLike[] | undefined;
}

export interface OlgaSimulationResultLike {
  times: number[];
  profiles: OlgaSpatialSnapshotLike[];
  trends?:
    | {
        peakLiquidSurgeVolume?: number | undefined;
        meanSlugLength?: number[] | undefined;
        slugFrequency?: number[] | undefined;
        activeSlugsCount?: number[] | undefined;
        pigPosition?: number[] | undefined;
        pigVelocity?: number[] | undefined;
      }
    | undefined;
}

export interface OlgaDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface OlgaDiagramGraph {
  title: string;
  cells: OlgaDiagramCell[];
}

/**
 * Builds an interactive AntV X6 graph model for the OLGA topological schematic.
 */
export function buildOlgaDiagram(model: OlgaModelLike): OlgaDiagramGraph {
  const cells: OlgaDiagramCell[] = [];
  const flowpath = model.flowpaths[0];

  let curX = 60;
  const baseY = 160;

  // 1. Inlet Wellhead node
  const wellId = "node_wellhead";
  cells.push({
    id: wellId,
    shape: "rect",
    x: curX,
    y: baseY - 15,
    width: 100,
    height: 44,
    label: "SUBSEA WELL\nP: 180 bar",
    attrs: {
      body: { rx: 6, fill: "#1e293b", stroke: "#06b6d4", strokeWidth: 2.5 },
      label: { fill: "#f8fafc", fontSize: 10, fontFamily: "Inter, system-ui, sans-serif" },
    },
    data: { kind: "well" },
  });

  let lastNodeId = wellId;
  curX += 140;

  if (flowpath) {
    // 2. Choke or ESDV valve if present near inlet
    for (const [vIdx, valve] of flowpath.valves.entries()) {
      const vId = `valve_${vIdx + 1}`;
      cells.push({
        id: vId,
        shape: "circle",
        x: curX,
        y: baseY - 10,
        width: 34,
        height: 34,
        label: `${valve.name}\n${(valve.opening * 100).toFixed(0)}%`,
        attrs: {
          body: { fill: "#0f172a", stroke: "#f59e0b", strokeWidth: 2 },
          label: { fill: "#f59e0b", fontSize: 8, fontFamily: "Inter, system-ui, sans-serif" },
        },
        data: { kind: "valve", opening: valve.opening },
      });

      // Edge from previous element to valve
      cells.push({
        id: `edge_${lastNodeId}_${vId}`,
        shape: "edge",
        source: { cell: lastNodeId },
        target: { cell: vId },
        attrs: {
          line: { stroke: "#38bdf8", strokeWidth: 3 },
        },
      });

      lastNodeId = vId;
      curX += 80;
    }

    // 3. Pipe sections
    for (const [pIdx, pipe] of flowpath.pipes.entries()) {
      const pId = `pipe_${pIdx + 1}`;
      const isRiser = pipe.elevation > 100;
      const w = 120;
      const yPos = isRiser ? baseY - 80 : baseY;

      cells.push({
        id: pId,
        shape: "rect",
        x: curX,
        y: yPos - 15,
        width: w,
        height: 38,
        label: `${pipe.label}\n${pipe.length}m | D: ${(pipe.diameter * 1000).toFixed(0)}mm`,
        attrs: {
          body: { rx: 4, fill: "#0f172a", stroke: isRiser ? "#ec4899" : "#3b82f6", strokeWidth: 2 },
          label: { fill: "#cbd5e1", fontSize: 9, fontFamily: "Inter, system-ui, sans-serif" },
        },
        data: { kind: "pipe", length: pipe.length, elevation: pipe.elevation },
      });

      cells.push({
        id: `edge_${lastNodeId}_${pId}`,
        shape: "edge",
        source: { cell: lastNodeId },
        target: { cell: pId },
        attrs: {
          line: { stroke: isRiser ? "#ec4899" : "#38bdf8", strokeWidth: 3 },
        },
      });

      lastNodeId = pId;
      curX += w + 40;
    }
  }

  // 4. Outlet Separator / Slug Catcher
  const sepId = "node_separator";
  cells.push({
    id: sepId,
    shape: "rect",
    x: curX,
    y: baseY - 95,
    width: 110,
    height: 50,
    label: "SLUG CATCHER\n& SEPARATOR\nP: 32 bar",
    attrs: {
      body: { rx: 8, fill: "#1e293b", stroke: "#10b981", strokeWidth: 2.5 },
      label: { fill: "#f8fafc", fontSize: 10, fontFamily: "Inter, system-ui, sans-serif" },
    },
    data: { kind: "separator" },
  });

  cells.push({
    id: `edge_${lastNodeId}_${sepId}`,
    shape: "edge",
    source: { cell: lastNodeId },
    target: { cell: sepId },
    attrs: {
      line: { stroke: "#10b981", strokeWidth: 3 },
    },
  });

  return {
    title: model.title || "OLGA Flowline Schematic",
    cells,
  };
}

/**
 * Renders standalone SVG markup for the OLGA topological schematic.
 */
export function renderOlgaSchematicSvg(model: OlgaModelLike): string {
  const diag = buildOlgaDiagram(model);

  let maxX = 800;
  for (const cell of diag.cells) {
    if (cell.x != null && cell.width != null) {
      if (cell.x + cell.width + 40 > maxX) {
        maxX = cell.x + cell.width + 40;
      }
    }
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX} 280" width="100%" height="100%" style="background:#0b0f19;">\n`;
  svg += `  <style>\n`;
  svg += `    .diag-title { font-family: Inter, system-ui, sans-serif; fill: #94a3b8; font-size: 13px; font-weight: 600; }\n`;
  svg += `    .label-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 10px; font-weight: 500; }\n`;
  svg += `    .sub-text { font-family: Inter, system-ui, sans-serif; fill: #94a3b8; font-size: 8.5px; }\n`;
  svg += `  </style>\n`;

  svg += `  <text x="30" y="32" class="diag-title">${model.title} — Flowline Schematic</text>\n`;

  // Draw connecting lines
  for (const cell of diag.cells) {
    if (cell.shape === "edge" && cell.source && cell.target) {
      const srcCell = diag.cells.find((c) => c.id === (cell.source as any).cell);
      const tgtCell = diag.cells.find((c) => c.id === (cell.target as any).cell);
      if (srcCell && tgtCell && srcCell.x != null && srcCell.y != null && tgtCell.x != null && tgtCell.y != null) {
        const x1 = srcCell.x + (srcCell.width ?? 80);
        const y1 = srcCell.y + (srcCell.height ?? 30) / 2;
        const x2 = tgtCell.x;
        const y2 = tgtCell.y + (tgtCell.height ?? 30) / 2;
        const stroke = (cell.attrs?.["line"] as any)?.stroke ?? "#38bdf8";
        svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="3" stroke-linecap="round" />\n`;
      }
    }
  }

  // Draw node boxes & shapes
  for (const cell of diag.cells) {
    if (cell.x != null && cell.y != null) {
      const w = cell.width ?? 90;
      const h = cell.height ?? 34;

      if (cell.shape === "circle") {
        const cx = cell.x + w / 2;
        const cy = cell.y + h / 2;
        svg += `  <circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="#0f172a" stroke="#f59e0b" stroke-width="2" />\n`;
        svg += `  <text x="${cx}" y="${cy + 3}" text-anchor="middle" class="sub-text">CHOKE</text>\n`;
      } else {
        const stroke = (cell.attrs?.["body"] as any)?.stroke ?? "#38bdf8";
        svg += `  <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${stroke}" stroke-width="2" />\n`;
        if (cell.label) {
          const parts = cell.label.split("\n");
          let lY = cell.y + 14;
          for (let i = 0; i < parts.length; i++) {
            const cls = i === 0 ? "label-text" : "sub-text";
            svg += `  <text x="${cell.x + w / 2}" y="${lY}" text-anchor="middle" class="${cls}">${parts[i]}</text>\n`;
            lY += 12;
          }
        }
      }
    }
  }

  svg += `</svg>\n`;
  return svg;
}

/**
 * Evaluates Hydrate Equilibrium Temperature [K] curve across pressure range.
 */
function getHydrateTempK(pressurePa: number): number {
  const pBar = Math.max(5.0, pressurePa / 1.0e5);
  const lnP = Math.log(pBar);
  return 265.85 + 5.25 * lnP - 0.075 * lnP * lnP;
}

/**
 * Maps liquid holdup [0, 1] to a flow assurance color gradient:
 * - Low holdup (< 0.2): Gas-dominated blue (#38bdf8)
 * - Moderate holdup (0.2 - 0.5): Greenish oil (#10b981)
 * - High slug holdup (> 0.5): Dense liquid slug amber/red (#f59e0b / #ef4444)
 */
function getHoldupColor(alphaL: number): string {
  if (alphaL < 0.25) return "#38bdf8";
  if (alphaL < 0.55) return "#10b981";
  if (alphaL < 0.75) return "#f59e0b";
  return "#ef4444";
}

/**
 * Renders the High-Fidelity Flow Assurance Pipeline Elevation Profile Z(X).
 *
 * Displays:
 * - Seabed bathymetry to platform riser trajectory
 * - Liquid holdup (alpha_L) segment color heatmap
 * - Temperature profile vs Hydrate Dissociation curve overlay
 * - Severe slugging trap callouts
 */
export function renderOlgaElevationProfileSvg(
  model: OlgaModelLike,
  simResult?: OlgaSimulationResultLike,
  snapshotIndex = -1,
): string {
  const flowpath = model.flowpaths[0];
  if (!flowpath || flowpath.pipes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="100%" height="100%"><text x="50%" y="50%" fill="#94a3b8" text-anchor="middle">No pipeline flowpaths defined.</text></svg>`;
  }

  // Calculate cumulative length & elevation coordinates
  const pts: { x: number; z: number; label: string }[] = [{ x: 0, z: 0, label: "WELLHEAD" }];
  let cumX = 0;
  let cumZ = 0;

  for (const pipe of flowpath.pipes) {
    cumX += pipe.length;
    cumZ += pipe.elevation;
    pts.push({ x: cumX, z: cumZ, label: pipe.label });
  }

  const maxX = cumX;
  const minZ = Math.min(...pts.map((p) => p.z), -200);
  const maxZ = Math.max(...pts.map((p) => p.z), 50);

  // SVG canvas metrics
  const svgW = 900;
  const svgH = 460;
  const padL = 90;
  const padR = 60;
  const padT = 50;
  const padB = 70;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const mapX = (x: number) => padL + (x / maxX) * plotW;
  const mapZ = (z: number) => padT + ((maxZ - z) / Math.max(1, maxZ - minZ)) * plotH;

  // Retrieve active snapshot if available
  let activeSnapshot: OlgaSpatialSnapshotLike | undefined;
  if (simResult && simResult.profiles.length > 0) {
    const sIdx =
      snapshotIndex >= 0 && snapshotIndex < simResult.profiles.length ? snapshotIndex : simResult.profiles.length - 1;
    activeSnapshot = simResult.profiles[sIdx];
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" style="background:#090d16;">\n`;
  svg += `  <style>\n`;
  svg += `    .axis-label { font-family: Inter, system-ui, sans-serif; fill: #64748b; font-size: 10px; }\n`;
  svg += `    .title-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 14px; font-weight: 600; }\n`;
  svg += `    .grid-line { stroke: #1e293b; stroke-dasharray: 4,4; stroke-width: 1; }\n`;
  svg += `    .legend-text { font-family: Inter, system-ui, sans-serif; fill: #cbd5e1; font-size: 9.5px; }\n`;
  svg += `    .callout-text { font-family: Inter, system-ui, sans-serif; fill: #f59e0b; font-size: 9px; font-weight: 500; }\n`;
  svg += `  </style>\n`;

  // Title
  svg += `  <text x="${padL}" y="32" class="title-text">${model.title} — Pipeline Elevation Bathymetry Z(X)</text>\n`;

  // Axes and Grid
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const xVal = (i / xTicks) * maxX;
    const px = mapX(xVal);
    svg += `  <line x1="${px}" y1="${padT}" x2="${px}" y2="${padT + plotH}" class="grid-line" />\n`;
    svg += `  <text x="${px}" y="${padT + plotH + 20}" text-anchor="middle" class="axis-label">${(xVal / 1000).toFixed(1)} km</text>\n`;
  }

  const zTicks = 5;
  for (let i = 0; i <= zTicks; i++) {
    const zVal = minZ + (i / zTicks) * (maxZ - minZ);
    const py = mapZ(zVal);
    svg += `  <line x1="${padL}" y1="${py}" x2="${padL + plotW}" y2="${py}" class="grid-line" />\n`;
    svg += `  <text x="${padL - 14}" y="${py + 4}" text-anchor="end" class="axis-label">${zVal.toFixed(0)} m</text>\n`;
  }

  // Draw Seabed fill polygon
  const pathD = [
    `M ${mapX(pts[0]!.x)} ${mapZ(pts[0]!.z)}`,
    ...pts.slice(1).map((p) => `L ${mapX(p.x)} ${mapZ(p.z)}`),
    `L ${mapX(pts[pts.length - 1]!.x)} ${padT + plotH}`,
    `L ${mapX(pts[0]!.x)} ${padT + plotH}`,
    "Z",
  ].join(" ");
  svg += `  <path d="${pathD}" fill="#0f172a" fill-opacity="0.45" />\n`;

  // Draw pipeline segments with holdup coloring
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const sx = mapX(p1.x);
    const sy = mapZ(p1.z);
    const ex = mapX(p2.x);
    const ey = mapZ(p2.z);

    let strokeColor = "#38bdf8";
    if (activeSnapshot) {
      // Find average holdup along this segment
      const midX = 0.5 * (p1.x + p2.x);
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let k = 0; k < activeSnapshot.x.length; k++) {
        const diff = Math.abs(activeSnapshot.x[k]! - midX);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = k;
        }
      }
      const al = activeSnapshot.liquidHoldup[closestIdx] ?? 0.25;
      strokeColor = getHoldupColor(al);
    }

    svg += `  <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${strokeColor}" stroke-width="5" stroke-linecap="round" />\n`;
  }

  // Draw nodes & labels
  for (const pt of pts) {
    const px = mapX(pt.x);
    const py = mapZ(pt.z);
    svg += `  <circle cx="${px}" cy="${py}" r="4" fill="#f8fafc" stroke="#0284c7" stroke-width="2" />\n`;
    svg += `  <text x="${px}" y="${py - 12}" text-anchor="middle" class="axis-label">${pt.label}</text>\n`;
  }

  // Legend
  const legX = svgW - padR - 260;
  const legY = 26;
  svg += `  <g transform="translate(${legX}, ${legY})">\n`;
  svg += `    <rect width="250" height="24" rx="4" fill="#0f172a" stroke="#334155" stroke-width="1" />\n`;
  svg += `    <circle cx="16" cy="12" r="5" fill="#38bdf8" />\n`;
  svg += `    <text x="26" y="15" class="legend-text">Gas (Low α_L)</text>\n`;
  svg += `    <circle cx="106" cy="12" r="5" fill="#10b981" />\n`;
  svg += `    <text x="116" y="15" class="legend-text">Mixed Flow</text>\n`;
  svg += `    <circle cx="186" cy="12" r="5" fill="#ef4444" />\n`;
  svg += `    <text x="196" y="15" class="legend-text">Slug (High α_L)</text>\n`;
  svg += `  </g>\n`;

  // Draw Hydrate subcooling evaluation callout if available
  if (activeSnapshot && activeSnapshot.temperature.length > 0) {
    let minMargin = Infinity;
    let critX = 0;
    let critZ = 0;

    for (let k = 0; k < activeSnapshot.x.length; k++) {
      const pVal = activeSnapshot.pressure[k]!;
      const tVal = activeSnapshot.temperature[k]!;
      const xVal = activeSnapshot.x[k]!;
      const tHyd = getHydrateTempK(pVal);
      const margin = tVal - tHyd;
      if (margin < minMargin) {
        minMargin = margin;
        critX = xVal;
        // Interpolate Z
        for (let i = 0; i < pts.length - 1; i++) {
          if (critX >= pts[i]!.x && critX <= pts[i + 1]!.x) {
            const frac = (critX - pts[i]!.x) / Math.max(1, pts[i + 1]!.x - pts[i]!.x);
            critZ = pts[i]!.z + frac * (pts[i + 1]!.z - pts[i]!.z);
            break;
          }
        }
      }
    }

    const cx = mapX(critX);
    const cz = mapZ(critZ);
    svg += `  <circle cx="${cx}" cy="${cz}" r="8" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="2,2" />\n`;
    svg += `  <text x="${cx}" y="${cz + 22}" text-anchor="middle" class="callout-text">Min Hydrate Margin: +${minMargin.toFixed(1)} K</text>\n`;
  }

  // Helper for elevation bathymetry Z interpolation
  const interpolateBathymetryZ = (targetX: number): number => {
    if (targetX <= pts[0]!.x) return pts[0]!.z;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      if (targetX >= p1.x && targetX <= p2.x) {
        const span = Math.max(1, p2.x - p1.x);
        const frac = (targetX - p1.x) / span;
        return p1.z + frac * (p2.z - p1.z);
      }
    }
    return pts[pts.length - 1]!.z;
  };

  // Render Discrete Slugs along pipeline bathymetry
  if (activeSnapshot && activeSnapshot.activeSlugs && activeSnapshot.activeSlugs.length > 0) {
    for (const slug of activeSnapshot.activeSlugs) {
      const tailX = Math.max(0, Math.min(maxX, slug.tailPosition));
      const frontX = Math.max(0, Math.min(maxX, slug.frontPosition));
      if (frontX > tailX) {
        const tailZ = interpolateBathymetryZ(tailX);
        const frontZ = interpolateBathymetryZ(frontX);
        const sx = mapX(tailX);
        const sy = mapZ(tailZ);
        const ex = mapX(frontX);
        const ey = mapZ(frontZ);

        // Highlight slug body with amber/red pill capsule
        svg += `  <!-- Discrete Slug #${slug.id} -->\n`;
        svg += `  <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#ef4444" stroke-width="11" stroke-linecap="round" stroke-opacity="0.85" />\n`;
        svg += `  <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#fbbf24" stroke-width="4" stroke-linecap="round" />\n`;
        const midX = (sx + ex) / 2;
        const midY = (sy + ey) / 2 - 12;
        svg += `  <text x="${midX}" y="${midY}" text-anchor="middle" class="callout-text" fill="#ef4444">SLUG #${slug.id} (L=${slug.length.toFixed(0)}m, v=${slug.velocity.toFixed(1)}m/s)</text>\n`;
      }
    }
  }

  // Render Scraper Pigs along pipeline bathymetry
  if (activeSnapshot && activeSnapshot.pigs && activeSnapshot.pigs.length > 0) {
    for (const pig of activeSnapshot.pigs) {
      if (pig.position >= 0 && pig.position <= maxX) {
        const pigZ = interpolateBathymetryZ(pig.position);
        const px = mapX(pig.position);
        const pz = mapZ(pigZ);

        svg += `  <!-- Scraper Pig: ${pig.name} -->\n`;
        if (pig.isStuck) {
          // Warning indicator for stuck scraper pig
          svg += `  <polygon points="${px},${pz - 12} ${px + 10},${pz + 6} ${px - 10},${pz + 6}" fill="#ef4444" stroke="#f8fafc" stroke-width="1.5" />\n`;
          svg += `  <text x="${px}" y="${pz + 3}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" font-weight="bold" fill="#f8fafc">!</text>\n`;
          svg += `  <text x="${px}" y="${pz + 22}" text-anchor="middle" class="callout-text" fill="#ef4444">STUCK PIG: ${pig.name} (ΔP=${(pig.differentialPressure / 1e5).toFixed(1)} bar)</text>\n`;
        } else {
          // Dynamic scraper pig bullet / disc capsule
          svg += `  <rect x="${px - 10}" y="${pz - 6}" width="20" height="12" rx="4" fill="#06b6d4" stroke="#f8fafc" stroke-width="1.5" />\n`;
          svg += `  <line x1="${px - 4}" y1="${pz - 6}" x2="${px - 4}" y2="${pz + 6}" stroke="#f59e0b" stroke-width="2" />\n`;
          svg += `  <line x1="${px + 4}" y1="${pz - 6}" x2="${px + 4}" y2="${pz + 6}" stroke="#f59e0b" stroke-width="2" />\n`;
          svg += `  <text x="${px}" y="${pz - 12}" text-anchor="middle" class="callout-text" fill="#06b6d4">PIG: ${pig.name} (${(pig.position / 1000).toFixed(2)}km, v=${pig.velocity.toFixed(1)}m/s)</text>\n`;
        }
      }
    }
  }

  svg += `</svg>\n`;
  return svg;
}
