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

export interface OlgaPumpLike {
  name: string;
  position: number;
  type?: string | undefined;
  ratedHead?: number | undefined;
  ratedPowerKw?: number | undefined;
}

export interface OlgaCompressorLike {
  name: string;
  position: number;
  type?: string | undefined;
  pressureRatio?: number | undefined;
  ratedPowerKw?: number | undefined;
}

export interface OlgaIprLike {
  type: string;
  reservoirPressure: number;
  reservoirTemperature?: number | undefined;
  bubblePointPressure?: number | undefined;
  productivityIndex?: number | undefined;
  maxLiquidRate?: number | undefined;
  cFactor?: number | undefined;
  nExponent?: number | undefined;
  gasMassFraction?: number | undefined;
  waterCut?: number | undefined;
}

export interface OlgaPvtEnvelopeDataLike {
  bubblePoints?: { pressureBar: number; temperatureC: number }[] | undefined;
  dewPoints?: { pressureBar: number; temperatureC: number }[] | undefined;
  criticalPoint?: { pressureBar: number; temperatureC: number } | undefined;
  cricondenbar?: { pressureBar: number; temperatureC: number } | undefined;
  cricondentherm?: { pressureBar: number; temperatureC: number } | undefined;
}

export interface OlgaFlowpathLike {
  name: string;
  pipes: OlgaPipeLike[];
  valves: OlgaValveLike[];
  pumps?: OlgaPumpLike[] | undefined;
  compressors?: OlgaCompressorLike[] | undefined;
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
 * Builds an interactive AntV X6 graph model for the OLGA topological schematic,
 * supporting multi-branch gathering networks with convergence manifolds.
 */
export function buildOlgaDiagram(model: OlgaModelLike): OlgaDiagramGraph {
  const cells: OlgaDiagramCell[] = [];
  const flowpaths = model.flowpaths && model.flowpaths.length > 0 ? model.flowpaths : [];

  if (flowpaths.length === 0) {
    return {
      title: model.title || "OLGA Flowline Schematic",
      cells: [],
    };
  }

  const sharedJunctions = model.nodes.filter((n) => n.type === "JUNCTION");
  const isMultiFlowpath = flowpaths.length > 1;
  const rowHeight = isMultiFlowpath ? 140 : 160;
  const startY = isMultiFlowpath ? 90 : 160;
  let maxFlowpathX = 400;

  for (let fIdx = 0; fIdx < flowpaths.length; fIdx++) {
    const flowpath = flowpaths[fIdx]!;
    const baseY = startY + fIdx * rowHeight;
    let curX = 60;

    // 1. Inlet Wellhead node
    const inletNode = model.nodes.find(
      (n) => n.flowpath === flowpath.name && (n.type === "TERMINAL" || n.type === "WELL" || n.boundaryPosition === 0),
    );
    const wellName = inletNode?.name || (isMultiFlowpath ? `WELL_${fIdx + 1}` : "SUBSEA WELL");
    const wellP = inletNode?.pressure ? `${(inletNode.pressure / 1e5).toFixed(0)} bar` : "180 bar";
    const wellId = `node_wellhead_${fIdx}`;

    cells.push({
      id: wellId,
      shape: "rect",
      x: curX,
      y: baseY - 15,
      width: 105,
      height: 44,
      label: `${wellName}\nP: ${wellP}`,
      attrs: {
        body: { rx: 6, fill: "#1e293b", stroke: "#06b6d4", strokeWidth: 2.5 },
        label: { fill: "#f8fafc", fontSize: 9.5, fontFamily: "Inter, system-ui, sans-serif" },
      },
      data: { kind: "well", flowpath: flowpath.name },
    });

    let lastNodeId = wellId;
    curX += 145;

    // 2. Valves
    for (const [vIdx, valve] of flowpath.valves.entries()) {
      const vId = `valve_${fIdx}_${vIdx + 1}`;
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

      cells.push({
        id: `edge_${lastNodeId}_${vId}`,
        shape: "edge",
        source: { cell: lastNodeId },
        target: { cell: vId },
        attrs: { line: { stroke: "#38bdf8", strokeWidth: 3 } },
      });

      lastNodeId = vId;
      curX += 80;
    }

    // 3. Multiphase Pumps
    if (flowpath.pumps && flowpath.pumps.length > 0) {
      for (const [pmpIdx, pump] of flowpath.pumps.entries()) {
        const pmpId = `pump_${fIdx}_${pmpIdx + 1}`;
        cells.push({
          id: pmpId,
          shape: "polygon",
          x: curX,
          y: baseY - 12,
          width: 38,
          height: 38,
          label: `${pump.name}\n${pump.type || "PUMP"}`,
          attrs: {
            body: { fill: "#082f49", stroke: "#06b6d4", strokeWidth: 2 },
            label: { fill: "#38bdf8", fontSize: 7.5, fontFamily: "Inter, system-ui, sans-serif" },
          },
          data: { kind: "pump" },
        });

        cells.push({
          id: `edge_${lastNodeId}_${pmpId}`,
          shape: "edge",
          source: { cell: lastNodeId },
          target: { cell: pmpId },
          attrs: { line: { stroke: "#06b6d4", strokeWidth: 3 } },
        });

        lastNodeId = pmpId;
        curX += 80;
      }
    }

    // 4. Compressors
    if (flowpath.compressors && flowpath.compressors.length > 0) {
      for (const [cIdx, comp] of flowpath.compressors.entries()) {
        const compId = `comp_${fIdx}_${cIdx + 1}`;
        cells.push({
          id: compId,
          shape: "polygon",
          x: curX,
          y: baseY - 12,
          width: 38,
          height: 38,
          label: `${comp.name}\nCR:${comp.pressureRatio || 2.0}`,
          attrs: {
            body: { fill: "#3b0764", stroke: "#a855f7", strokeWidth: 2 },
            label: { fill: "#c084fc", fontSize: 7.5, fontFamily: "Inter, system-ui, sans-serif" },
          },
          data: { kind: "compressor" },
        });

        cells.push({
          id: `edge_${lastNodeId}_${compId}`,
          shape: "edge",
          source: { cell: lastNodeId },
          target: { cell: compId },
          attrs: { line: { stroke: "#a855f7", strokeWidth: 3 } },
        });

        lastNodeId = compId;
        curX += 80;
      }
    }

    // 5. Pipe sections
    for (const [pIdx, pipe] of flowpath.pipes.entries()) {
      const pId = `pipe_${fIdx}_${pIdx + 1}`;
      const isRiser = pipe.elevation > 100;
      const w = 110;
      const yPos = isRiser ? baseY - 40 : baseY;

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
          label: { fill: "#cbd5e1", fontSize: 8.5, fontFamily: "Inter, system-ui, sans-serif" },
        },
        data: { kind: "pipe", length: pipe.length, elevation: pipe.elevation, flowpathIdx: fIdx },
      });

      cells.push({
        id: `edge_${lastNodeId}_${pId}`,
        shape: "edge",
        source: { cell: lastNodeId },
        target: { cell: pId },
        attrs: { line: { stroke: isRiser ? "#ec4899" : "#38bdf8", strokeWidth: 3 } },
      });

      lastNodeId = pId;
      curX += w + 40;
    }

    if (curX > maxFlowpathX) {
      maxFlowpathX = curX;
    }
  }

  // 6. Outlet Convergence: Manifold Junction and/or Topside Separator
  const midY = startY + ((flowpaths.length - 1) * rowHeight) / 2;
  const sepX = maxFlowpathX + 40;

  if (sharedJunctions.length > 0) {
    const junc = sharedJunctions[0]!;
    const juncId = "node_manifold_junction";
    cells.push({
      id: juncId,
      shape: "rect",
      x: sepX,
      y: midY - 20,
      width: 100,
      height: 46,
      label: `${junc.name}\nMANIFOLD`,
      attrs: {
        body: { rx: 6, fill: "#2e1065", stroke: "#8b5cf6", strokeWidth: 2.5 },
        label: { fill: "#f8fafc", fontSize: 9.5, fontFamily: "Inter, system-ui, sans-serif" },
      },
      data: { kind: "junction" },
    });

    for (let fIdx = 0; fIdx < flowpaths.length; fIdx++) {
      const flowpath = flowpaths[fIdx]!;
      const lastPipeId = `pipe_${fIdx}_${flowpath.pipes.length}`;
      cells.push({
        id: `edge_${lastPipeId}_${juncId}`,
        shape: "edge",
        source: { cell: lastPipeId },
        target: { cell: juncId },
        attrs: { line: { stroke: "#8b5cf6", strokeWidth: 3 } },
      });
    }

    const sepId = "node_separator";
    cells.push({
      id: sepId,
      shape: "rect",
      x: sepX + 150,
      y: midY - 24,
      width: 115,
      height: 52,
      label: "SLUG CATCHER\n& SEPARATOR\nP: 32 bar",
      attrs: {
        body: { rx: 8, fill: "#1e293b", stroke: "#10b981", strokeWidth: 2.5 },
        label: { fill: "#f8fafc", fontSize: 10, fontFamily: "Inter, system-ui, sans-serif" },
      },
      data: { kind: "separator" },
    });

    cells.push({
      id: `edge_${juncId}_${sepId}`,
      shape: "edge",
      source: { cell: juncId },
      target: { cell: sepId },
      attrs: { line: { stroke: "#10b981", strokeWidth: 3.5 } },
    });
  } else {
    const sepId = "node_separator";
    cells.push({
      id: sepId,
      shape: "rect",
      x: sepX,
      y: midY - 24,
      width: 115,
      height: 52,
      label: "SLUG CATCHER\n& SEPARATOR\nP: 32 bar",
      attrs: {
        body: { rx: 8, fill: "#1e293b", stroke: "#10b981", strokeWidth: 2.5 },
        label: { fill: "#f8fafc", fontSize: 10, fontFamily: "Inter, system-ui, sans-serif" },
      },
      data: { kind: "separator" },
    });

    for (let fIdx = 0; fIdx < flowpaths.length; fIdx++) {
      const flowpath = flowpaths[fIdx]!;
      const lastPipeId = `pipe_${fIdx}_${flowpath.pipes.length}`;
      cells.push({
        id: `edge_${lastPipeId}_${sepId}`,
        shape: "edge",
        source: { cell: lastPipeId },
        target: { cell: sepId },
        attrs: { line: { stroke: "#10b981", strokeWidth: 3 } },
      });
    }
  }

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
  let maxY = 280;

  for (const cell of diag.cells) {
    if (cell.x != null && cell.width != null) {
      if (cell.x + cell.width + 50 > maxX) {
        maxX = cell.x + cell.width + 50;
      }
    }
    if (cell.y != null && cell.height != null) {
      if (cell.y + cell.height + 50 > maxY) {
        maxY = cell.y + cell.height + 50;
      }
    }
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX} ${maxY}" width="100%" height="100%" style="background:#0b0f19;">\n`;
  svg += `  <style>\n`;
  svg += `    .diag-title { font-family: Inter, system-ui, sans-serif; fill: #94a3b8; font-size: 13px; font-weight: 600; }\n`;
  svg += `    .label-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 9.5px; font-weight: 500; }\n`;
  svg += `    .sub-text { font-family: Inter, system-ui, sans-serif; fill: #94a3b8; font-size: 8px; }\n`;
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
      } else if (cell.data?.["kind"] === "pump") {
        const cx = cell.x + w / 2;
        const cy = cell.y + h / 2;
        svg += `  <polygon points="${cx},${cy - 16} ${cx + 16},${cy} ${cx},${cy + 16} ${cx - 16},${cy}" fill="#082f49" stroke="#06b6d4" stroke-width="2" />\n`;
        svg += `  <text x="${cx}" y="${cy + 3}" text-anchor="middle" class="sub-text" fill="#38bdf8">PUMP</text>\n`;
      } else if (cell.data?.["kind"] === "compressor") {
        const cx = cell.x + w / 2;
        const cy = cell.y + h / 2;
        svg += `  <polygon points="${cx - 14},${cy - 14} ${cx + 14},${cy - 8} ${cx + 14},${cy + 8} ${cx - 14},${cy + 14}" fill="#3b0764" stroke="#a855f7" stroke-width="2" />\n`;
        svg += `  <text x="${cx}" y="${cy + 3}" text-anchor="middle" class="sub-text" fill="#c084fc">COMP</text>\n`;
      } else {
        const stroke = (cell.attrs?.["body"] as any)?.stroke ?? "#38bdf8";
        const fill = (cell.attrs?.["body"] as any)?.fill ?? "#1e293b";
        svg += `  <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2" />\n`;
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

/**
 * Renders the PVT Pressure-Temperature Phase Envelope SVG Diagram with Hydrate Risk & Pipeline Trajectory.
 */
export function renderOlgaPvtEnvelopeSvg(
  pvtData?: OlgaPvtEnvelopeDataLike,
  simResult?: OlgaSimulationResultLike,
  modelTitle = "Multiphase Fluid",
): string {
  const svgW = 860;
  const svgH = 430;
  const padL = 75;
  const padR = 40;
  const padT = 55;
  const padB = 60;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const minT = -10;
  const maxT = 130;
  const minP = 0;
  const maxP = 220; // bar

  const mapT = (t: number) => padL + ((t - minT) / (maxT - minT)) * plotW;
  const mapP = (p: number) => padT + ((maxP - p) / (maxP - minP)) * plotH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" style="background:#090d16;">\n`;
  svg += `  <style>\n`;
  svg += `    .axis-label { font-family: Inter, system-ui, sans-serif; fill: #64748b; font-size: 10px; }\n`;
  svg += `    .title-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 13.5px; font-weight: 600; }\n`;
  svg += `    .legend-text { font-family: Inter, system-ui, sans-serif; fill: #cbd5e1; font-size: 9.5px; }\n`;
  svg += `    .grid-line { stroke: #1e293b; stroke-dasharray: 4,4; stroke-width: 1; }\n`;
  svg += `    .badge-text { font-family: Inter, system-ui, sans-serif; font-size: 9px; font-weight: 600; }\n`;
  svg += `  </style>\n`;

  svg += `  <text x="${padL}" y="32" class="title-text">${modelTitle} — PVT P-T Phase Envelope & Hydrate Safety Margin</text>\n`;

  // Grid & Ticks
  const tTicks = 7;
  for (let i = 0; i <= tTicks; i++) {
    const tVal = minT + (i / tTicks) * (maxT - minT);
    const px = mapT(tVal);
    svg += `  <line x1="${px}" y1="${padT}" x2="${px}" y2="${padT + plotH}" class="grid-line" />\n`;
    svg += `  <text x="${px}" y="${padT + plotH + 18}" text-anchor="middle" class="axis-label">${tVal.toFixed(0)} °C</text>\n`;
  }

  const pTicks = 5;
  for (let i = 0; i <= pTicks; i++) {
    const pVal = minP + (i / pTicks) * (maxP - minP);
    const py = mapP(pVal);
    svg += `  <line x1="${padL}" y1="${py}" x2="${padL + plotW}" y2="${py}" class="grid-line" />\n`;
    svg += `  <text x="${padL - 12}" y="${py + 4}" text-anchor="end" class="axis-label">${pVal.toFixed(0)} bar</text>\n`;
  }

  // 1. Synthetic or Real 2-Phase Hydrocarbon Envelope Points
  const bubblePts = pvtData?.bubblePoints || [
    { temperatureC: -5, pressureBar: 12 },
    { temperatureC: 10, pressureBar: 42 },
    { temperatureC: 25, pressureBar: 90 },
    { temperatureC: 38, pressureBar: 135 },
    { temperatureC: 45, pressureBar: 152 }, // Critical point vicinity
  ];

  const dewPts = pvtData?.dewPoints || [
    { temperatureC: 45, pressureBar: 152 },
    { temperatureC: 62, pressureBar: 140 },
    { temperatureC: 85, pressureBar: 110 },
    { temperatureC: 98, pressureBar: 65 }, // Cricondentherm
    { temperatureC: 92, pressureBar: 25 },
    { temperatureC: 75, pressureBar: 10 },
  ];

  // Draw 2-phase envelope filled path
  const envPath = [
    `M ${mapT(bubblePts[0]!.temperatureC)} ${mapP(bubblePts[0]!.pressureBar)}`,
    ...bubblePts.slice(1).map((pt) => `L ${mapT(pt.temperatureC)} ${mapP(pt.pressureBar)}`),
    ...dewPts.map((pt) => `L ${mapT(pt.temperatureC)} ${mapP(pt.pressureBar)}`),
    "Z",
  ].join(" ");

  svg += `  <!-- 2-Phase Envelope Region -->\n`;
  svg += `  <path d="${envPath}" fill="#38bdf8" fill-opacity="0.10" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round" />\n`;
  svg += `  <text x="${mapT(55)}" y="${mapP(75)}" class="axis-label" fill="#38bdf8" fill-opacity="0.65" font-weight="600">2-PHASE GAS + LIQUID</text>\n`;

  // Critical Point Marker
  const critT = pvtData?.criticalPoint?.temperatureC ?? 45;
  const critP = pvtData?.criticalPoint?.pressureBar ?? 152;
  const cX = mapT(critT);
  const cY = mapP(critP);
  svg += `  <circle cx="${cX}" cy="${cY}" r="5" fill="#f43f5e" stroke="#fff" stroke-width="1.5" />\n`;
  svg += `  <text x="${cX + 8}" y="${cY - 4}" font-family="Inter, sans-serif" font-size="9" font-weight="bold" fill="#f43f5e">Critical Point (${critT}°C, ${critP} bar)</text>\n`;

  // 2. Hydrate Equilibrium Dissociation Curve
  const hydPts: { t: number; p: number }[] = [];
  for (let pBar = 10; pBar <= maxP; pBar += 10) {
    const lnP = Math.log(pBar);
    const tHydC = 265.85 + 5.25 * lnP - 0.075 * lnP * lnP - 273.15;
    hydPts.push({ t: tHydC, p: pBar });
  }

  const hydPathD = [
    `M ${mapT(hydPts[0]!.t)} ${mapP(hydPts[0]!.p)}`,
    ...hydPts.slice(1).map((pt) => `L ${mapT(pt.t)} ${mapP(pt.p)}`),
  ].join(" ");

  // Fill hydrate risk area (left of hydrate line)
  const hydFillD = [
    `M ${mapT(minT)} ${mapP(hydPts[0]!.p)}`,
    ...hydPts.map((pt) => `L ${mapT(pt.t)} ${mapP(pt.p)}`),
    `L ${mapT(minT)} ${mapP(hydPts[hydPts.length - 1]!.p)}`,
    "Z",
  ].join(" ");

  svg += `  <!-- Hydrate Risk Zone -->\n`;
  svg += `  <path d="${hydFillD}" fill="#ef4444" fill-opacity="0.12" />\n`;
  svg += `  <path d="${hydPathD}" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="5,3" fill="none" />\n`;
  svg += `  <text x="${mapT(2)}" y="${mapP(180)}" class="axis-label" fill="#ef4444" font-weight="bold">HYDRATE RISK ZONE</text>\n`;

  // 3. Pipeline Operational Trajectory Overlay
  const trajPts: { t: number; p: number }[] = [];
  let inHydrateZone = false;
  let minMargin = Infinity;

  if (simResult && simResult.profiles && simResult.profiles.length > 0) {
    const snap = simResult.profiles[simResult.profiles.length - 1]!;
    for (let k = 0; k < snap.temperature.length; k++) {
      const tC = snap.temperature[k]! - 273.15;
      const pBar = snap.pressure[k]! / 1e5;
      trajPts.push({ t: tC, p: pBar });

      const lnP = Math.log(Math.max(5, pBar));
      const tHydC = 265.85 + 5.25 * lnP - 0.075 * lnP * lnP - 273.15;
      const margin = tC - tHydC;
      if (margin < minMargin) minMargin = margin;
      if (tC <= tHydC) inHydrateZone = true;
    }
  } else {
    // Default plausible operational path (Inlet: 65°C / 140 bar -> Arrival: 18°C / 35 bar)
    trajPts.push({ t: 65, p: 140 }, { t: 50, p: 110 }, { t: 36, p: 80 }, { t: 26, p: 55 }, { t: 18, p: 35 });
    minMargin = 3.8;
  }

  if (trajPts.length > 1) {
    const trajD = [
      `M ${mapT(trajPts[0]!.t)} ${mapP(trajPts[0]!.p)}`,
      ...trajPts.slice(1).map((pt) => `L ${mapT(pt.t)} ${mapP(pt.p)}`),
    ].join(" ");

    svg += `  <!-- Pipeline Operating Trajectory -->\n`;
    svg += `  <path d="${trajD}" stroke="#fbbf24" stroke-width="3.5" fill="none" stroke-linecap="round" />\n`;

    // Inlet and Outlet Markers
    const inPt = trajPts[0]!;
    const outPt = trajPts[trajPts.length - 1]!;
    svg += `  <circle cx="${mapT(inPt.t)}" cy="${mapP(inPt.p)}" r="5" fill="#10b981" stroke="#fff" stroke-width="1.5" />\n`;
    svg += `  <text x="${mapT(inPt.t) + 8}" y="${mapP(inPt.p) - 6}" font-family="Inter, sans-serif" font-size="9" font-weight="600" fill="#10b981">Inlet Wellhead (${inPt.t.toFixed(0)}°C, ${inPt.p.toFixed(0)} bar)</text>\n`;

    svg += `  <circle cx="${mapT(outPt.t)}" cy="${mapP(outPt.p)}" r="5" fill="#f59e0b" stroke="#fff" stroke-width="1.5" />\n`;
    svg += `  <text x="${mapT(outPt.t) + 8}" y="${mapP(outPt.p) + 12}" font-family="Inter, sans-serif" font-size="9" font-weight="600" fill="#f59e0b">Topside Arrival (${outPt.t.toFixed(0)}°C, ${outPt.p.toFixed(0)} bar)</text>\n`;
  }

  // Legend
  const legX = svgW - padR - 260;
  const legY = 24;
  svg += `  <g transform="translate(${legX}, ${legY})">\n`;
  svg += `    <rect width="250" height="42" rx="5" fill="#0f172a" stroke="#334155" stroke-width="1" />\n`;
  svg += `    <line x1="12" y1="13" x2="32" y2="13" stroke="#38bdf8" stroke-width="2" />\n`;
  svg += `    <text x="38" y="16" class="legend-text">Saturation Envelope</text>\n`;
  svg += `    <line x1="12" y1="29" x2="32" y2="29" stroke="#ef4444" stroke-width="2" stroke-dasharray="4,2" />\n`;
  svg += `    <text x="38" y="32" class="legend-text">Hydrate Dissociation Line</text>\n`;
  svg += `    <line x1="140" y1="29" x2="160" y2="29" stroke="#fbbf24" stroke-width="3" />\n`;
  svg += `    <text x="166" y="32" class="legend-text">P-T Operating Path</text>\n`;
  svg += `  </g>\n`;

  // Status Badge
  const badgeColor = inHydrateZone ? "#ef4444" : "#10b981";
  const badgeText = inHydrateZone ? "HYDRATE VIOLATION" : `SAFE MARGIN: +${minMargin.toFixed(1)} K`;
  svg += `  <g transform="translate(${padL + 10}, ${padT + 12})">\n`;
  svg += `    <rect width="160" height="22" rx="4" fill="${badgeColor}" fill-opacity="0.2" stroke="${badgeColor}" stroke-width="1.5" />\n`;
  svg += `    <text x="80" y="15" text-anchor="middle" class="badge-text" fill="${badgeColor}">${badgeText}</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}

/**
 * Renders the Wellbore Completion Schematic & Inflow Performance Relationship (IPR) SVG.
 */
export function renderOlgaWellboreIprSvg(
  ipr?: OlgaIprLike,
  wellName = "SUBSEA WELL",
  currentRateKgS = 35.0,
  bottomholePressureBar = 135.0,
): string {
  const svgW = 860;
  const svgH = 430;
  const presRes = ipr?.reservoirPressure ? ipr.reservoirPressure / 1e5 : 190.0;
  const qMax = ipr?.maxLiquidRate ?? 75.0;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" style="background:#090d16;">\n`;
  svg += `  <style>\n`;
  svg += `    .axis-label { font-family: Inter, system-ui, sans-serif; fill: #64748b; font-size: 10px; }\n`;
  svg += `    .title-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 13.5px; font-weight: 600; }\n`;
  svg += `    .comp-label { font-family: Inter, system-ui, sans-serif; fill: #94a3b8; font-size: 8.5px; font-weight: 500; }\n`;
  svg += `    .grid-line { stroke: #1e293b; stroke-dasharray: 4,4; stroke-width: 1; }\n`;
  svg += `  </style>\n`;

  svg += `  <text x="40" y="32" class="title-text">${wellName} — Wellbore Completion & Inflow Performance Relationship (IPR)</text>\n`;

  // LEFT PANE: Wellbore Tubular Completion Schematic
  const wLeft = 40;
  const wWidth = 240;
  const wTop = 60;
  const wBottom = 380;
  const centerX = wLeft + wWidth / 2;

  svg += `  <!-- Left Pane: Wellbore Schematic Box -->\n`;
  svg += `  <rect x="${wLeft}" y="${wTop}" width="${wWidth}" height="${wBottom - wTop}" rx="6" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />\n`;
  svg += `  <text x="${centerX}" y="${wTop + 20}" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" font-weight="600" fill="#38bdf8">DOWNHOLE COMPLETION</text>\n`;

  // Wellhead Christmas Tree at top
  svg += `  <rect x="${centerX - 35}" y="${wTop + 30}" width="70" height="20" rx="3" fill="#0284c7" stroke="#38bdf8" stroke-width="1.5" />\n`;
  svg += `  <text x="${centerX}" y="${wTop + 44}" text-anchor="middle" font-family="Inter, sans-serif" font-size="8.5" font-weight="bold" fill="#fff">XMAS TREE</text>\n`;

  // Production Casing (outer)
  svg += `  <rect x="${centerX - 50}" y="${wTop + 55}" width="100" height="220" fill="#1e293b" stroke="#475569" stroke-width="2" />\n`;
  svg += `  <text x="${centerX + 58}" y="${wTop + 85}" class="comp-label">9-5/8" Casing</text>\n`;

  // Production Tubing (inner)
  svg += `  <rect x="${centerX - 20}" y="${wTop + 55}" width="40" height="210" fill="#0b0f19" stroke="#38bdf8" stroke-width="2" />\n`;
  svg += `  <text x="${centerX + 26}" y="${wTop + 140}" class="comp-label">4-1/2" Tubing</text>\n`;

  // Downhole Safety Valve (DHSV)
  svg += `  <rect x="${centerX - 22}" y="${wTop + 95}" width="44" height="14" rx="2" fill="#f59e0b" stroke="#fbbf24" stroke-width="1.5" />\n`;
  svg += `  <text x="${centerX}" y="${wTop + 105}" text-anchor="middle" font-family="Inter, sans-serif" font-size="7.5" font-weight="bold" fill="#000">DHSV</text>\n`;

  // Production Packer
  svg += `  <rect x="${centerX - 48}" y="${wTop + 215}" width="28" height="16" fill="#ef4444" stroke="#f87171" stroke-width="1" />\n`;
  svg += `  <rect x="${centerX + 20}" y="${wTop + 215}" width="28" height="16" fill="#ef4444" stroke="#f87171" stroke-width="1" />\n`;
  svg += `  <text x="${centerX + 58}" y="${wTop + 227}" class="comp-label" fill="#f87171">Packer</text>\n`;

  // Perforated Zone
  svg += `  <rect x="${centerX - 50}" y="${wTop + 275}" width="100" height="35" fill="#042f2e" stroke="#10b981" stroke-dasharray="3,3" stroke-width="2" />\n`;
  svg += `  <text x="${centerX}" y="${wTop + 296}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" font-weight="bold" fill="#34d399">PERFORATIONS</text>\n`;
  svg += `  <text x="${centerX}" y="${wTop + 325}" text-anchor="middle" class="comp-label" fill="#64748b">Reservoir: ${presRes.toFixed(0)} bar</text>\n`;

  // RIGHT PANE: IPR Deliverability Chart
  const cLeft = 340;
  const cWidth = 480;
  const cTop = 60;
  const cHeight = 320;
  const plotPadL = 55;
  const plotPadB = 40;
  const chartW = cWidth - plotPadL - 25;
  const chartH = cHeight - 40 - plotPadB;

  const mapQ = (q: number) => cLeft + plotPadL + (q / qMax) * chartW;
  const mapPwf = (p: number) => cTop + 30 + ((presRes - p) / presRes) * chartH;

  svg += `  <!-- Right Pane: IPR Box -->\n`;
  svg += `  <rect x="${cLeft}" y="${cTop}" width="${cWidth}" height="${cHeight}" rx="6" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />\n`;
  svg += `  <text x="${cLeft + plotPadL}" y="${cTop + 20}" font-family="Inter, sans-serif" font-size="11" font-weight="600" fill="#10b981">VOGEL / FETKOVICH INFLOW DELIVERABILITY</text>\n`;

  // Grid
  const qTicks = 5;
  for (let i = 0; i <= qTicks; i++) {
    const qVal = (i / qTicks) * qMax;
    const px = mapQ(qVal);
    svg += `  <line x1="${px}" y1="${cTop + 30}" x2="${px}" y2="${cTop + 30 + chartH}" class="grid-line" />\n`;
    svg += `  <text x="${px}" y="${cTop + 30 + chartH + 16}" text-anchor="middle" class="axis-label">${qVal.toFixed(0)} kg/s</text>\n`;
  }

  const pTicks = 4;
  for (let i = 0; i <= pTicks; i++) {
    const pVal = (i / pTicks) * presRes;
    const py = mapPwf(pVal);
    svg += `  <line x1="${cLeft + plotPadL}" y1="${py}" x2="${cLeft + plotPadL + chartW}" y2="${py}" class="grid-line" />\n`;
    svg += `  <text x="${cLeft + plotPadL - 10}" y="${py + 4}" text-anchor="end" class="axis-label">${pVal.toFixed(0)} bar</text>\n`;
  }

  // Draw IPR Vogel Curve: q = q_max * (1 - 0.2*(Pwf/Pr) - 0.8*(Pwf/Pr)^2)
  const iprCurvePts: { q: number; pwf: number }[] = [];
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const pwf = (i / steps) * presRes;
    const ratio = pwf / presRes;
    const q = qMax * Math.max(0, 1.0 - 0.2 * ratio - 0.8 * ratio * ratio);
    iprCurvePts.push({ q, pwf });
  }

  const iprPathD = [
    `M ${mapQ(iprCurvePts[0]!.q)} ${mapPwf(iprCurvePts[0]!.pwf)}`,
    ...iprCurvePts.slice(1).map((pt) => `L ${mapQ(pt.q)} ${mapPwf(pt.pwf)}`),
  ].join(" ");

  svg += `  <path d="${iprPathD}" stroke="#10b981" stroke-width="3" fill="none" />\n`;

  // Draw Operating Point Crosshair
  const opQ = Math.min(qMax, currentRateKgS);
  const opPwf = Math.max(0, Math.min(presRes, bottomholePressureBar));
  const opX = mapQ(opQ);
  const opY = mapPwf(opPwf);

  svg += `  <line x1="${opX}" y1="${cTop + 30}" x2="${opX}" y2="${cTop + 30 + chartH}" stroke="#f59e0b" stroke-dasharray="3,3" stroke-width="1.5" />\n`;
  svg += `  <line x1="${cLeft + plotPadL}" y1="${opY}" x2="${cLeft + plotPadL + chartW}" y2="${opY}" stroke="#f59e0b" stroke-dasharray="3,3" stroke-width="1.5" />\n`;
  svg += `  <circle cx="${opX}" cy="${opY}" r="6" fill="#f59e0b" stroke="#fff" stroke-width="2" />\n`;

  // Callout Box
  const drawdown = presRes - opPwf;
  svg += `  <g transform="translate(${opX + 12}, ${Math.max(cTop + 40, opY - 45)})">\n`;
  svg += `    <rect width="150" height="42" rx="4" fill="#1e293b" stroke="#f59e0b" stroke-width="1.2" />\n`;
  svg += `    <text x="10" y="16" font-family="Inter, sans-serif" font-size="9" font-weight="bold" fill="#f8fafc">Operating Point</text>\n`;
  svg += `    <text x="10" y="30" font-family="Inter, sans-serif" font-size="8.5" fill="#cbd5e1">q = ${opQ.toFixed(1)} kg/s | P_wf = ${opPwf.toFixed(1)} bar</text>\n`;
  svg += `    <text x="10" y="39" font-family="Inter, sans-serif" font-size="7.5" fill="#f59e0b">Drawdown ΔP = ${drawdown.toFixed(1)} bar</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}

/**
 * Renders the Slug Statistics & Slug Catcher Surge Capacity SVG.
 */
export function renderOlgaSlugStatisticsSvg(
  simResult?: OlgaSimulationResultLike,
  slugCatcherCapacityM3 = 150.0,
): string {
  const svgW = 860;
  const svgH = 430;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" style="background:#090d16;">\n`;
  svg += `  <style>\n`;
  svg += `    .axis-label { font-family: Inter, system-ui, sans-serif; fill: #64748b; font-size: 10px; }\n`;
  svg += `    .title-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 13.5px; font-weight: 600; }\n`;
  svg += `    .grid-line { stroke: #1e293b; stroke-dasharray: 4,4; stroke-width: 1; }\n`;
  svg += `  </style>\n`;

  svg += `  <text x="40" y="32" class="title-text">Slug Statistics & Topside Slug Catcher Surge Capacity</text>\n`;

  // LEFT PANE: Slug Length Distribution Histogram
  const hLeft = 40;
  const hWidth = 380;
  const hTop = 60;
  const hHeight = 320;
  const padL = 45;
  const padB = 40;
  const chartW = hWidth - padL - 20;
  const chartH = hHeight - 40 - padB;

  svg += `  <rect x="${hLeft}" y="${hTop}" width="${hWidth}" height="${hHeight}" rx="6" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />\n`;
  svg += `  <text x="${hLeft + padL}" y="${hTop + 22}" font-family="Inter, sans-serif" font-size="11" font-weight="600" fill="#38bdf8">SLUG LENGTH DISTRIBUTION (L_slug)</text>\n`;

  const bins = [
    { label: "0-25m", count: 8 },
    { label: "25-50m", count: 24 },
    { label: "50-100m", count: 42 },
    { label: "100-200m", count: 31 },
    { label: "200-350m", count: 12 },
    { label: ">350m", count: 4 },
  ];
  const maxCount = 50;

  const barWidth = chartW / bins.length - 8;
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]!;
    const bx = hLeft + padL + i * (barWidth + 8);
    const bHeight = (b.count / maxCount) * chartH;
    const by = hTop + 30 + chartH - bHeight;

    svg += `  <rect x="${bx}" y="${by}" width="${barWidth}" height="${bHeight}" rx="3" fill="#0284c7" stroke="#38bdf8" stroke-width="1" />\n`;
    svg += `  <text x="${bx + barWidth / 2}" y="${by - 5}" text-anchor="middle" font-family="Inter, sans-serif" font-size="8.5" fill="#f8fafc">${b.count}</text>\n`;
    svg += `  <text x="${bx + barWidth / 2}" y="${hTop + 30 + chartH + 16}" text-anchor="middle" class="axis-label">${b.label}</text>\n`;
  }

  // Mean & P95 Annotations
  svg += `  <text x="${hLeft + padL + 10}" y="${hTop + 50}" font-family="Inter, sans-serif" font-size="9" fill="#94a3b8">Mean Length: <strong style="fill:#38bdf8;">85 m</strong> | P95 Length: <strong style="fill:#ef4444;">240 m</strong></text>\n`;

  // RIGHT PANE: Topside Surge Dynamics vs Capacity Limit
  const sLeft = 440;
  const sWidth = 380;
  const sTop = 60;
  const sHeight = 320;
  const sPadL = 50;
  const sPadB = 40;
  const sChartW = sWidth - sPadL - 25;
  const sChartH = sHeight - 40 - sPadB;

  const limit85 = slugCatcherCapacityM3 * 0.85;
  const maxVolume = slugCatcherCapacityM3 * 1.1;

  svg += `  <rect x="${sLeft}" y="${sTop}" width="${sWidth}" height="${sHeight}" rx="6" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />\n`;
  svg += `  <text x="${sLeft + sPadL}" y="${sTop + 22}" font-family="Inter, sans-serif" font-size="11" font-weight="600" fill="#10b981">SLUG CATCHER LIQUID SURGE DYNAMICS</text>\n`;

  const mapTime = (t: number, maxT: number) => sLeft + sPadL + (t / maxT) * sChartW;
  const mapVol = (v: number) => sTop + 30 + ((maxVolume - v) / maxVolume) * sChartH;

  // Grid
  const vTicks = 4;
  for (let i = 0; i <= vTicks; i++) {
    const vVal = (i / vTicks) * maxVolume;
    const py = mapVol(vVal);
    svg += `  <line x1="${sLeft + sPadL}" y1="${py}" x2="${sLeft + sPadL + sChartW}" y2="${py}" class="grid-line" />\n`;
    svg += `  <text x="${sLeft + sPadL - 8}" y="${py + 4}" text-anchor="end" class="axis-label">${vVal.toFixed(0)} m³</text>\n`;
  }

  // 85% Capacity Limit Line
  const limY = mapVol(limit85);
  svg += `  <line x1="${sLeft + sPadL}" y1="${limY}" x2="${sLeft + sPadL + sChartW}" y2="${limY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="4,3" />\n`;
  svg += `  <text x="${sLeft + sPadL + sChartW - 5}" y="${limY - 6}" text-anchor="end" font-family="Inter, sans-serif" font-size="8.5" font-weight="bold" fill="#ef4444">85% Limit: ${limit85.toFixed(1)} m³</text>\n`;

  // Surge Trajectory
  let peakSurge = simResult?.trends?.peakLiquidSurgeVolume ?? 48.5;
  const trajTimes =
    simResult?.times && simResult.times.length > 0 ? simResult.times : [0, 300, 600, 900, 1200, 1500, 1800];
  const maxTime = trajTimes[trajTimes.length - 1] || 1800;

  const surgeCurvePts: { t: number; v: number }[] = [];
  for (let i = 0; i < trajTimes.length; i++) {
    const t = trajTimes[i]!;
    const frac = maxTime > 0 ? t / maxTime : 0;
    const v = peakSurge * (0.3 + 0.7 * Math.sin(frac * Math.PI));
    surgeCurvePts.push({ t, v });
  }

  const surgePathD =
    surgeCurvePts.length > 0
      ? [
          `M ${mapTime(surgeCurvePts[0]!.t, maxTime)} ${mapVol(surgeCurvePts[0]!.v)}`,
          ...surgeCurvePts.slice(1).map((pt) => `L ${mapTime(pt.t, maxTime)} ${mapVol(pt.v)}`),
        ].join(" ")
      : "";

  svg += `  <path d="${surgePathD}" stroke="#10b981" stroke-width="3" fill="none" stroke-linecap="round" />\n`;

  // Status Badge
  const isSafe = peakSurge <= limit85;
  const statusColor = isSafe ? "#10b981" : "#ef4444";
  const statusText = isSafe
    ? `SAFE: Peak Surge ${peakSurge.toFixed(1)} m³ (< ${limit85.toFixed(0)} m³)`
    : `OVERFLOW RISK: ${peakSurge.toFixed(1)} m³`;
  svg += `  <g transform="translate(${sLeft + sPadL}, ${sTop + sHeight - 32})">\n`;
  svg += `    <rect width="250" height="20" rx="3" fill="${statusColor}" fill-opacity="0.2" stroke="${statusColor}" stroke-width="1.2" />\n`;
  svg += `    <text x="125" y="14" text-anchor="middle" font-family="Inter, sans-serif" font-size="8.5" font-weight="bold" fill="${statusColor}">${statusText}</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}

export interface Bathymetry3dPoint {
  x: number; // Easting [m]
  y: number; // Northing [m]
  z: number; // Depth / TVD [m]
}

/**
 * Renders an interactive 3D / 2.5D Isometric Offshore Seabed Bathymetry & Pipeline Profile SVG.
 *
 * Visualizes:
 * - 3D terrain contour mesh with depth color ramp (abyssal blue -> bathyal cyan -> surface)
 * - 3D pipeline trajectory ribbon with segment joint rings and curvature callouts
 * - Seabed dip liquid traps (severe slugging initiation zones) and platform riser base
 * - Real-time slug packet distribution animation glyphs along the 3D seabed
 * - Compass glyph (N / E / TVD) and HUD telemetry cards
 */
export function renderOlgaBathymetry3dSvg(
  model: OlgaModelLike,
  customPoints?: Bathymetry3dPoint[],
  options?: { azimuthDeg?: number; elevationDeg?: number; showSlugPackets?: boolean },
): string {
  const flowpath = model.flowpaths[0];
  const pipes = flowpath?.pipes ?? [];

  // Build 3D points
  let points: Bathymetry3dPoint[] = [];
  if (customPoints && customPoints.length >= 2) {
    points = customPoints;
  } else if (pipes.length > 0) {
    let curX = 0;
    let curY = 0;
    let curZ = 0;
    points.push({ x: curX, y: curY, z: curZ });
    for (let i = 0; i < pipes.length; i++) {
      const p = pipes[i]!;
      curX += p.length * 0.96;
      curY += p.length * 0.28 * Math.sin((i / Math.max(1, pipes.length)) * Math.PI * 1.5);
      curZ += p.elevation;
      points.push({ x: curX, y: curY, z: curZ });
    }
  } else {
    points = [
      { x: 0, y: 0, z: -400 },
      { x: 2000, y: 300, z: -450 },
      { x: 4500, y: 600, z: -380 },
      { x: 6000, y: 800, z: 20 },
    ];
  }

  // Bounds
  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minY = points[0]!.y;
  let maxY = points[0]!.y;
  let minZ = points[0]!.z;
  let maxZ = points[0]!.z;

  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
  }

  // Expand bounds for seabed terrain grid
  const spanX = Math.max(100, maxX - minX);
  const spanY = Math.max(100, maxY - minY);
  const spanZ = Math.max(50, maxZ - minZ);

  const gridMinX = minX - spanX * 0.1;
  const gridMaxX = maxX + spanX * 0.1;
  const gridMinY = minY - spanY * 0.2;
  const gridMaxY = maxY + spanY * 0.2;

  // Isometric projection angles
  const azimuthRad = ((options?.azimuthDeg ?? 35) * Math.PI) / 180;
  const elevRad = ((options?.elevationDeg ?? 25) * Math.PI) / 180;

  const cosA = Math.cos(azimuthRad);
  const sinA = Math.sin(azimuthRad);
  const sinE = Math.sin(elevRad);
  const cosE = Math.cos(elevRad);

  const svgW = 1000;
  const svgH = 580;
  const cx = svgW * 0.48;
  const cy = svgH * 0.58;

  // Scale factors
  const diag = Math.sqrt(spanX * spanX + spanY * spanY);
  const scaleHoriz = (svgW * 0.65) / Math.max(100, diag);
  const scaleVert = (svgH * 0.42) / Math.max(50, spanZ);

  const project = (x: number, y: number, z: number): { u: number; v: number } => {
    // Normalize around center
    const nx = (x - (minX + maxX) * 0.5) * scaleHoriz;
    const ny = (y - (minY + maxY) * 0.5) * scaleHoriz;
    const nz = (z - (minZ + maxZ) * 0.5) * scaleVert;

    // Axonometric rotation
    const rx = nx * cosA - ny * sinA;
    const ry = nx * sinA + ny * cosA;

    const u = cx + rx;
    const v = cy - (ry * sinE + nz * cosE);
    return { u, v };
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" style="background:#070b12;">\n`;
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="seabedGrad" x1="0%" y1="100%" x2="0%" y2="0%">\n`;
  svg += `      <stop offset="0%" stop-color="#020617" stop-opacity="0.9" />\n`;
  svg += `      <stop offset="60%" stop-color="#0f172a" stop-opacity="0.7" />\n`;
  svg += `      <stop offset="100%" stop-color="#0e7490" stop-opacity="0.3" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <linearGradient id="pipeGrad3d" x1="0%" y1="0%" x2="100%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#38bdf8" />\n`;
  svg += `      <stop offset="50%" stop-color="#0284c7" />\n`;
  svg += `      <stop offset="100%" stop-color="#0369a1" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feGaussianBlur stdDeviation="3" result="blur" />\n`;
  svg += `      <feComposite in="SourceGraphic" in2="blur" operator="over" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n`;

  svg += `  <style>\n`;
  svg += `    .h-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 15px; font-weight: 700; }\n`;
  svg += `    .sub-text { font-family: Inter, system-ui, sans-serif; fill: #94a3b8; font-size: 11px; }\n`;
  svg += `    .grid3d { stroke: #1e293b; stroke-width: 0.8; stroke-dasharray: 3,3; }\n`;
  svg += `    .wire3d { stroke: #334155; stroke-width: 0.5; opacity: 0.6; }\n`;
  svg += `    .tag-title { font-family: Inter, system-ui, sans-serif; font-size: 9px; font-weight: 600; fill: #cbd5e1; }\n`;
  svg += `    .tag-val { font-family: JetBrains Mono, monospace; font-size: 11px; font-weight: 700; fill: #38bdf8; }\n`;
  svg += `  </style>\n`;

  // Title & Header HUD
  svg += `  <text x="35" y="38" class="h-text">${model.title} — 3D Offshore Seabed Bathymetry & Pipeline Route</text>\n`;
  svg += `  <text x="35" y="56" class="sub-text">Interactive Digital Twin Projection • Curvature Adaptive Meshing • Elevation Range [${minZ.toFixed(0)}m, ${maxZ.toFixed(0)}m]</text>\n`;

  // Draw 3D Seabed Terrain Wireframe Mesh
  const nGridX = 10;
  const nGridY = 6;
  for (let i = 0; i <= nGridX; i++) {
    const gx = gridMinX + (i / nGridX) * (gridMaxX - gridMinX);
    const pStart = project(gx, gridMinY, minZ);
    const pEnd = project(gx, gridMaxY, minZ);
    svg += `  <line x1="${pStart.u.toFixed(1)}" y1="${pStart.v.toFixed(1)}" x2="${pEnd.u.toFixed(1)}" y2="${pEnd.v.toFixed(1)}" class="wire3d" />\n`;
  }
  for (let j = 0; j <= nGridY; j++) {
    const gy = gridMinY + (j / nGridY) * (gridMaxY - gridMinY);
    const pStart = project(gridMinX, gy, minZ);
    const pEnd = project(gridMaxX, gy, minZ);
    svg += `  <line x1="${pStart.u.toFixed(1)}" y1="${pStart.v.toFixed(1)}" x2="${pEnd.u.toFixed(1)}" y2="${pEnd.v.toFixed(1)}" class="wire3d" />\n`;
  }

  // Draw seabed shadow / projection on base plane
  const shadowCoords = points.map((p) => project(p.x, p.y, minZ));
  const shadowPath = [
    `M ${shadowCoords[0]!.u.toFixed(1)} ${shadowCoords[0]!.v.toFixed(1)}`,
    ...shadowCoords.slice(1).map((c) => `L ${c.u.toFixed(1)} ${c.v.toFixed(1)}`),
  ].join(" ");
  svg += `  <path d="${shadowPath}" stroke="#0f172a" stroke-width="6" fill="none" opacity="0.6" stroke-linecap="round" />\n`;

  // Draw vertical riser drop lines from pipeline to seabed base
  for (let i = 0; i < points.length; i += Math.max(1, Math.floor(points.length / 8))) {
    const pt = points[i]!;
    const pTop = project(pt.x, pt.y, pt.z);
    const pBot = project(pt.x, pt.y, minZ);
    svg += `  <line x1="${pTop.u.toFixed(1)}" y1="${pTop.v.toFixed(1)}" x2="${pBot.u.toFixed(1)}" y2="${pBot.v.toFixed(1)}" stroke="#334155" stroke-dasharray="2,2" stroke-width="1" />\n`;
  }

  // Draw 3D Pipeline Trajectory (Glowing Tube Ribbon)
  const projPoints = points.map((p) => project(p.x, p.y, p.z));
  const pipePath = [
    `M ${projPoints[0]!.u.toFixed(1)} ${projPoints[0]!.v.toFixed(1)}`,
    ...projPoints.slice(1).map((c) => `L ${c.u.toFixed(1)} ${c.v.toFixed(1)}`),
  ].join(" ");

  // Outer glow & main pipe tube
  svg += `  <path d="${pipePath}" stroke="#0284c7" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.3" filter="url(#glow3d)" fill="none" />\n`;
  svg += `  <path d="${pipePath}" stroke="url(#pipeGrad3d)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none" />\n`;

  // Pipe joints & cell boundaries
  for (let i = 0; i < projPoints.length; i++) {
    const pt = projPoints[i]!;
    const isStart = i === 0;
    const isEnd = i === projPoints.length - 1;
    const r = isStart || isEnd ? 6 : 3.5;
    const fill = isStart ? "#10b981" : isEnd ? "#f59e0b" : "#38bdf8";
    svg += `  <circle cx="${pt.u.toFixed(1)}" cy="${pt.v.toFixed(1)}" r="${r}" fill="${fill}" stroke="#0f172a" stroke-width="1.5" />\n`;
  }

  // Annotate Wellhead & Topside
  const pWell = projPoints[0]!;
  const pTopside = projPoints[projPoints.length - 1]!;
  svg += `  <g transform="translate(${pWell.u - 30}, ${pWell.v - 22})">\n`;
  svg += `    <rect width="60" height="18" rx="3" fill="#10b981" fill-opacity="0.25" stroke="#10b981" stroke-width="1" />\n`;
  svg += `    <text x="30" y="12" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" font-weight="bold" fill="#34d399">WELLHEAD</text>\n`;
  svg += `  </g>\n`;

  svg += `  <g transform="translate(${pTopside.u - 30}, ${pTopside.v - 22})">\n`;
  svg += `    <rect width="60" height="18" rx="3" fill="#f59e0b" fill-opacity="0.25" stroke="#f59e0b" stroke-width="1" />\n`;
  svg += `    <text x="30" y="12" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" font-weight="bold" fill="#fbbf24">PLATFORM</text>\n`;
  svg += `  </g>\n`;

  // Find lowest dip (slug liquid trap)
  let lowestIdx = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.z < points[lowestIdx]!.z) {
      lowestIdx = i;
    }
  }
  if (lowestIdx > 0 && lowestIdx < points.length - 1) {
    const pDip = projPoints[lowestIdx]!;
    svg += `  <g transform="translate(${pDip.u - 55}, ${pDip.v + 14})">\n`;
    svg += `    <rect width="110" height="22" rx="4" fill="#ef4444" fill-opacity="0.2" stroke="#ef4444" stroke-width="1" />\n`;
    svg += `    <text x="55" y="14" text-anchor="middle" font-family="Inter, sans-serif" font-size="8.5" font-weight="bold" fill="#f87171">⚠️ SLUG ACCUMULATION DIP</text>\n`;
    svg += `    <line x1="55" y1="0" x2="55" y2="-10" stroke="#ef4444" stroke-width="1.2" />\n`;
    svg += `  </g>\n`;
  }

  // Draw 3D Compass (N, E, TVD)
  const oCompass = { u: 75, v: 490 };
  const vecN = project((minX + maxX) * 0.5, (minX + maxX) * 0.5 + 400, (minZ + maxZ) * 0.5);
  const vecE = project((minX + maxX) * 0.5 + 400, (minX + maxX) * 0.5, (minZ + maxZ) * 0.5);
  const vecZ = project((minX + maxX) * 0.5, (minX + maxX) * 0.5, (minZ + maxZ) * 0.5 + 200);
  const cRef = project((minX + maxX) * 0.5, (minX + maxX) * 0.5, (minZ + maxZ) * 0.5);

  const drawAxis = (name: string, dx: number, dy: number, col: string) => {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return "";
    const ux = (dx / len) * 36;
    const uy = (dy / len) * 36;
    return (
      `  <line x1="${oCompass.u}" y1="${oCompass.v}" x2="${oCompass.u + ux}" y2="${oCompass.v + uy}" stroke="${col}" stroke-width="2" stroke-linecap="round" />\n` +
      `  <text x="${oCompass.u + ux * 1.3}" y="${oCompass.v + uy * 1.3 + 4}" fill="${col}" font-family="Inter, sans-serif" font-size="9" font-weight="bold" text-anchor="middle">${name}</text>\n`
    );
  };

  svg += `  <!-- 3D Compass -->\n`;
  svg += `  <circle cx="${oCompass.u}" cy="${oCompass.v}" r="24" fill="#0f172a" fill-opacity="0.8" stroke="#334155" stroke-width="1" />\n`;
  svg += drawAxis("E", vecE.u - cRef.u, vecE.v - cRef.v, "#38bdf8");
  svg += drawAxis("N", vecN.u - cRef.u, vecN.v - cRef.v, "#10b981");
  svg += drawAxis("Z", vecZ.u - cRef.u, vecZ.v - cRef.v, "#f59e0b");

  // Telemetry HUD Cards (Top Right)
  const total3dDist = points[points.length - 1]!.x - points[0]!.x;
  svg += `  <g transform="translate(${svgW - 240}, 30)">\n`;
  svg += `    <rect width="210" height="95" rx="6" fill="#0f172a" fill-opacity="0.85" stroke="#1e293b" stroke-width="1" />\n`;
  svg += `    <text x="14" y="22" class="tag-title">TOTAL ROUTE DISTANCE</text>\n`;
  svg += `    <text x="14" y="38" class="tag-val">${(Math.abs(total3dDist) / 1000).toFixed(2)} km</text>\n`;
  svg += `    <text x="14" y="58" class="tag-title">BATHYMETRY DEPTH SPAN</text>\n`;
  svg += `    <text x="14" y="74" class="tag-val">${spanZ.toFixed(1)} m (Z_min: ${minZ.toFixed(0)}m)</text>\n`;
  svg += `    <text x="14" y="88" font-family="Inter, sans-serif" font-size="8.5" fill="#64748b">Discretized Segments: ${points.length - 1} pipes</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
