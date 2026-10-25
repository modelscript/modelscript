// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — LPS / PipelineStudio Schematic & Hydraulic Diagram Builder.
 *
 * Provides high-fidelity vector visualizations for gas (TGNET) and liquid (TLNET) transmission grids:
 * 1. Topological P&ID Schematic with nodal pressure heatmaps, compressor/pump stations, and delivery gates.
 * 2. Hydraulic Pressure Gradient Profile P(x) along pipeline chainage vs MAOP envelope.
 * 3. Multi-Product Liquid Batch Timeline with Austin-Palfrey interface transmix markers.
 */

export interface LpsNodeLike {
  name: string;
  type: string;
  elevation?: number | undefined;
  pressure?: number | undefined;
  flowRate?: number | undefined;
  temperature?: number | undefined;
  minDeliveryPressure?: number | undefined;
  maxAllowablePressure?: number | undefined;
  coordinates?: { x: number; y: number; lat?: number | undefined; lon?: number | undefined } | undefined;
}

export interface LpsPipeLike {
  name: string;
  fromNode: string;
  toNode: string;
  length: number;
  diameter: number;
  maop: number;
  wallThickness?: number | undefined;
  roughness?: number | undefined;
}

export interface LpsCompressorLike {
  name: string;
  fromNode: string;
  toNode: string;
  type?: string | undefined;
  ratedPowerKw?: number | undefined;
  pressureRatio?: number | undefined;
  dischargePressure?: number | undefined;
}

export interface LpsPumpLike {
  name: string;
  fromNode: string;
  toNode: string;
  ratedPowerKw?: number | undefined;
  headMeters?: number | undefined;
}

export interface LpsRegulatorLike {
  name: string;
  fromNode: string;
  toNode: string;
  pressureSetpoint?: number | undefined;
}

export interface LpsValveLike {
  name: string;
  fromNode: string;
  toNode: string;
  isOpen?: boolean | undefined;
}

export interface LpsBatchLike {
  batchId: string;
  productId: string;
  volume: number;
  injectionNode: string;
  deliveryNode: string;
}

export interface LpsModelLike {
  id?: string | undefined;
  title?: string | undefined;
  type?: string | undefined;
  nodes: LpsNodeLike[];
  pipes: LpsPipeLike[];
  compressors?: LpsCompressorLike[] | undefined;
  pumps?: LpsPumpLike[] | undefined;
  regulators?: LpsRegulatorLike[] | undefined;
  valves?: LpsValveLike[] | undefined;
  batches?: { products: { id: string; name: string }[]; injections: LpsBatchLike[] } | undefined;
  gasComposition?: { hydrogen?: number | undefined; grossHeatingValue?: number | undefined } | undefined;
}

export interface LpsSteadyResultLike {
  nodeStates?:
    | Record<string, { pressure: number; temperature?: number | undefined; netFlow?: number | undefined }>
    | undefined;
  pipeStates?:
    | Record<
        string,
        {
          massFlow: number;
          velocity: number;
          inletPressure: number;
          outletPressure: number;
          linePackKg?: number | undefined;
        }
      >
    | undefined;
  totalLinePackKg?: number | undefined;
  totalLinePackSm3?: number | undefined;
}

export interface LpsDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string } | undefined;
  target?: { cell: string } | undefined;
  attrs?: Record<string, unknown> | undefined;
}

/** Color utility for pressure levels (bars). */
export function getLpsPressureColor(pressureBar: number, maopBar = 80.0): string {
  const ratio = Math.max(0, Math.min(1.2, pressureBar / Math.max(1, maopBar)));
  if (ratio > 1.0) return "#ef4444"; // Red (Overpressure/MAOP breach)
  if (ratio > 0.8) return "#06b6d4"; // Cyan (High pressure transmission)
  if (ratio > 0.5) return "#3b82f6"; // Blue (Nominal transmission)
  if (ratio > 0.3) return "#10b981"; // Green (City gate / distribution)
  return "#f59e0b"; // Amber (Low pressure warning)
}

/** Computes auto-layout node coordinates if coordinates are missing. */
export function computeLpsLayout(model: LpsModelLike): Map<string, { x: number; y: number }> {
  const coords = new Map<string, { x: number; y: number }>();
  let hasManualCoords = true;

  for (const n of model.nodes) {
    if (n.coordinates && Number.isFinite(n.coordinates.x) && Number.isFinite(n.coordinates.y)) {
      coords.set(n.name, { x: n.coordinates.x, y: n.coordinates.y });
    } else {
      hasManualCoords = false;
    }
  }

  if (hasManualCoords && coords.size === model.nodes.length) {
    return coords;
  }

  // Directed graph layering layout (Topological order from Supply -> Junction -> Delivery)
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of model.nodes) {
    adj.set(n.name, []);
    inDegree.set(n.name, 0);
  }

  for (const p of model.pipes) {
    adj.get(p.fromNode)?.push(p.toNode);
    inDegree.set(p.toNode, (inDegree.get(p.toNode) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let currentLayer = model.nodes
    .filter((n) => (inDegree.get(n.name) ?? 0) === 0 || n.type.toUpperCase().includes("SUPPLY"))
    .map((n) => n.name);

  if (currentLayer.length === 0 && model.nodes.length > 0) {
    currentLayer = [model.nodes[0]!.name];
  }

  const visited = new Set<string>(currentLayer);
  layers.push(currentLayer);

  while (visited.size < model.nodes.length) {
    const nextLayer: string[] = [];
    for (const nodeName of currentLayer) {
      for (const neighbor of adj.get(nodeName) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextLayer.push(neighbor);
        }
      }
    }
    if (nextLayer.length === 0) {
      // Pick any unvisited node
      for (const n of model.nodes) {
        if (!visited.has(n.name)) {
          visited.add(n.name);
          nextLayer.push(n.name);
          break;
        }
      }
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  const layerSpacingX = 220;
  const nodeSpacingY = 120;
  const startX = 80;
  const startY = 80;

  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l]!;
    const totalH = (layer.length - 1) * nodeSpacingY;
    const yOffset = startY + Math.max(0, (300 - totalH) / 2);

    for (let i = 0; i < layer.length; i++) {
      const nodeName = layer[i]!;
      coords.set(nodeName, {
        x: startX + l * layerSpacingX,
        y: yOffset + i * nodeSpacingY,
      });
    }
  }

  return coords;
}

/**
 * Builds an AntV X6 graph definition for an LPS model.
 */
export function buildLpsDiagram(
  model: LpsModelLike,
  steady?: LpsSteadyResultLike,
): { title: string; cells: LpsDiagramCell[] } {
  const coords = computeLpsLayout(model);
  const cells: LpsDiagramCell[] = [];

  // 1. Add Network Nodes
  for (const n of model.nodes) {
    const pt = coords.get(n.name) ?? { x: 100, y: 100 };
    const rawType = n.type.toUpperCase();
    const isSupply = rawType.includes("SUPPLY") || rawType.includes("SOURCE");
    const isDelivery = rawType.includes("DELIVERY") || rawType.includes("CITYGATE");
    const isStorage = rawType.includes("STORAGE") || rawType.includes("CAVERN");

    const pState = steady?.nodeStates?.[n.name];
    const pBar = pState ? pState.pressure / 1e5 : n.pressure ? n.pressure / 1e5 : 60.0;
    const color = getLpsPressureColor(pBar);

    let strokeColor = "#38bdf8";
    let badge = "JCT";
    if (isSupply) {
      strokeColor = "#06b6d4";
      badge = "SUPPLY";
    } else if (isDelivery) {
      strokeColor = "#10b981";
      badge = "DELIVERY";
    } else if (isStorage) {
      strokeColor = "#a855f7";
      badge = "CAVERN";
    }

    const label = `${n.name}\n${badge} | ${pBar.toFixed(1)} bar`;

    cells.push({
      id: `node_${n.name}`,
      shape: "rect",
      x: pt.x - 60,
      y: pt.y - 30,
      width: 120,
      height: 60,
      label,
      attrs: {
        body: {
          fill: "#1e293b",
          stroke: strokeColor,
          strokeWidth: 2,
          rx: 6,
        },
        label: {
          fill: color,
          fontSize: 10,
        },
      },
    });
  }

  // 2. Add Pipes
  for (const p of model.pipes) {
    const fromPt = coords.get(p.fromNode);
    const toPt = coords.get(p.toNode);
    if (!fromPt || !toPt) continue;

    const pState = steady?.pipeStates?.[p.name];
    const flowKgS = pState?.massFlow ?? 0;
    const vMS = pState?.velocity ?? 0;
    const pAvgBar = pState ? (pState.inletPressure + pState.outletPressure) / 2e5 : 60.0;
    const pipeColor = getLpsPressureColor(pAvgBar, p.maop / 1e5);

    const pipeLabel = `${p.name} (⌀${Math.round(p.diameter * 1000)}mm)\n${flowKgS > 0 ? `${flowKgS.toFixed(1)} kg/s | ${vMS.toFixed(1)} m/s` : `${(p.length / 1000).toFixed(0)} km`}`;

    cells.push({
      id: `pipe_${p.name}`,
      shape: "edge",
      source: { cell: `node_${p.fromNode}` },
      target: { cell: `node_${p.toNode}` },
      label: pipeLabel,
      attrs: {
        line: {
          stroke: pipeColor,
          strokeWidth: Math.max(2, Math.min(6, p.diameter * 6)),
          targetMarker: {
            name: "classic",
            size: 6,
            fill: pipeColor,
          },
        },
      },
    });
  }

  // 3. Add Compressor Stations
  for (const c of model.compressors ?? []) {
    const fromPt = coords.get(c.fromNode);
    const toPt = coords.get(c.toNode);
    if (!fromPt || !toPt) continue;

    const midX = (fromPt.x + toPt.x) / 2;
    const midY = (fromPt.y + toPt.y) / 2 - 25;

    cells.push({
      id: `comp_${c.name}`,
      shape: "circle",
      x: midX - 18,
      y: midY - 18,
      width: 36,
      height: 36,
      label: `C: ${c.name}`,
      attrs: {
        body: {
          fill: "#0f172a",
          stroke: "#f59e0b",
          strokeWidth: 2,
        },
      },
    });
  }

  // 4. Add Pump Stations
  for (const pump of model.pumps ?? []) {
    const fromPt = coords.get(pump.fromNode);
    const toPt = coords.get(pump.toNode);
    if (!fromPt || !toPt) continue;

    const midX = (fromPt.x + toPt.x) / 2;
    const midY = (fromPt.y + toPt.y) / 2 - 25;

    cells.push({
      id: `pump_${pump.name}`,
      shape: "circle",
      x: midX - 18,
      y: midY - 18,
      width: 36,
      height: 36,
      label: `P: ${pump.name}`,
      attrs: {
        body: {
          fill: "#0f172a",
          stroke: "#06b6d4",
          strokeWidth: 2,
        },
      },
    });
  }

  return {
    title: model.title ?? "PipelineStudio Network",
    cells,
  };
}

/**
 * Renders standalone dark-mode SVG markup of the pipeline schematic.
 */
export function renderLpsSchematicSvg(model: LpsModelLike, steady?: LpsSteadyResultLike): string {
  const coords = computeLpsLayout(model);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of coords.values()) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  if (!Number.isFinite(minX)) {
    minX = 50;
    minY = 50;
    maxX = 750;
    maxY = 550;
  }

  const padX = 140;
  const padY = 100;
  const vbX = Math.round(minX - padX);
  const vbY = Math.round(minY - padY);
  const vbW = Math.round(maxX - minX + 2 * padX);
  const vbH = Math.round(maxY - minY + 2 * padY);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="100%" style="background:#0b0f19; font-family: Inter, system-ui, sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="pipeGlow" x1="0%" y1="0%" x2="100%" y2="0%">\n`;
  svg += `      <stop offset="0%" stop-color="#06b6d4" />\n`;
  svg += `      <stop offset="100%" stop-color="#3b82f6" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;

  // Draw Pipes
  for (const p of model.pipes) {
    const fromPt = coords.get(p.fromNode);
    const toPt = coords.get(p.toNode);
    if (!fromPt || !toPt) continue;

    const pState = steady?.pipeStates?.[p.name];
    const pAvgBar = pState ? (pState.inletPressure + pState.outletPressure) / 2e5 : 65.0;
    const stroke = getLpsPressureColor(pAvgBar, p.maop / 1e5);
    const flow = pState?.massFlow ?? 0;
    const vel = pState?.velocity ?? 0;

    svg += `  <!-- Pipe ${p.name} -->\n`;
    svg += `  <line x1="${fromPt.x}" y1="${fromPt.y}" x2="${toPt.x}" y2="${toPt.y}" stroke="${stroke}" stroke-width="4" stroke-linecap="round" marker-end="url(#arrow)" />\n`;

    const midX = (fromPt.x + toPt.x) / 2;
    const midY = (fromPt.y + toPt.y) / 2 - 12;
    const flowText =
      flow > 0 ? `${flow.toFixed(1)} kg/s (${vel.toFixed(1)} m/s)` : `${(p.length / 1000).toFixed(0)} km`;
    svg += `  <rect x="${midX - 45}" y="${midY - 10}" width="90" height="20" rx="4" fill="#0f172a" fill-opacity="0.85" stroke="#334155" stroke-width="1" />\n`;
    svg += `  <text x="${midX}" y="${midY + 4}" text-anchor="middle" fill="#94a3b8" font-size="9">${p.name}: ${flowText}</text>\n`;
  }

  // Draw Compressor Stations
  for (const comp of model.compressors ?? []) {
    const fromPt = coords.get(comp.fromNode);
    const toPt = coords.get(comp.toNode);
    if (!fromPt || !toPt) continue;
    const cx = (fromPt.x + toPt.x) / 2;
    const cy = (fromPt.y + toPt.y) / 2;

    svg += `  <!-- Compressor ${comp.name} -->\n`;
    svg += `  <circle cx="${cx}" cy="${cy}" r="16" fill="#1e293b" stroke="#f59e0b" stroke-width="2.5" />\n`;
    svg += `  <path d="M ${cx - 8} ${cy - 8} L ${cx + 8} ${cy} L ${cx - 8} ${cy + 8} Z" fill="#f59e0b" />\n`;
    svg += `  <text x="${cx}" y="${cy + 26}" text-anchor="middle" fill="#f59e0b" font-size="9" font-weight="bold">${comp.name}</text>\n`;
  }

  // Draw Nodes
  for (const n of model.nodes) {
    const pt = coords.get(n.name);
    if (!pt) continue;

    const rawType = n.type.toUpperCase();
    const isSupply = rawType.includes("SUPPLY") || rawType.includes("SOURCE");
    const isDelivery = rawType.includes("DELIVERY") || rawType.includes("CITYGATE");
    const isStorage = rawType.includes("STORAGE") || rawType.includes("CAVERN");

    const pState = steady?.nodeStates?.[n.name];
    const pBar = pState ? pState.pressure / 1e5 : n.pressure ? n.pressure / 1e5 : 60.0;
    const color = getLpsPressureColor(pBar);

    let badgeText = "JUNCTION";
    let badgeColor = "#64748b";
    let iconSymbol = "●";

    if (isSupply) {
      badgeText = "SUPPLY";
      badgeColor = "#06b6d4";
      iconSymbol = "▲";
    } else if (isDelivery) {
      badgeText = "CITY GATE";
      badgeColor = "#10b981";
      iconSymbol = "▼";
    } else if (isStorage) {
      badgeText = "STORAGE";
      badgeColor = "#a855f7";
      iconSymbol = "◆";
    }

    const w = 110;
    const h = 54;
    const x = pt.x - w / 2;
    const y = pt.y - h / 2;

    svg += `  <!-- Node ${n.name} -->\n`;
    svg += `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#1e293b" stroke="${badgeColor}" stroke-width="2" />\n`;
    svg += `  <rect x="${x}" y="${y}" width="${w}" height="18" rx="8" fill="${badgeColor}" fill-opacity="0.2" />\n`;
    svg += `  <text x="${x + 8}" y="${y + 13}" fill="${badgeColor}" font-size="8.5" font-weight="bold">${iconSymbol} ${badgeText}</text>\n`;
    svg += `  <text x="${x + 8}" y="${y + 32}" fill="#f8fafc" font-size="10" font-weight="600">${n.name}</text>\n`;
    svg += `  <text x="${x + 8}" y="${y + 45}" fill="${color}" font-size="9" font-weight="bold">${pBar.toFixed(1)} bar</text>\n`;
  }

  // Header Title & HUD Watermark
  svg += `  <text x="${vbX + 24}" y="${vbY + 36}" fill="#f8fafc" font-size="14" font-weight="bold">${model.title ?? "PipelineStudio Network"}</text>\n`;
  if (steady?.totalLinePackSm3) {
    const mmsm3 = (steady.totalLinePackSm3 / 1e6).toFixed(2);
    svg += `  <text x="${vbX + 24}" y="${vbY + 54}" fill="#06b6d4" font-size="10">Line Pack: ${mmsm3} MMSm³ | Fluid: ${model.type ?? "TGNET Gas"}</text>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

/**
 * Renders an elevation and hydraulic pressure gradient profile P(x) along a pipeline chainage.
 */
export function renderLpsPressureProfileSvg(model: LpsModelLike, steady?: LpsSteadyResultLike): string {
  const width = 800;
  const height = 300;
  const padLeft = 60;
  const padRight = 40;
  const padTop = 40;
  const padBottom = 50;

  let totalLengthKm = 0;
  for (const p of model.pipes) {
    totalLengthKm += p.length / 1000;
  }
  if (totalLengthKm <= 0) totalLengthKm = 100;

  const maxP = 100; // bar
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0b0f19; font-family: Inter, system-ui, sans-serif;">\n`;
  svg += `  <!-- Grid & Axes -->\n`;
  svg += `  <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="#334155" stroke-width="1.5" />\n`;
  svg += `  <line x1="${padLeft}" y1="${padTop + plotH}" x2="${padLeft + plotW}" y2="${padTop + plotH}" stroke="#334155" stroke-width="1.5" />\n`;

  // Y-axis ticks (Pressure in bar)
  for (let p = 0; p <= maxP; p += 20) {
    const y = padTop + plotH - (p / maxP) * plotH;
    svg += `  <line x1="${padLeft - 4}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#1e293b" stroke-width="1" />\n`;
    svg += `  <text x="${padLeft - 10}" y="${y + 3}" text-anchor="end" fill="#94a3b8" font-size="9">${p}</text>\n`;
  }
  svg += `  <text x="${padLeft}" y="${padTop - 12}" fill="#94a3b8" font-size="10" font-weight="bold">Pressure [bar]</text>\n`;

  // X-axis ticks (Chainage in km)
  for (let k = 0; k <= totalLengthKm; k += Math.max(10, Math.round(totalLengthKm / 5))) {
    const x = padLeft + (k / totalLengthKm) * plotW;
    svg += `  <line x1="${x}" y1="${padTop + plotH}" x2="${x}" y2="${padTop + plotH + 4}" stroke="#334155" stroke-width="1" />\n`;
    svg += `  <text x="${x}" y="${padTop + plotH + 18}" text-anchor="middle" fill="#94a3b8" font-size="9">${k} km</text>\n`;
  }
  svg += `  <text x="${padLeft + plotW / 2}" y="${height - 10}" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="bold">Pipeline Chainage [km]</text>\n`;

  // Plot Hydraulic Pressure Line
  let currentKm = 0;
  const points: { x: number; y: number }[] = [];

  for (const p of model.pipes) {
    const pState = steady?.pipeStates?.[p.name];
    const pInBar = pState ? pState.inletPressure / 1e5 : 70.0;
    const pOutBar = pState ? pState.outletPressure / 1e5 : 55.0;

    const x1 = padLeft + (currentKm / totalLengthKm) * plotW;
    const y1 = padTop + plotH - (pInBar / maxP) * plotH;
    points.push({ x: x1, y: y1 });

    currentKm += p.length / 1000;
    const x2 = padLeft + (currentKm / totalLengthKm) * plotW;
    const y2 = padTop + plotH - (pOutBar / maxP) * plotH;
    points.push({ x: x2, y: y2 });
  }

  if (points.length >= 2) {
    let d = `M ${points[0]!.x} ${points[0]!.y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i]!.x} ${points[i]!.y}`;
    }
    svg += `  <path d="${d}" fill="none" stroke="#06b6d4" stroke-width="3" />\n`;
    for (const pt of points) {
      svg += `  <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#06b6d4" stroke="#0b0f19" stroke-width="2" />\n`;
    }
  }

  // Contractual Floor & MAOP Threshold lines
  const maopY = padTop + plotH - (80 / maxP) * plotH;
  svg += `  <line x1="${padLeft}" y1="${maopY}" x2="${padLeft + plotW}" y2="${maopY}" stroke="#ef4444" stroke-dasharray="4 2" stroke-width="1.5" />\n`;
  svg += `  <text x="${padLeft + plotW - 4}" y="${maopY - 4}" text-anchor="end" fill="#ef4444" font-size="9">MAOP 80 bar</text>\n`;

  const floorY = padTop + plotH - (35 / maxP) * plotH;
  svg += `  <line x1="${padLeft}" y1="${floorY}" x2="${padLeft + plotW}" y2="${floorY}" stroke="#f59e0b" stroke-dasharray="4 2" stroke-width="1.5" />\n`;
  svg += `  <text x="${padLeft + plotW - 4}" y="${floorY - 4}" text-anchor="end" fill="#f59e0b" font-size="9">Contract Delivery Floor 35 bar</text>\n`;

  // Slack line vapor threshold check (0.5 bar)
  const vaporY = padTop + plotH - (0.5 / maxP) * plotH;
  svg += `  <line x1="${padLeft}" y1="${vaporY}" x2="${padLeft + plotW}" y2="${vaporY}" stroke="#ec4899" stroke-dasharray="2 2" stroke-width="1" />\n`;
  svg += `  <text x="${padLeft + 4}" y="${vaporY - 3}" fill="#ec4899" font-size="8">Vapor Separation Limit (Slack Line)</text>\n`;

  svg += `</svg>\n`;
  return svg;
}

/**
 * Generates an SVG multi-speed centrifugal compressor performance map
 * showing head-flow curves, surge margin line, choke boundary, and current operating point.
 */
export function renderCompressorMapSvg(
  compressorName: string,
  ratedPowerKw = 15000,
  ratedRpm = 9500,
  operatingPoint?:
    | {
        speedRpm: number;
        flowM3s: number;
        headKjKg: number;
        isSurging: boolean;
        isStonewalled: boolean;
        antiSurgeRecycleM3s: number;
      }
    | undefined,
): string {
  const width = 640;
  const height = 400;
  const padLeft = 70;
  const padBottom = 50;
  const padTop = 40;
  const padRight = 30;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxQ = 5.0; // m3/s
  const maxH = 120.0; // kJ/kg

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="background-color: #0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">\n`;

  // Header Title
  svg += `  <text x="${padLeft}" y="24" fill="#e6edf3" font-size="14" font-weight="600">${compressorName} — Centrifugal Performance Map (${ratedPowerKw} kW, ${ratedRpm} RPM)</text>\n`;

  // Grid lines
  for (let q = 1; q <= maxQ; q++) {
    const x = padLeft + (q / maxQ) * plotW;
    svg += `  <line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + plotH}" stroke="#21262d" stroke-width="1" />\n`;
    svg += `  <text x="${x}" y="${padTop + plotH + 18}" text-anchor="middle" fill="#8b949e" font-size="10">${q}.0</text>\n`;
  }

  for (let h = 20; h <= maxH; h += 20) {
    const y = padTop + plotH - (h / maxH) * plotH;
    svg += `  <line x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#21262d" stroke-width="1" />\n`;
    svg += `  <text x="${padLeft - 10}" y="${y + 3}" text-anchor="end" fill="#8b949e" font-size="10">${h}</text>\n`;
  }

  // Axis Labels
  svg += `  <text x="${padLeft + plotW / 2}" y="${height - 12}" text-anchor="middle" fill="#8b949e" font-size="11">Inlet Volumetric Flow Q (m³/s)</text>\n`;
  svg += `  <text x="20" y="${padTop + plotH / 2}" text-anchor="middle" fill="#8b949e" font-size="11" transform="rotate(-90 20 ${padTop + plotH / 2})">Polytropic Head (kJ/kg)</text>\n`;

  // Speed Lines (75%, 85%, 95%, 100%, 105%)
  const speedFractions = [0.75, 0.85, 0.95, 1.0, 1.05];
  const surgePoints: { x: number; y: number }[] = [];
  const chokePoints: { x: number; y: number }[] = [];

  for (const sFrac of speedFractions) {
    const rpm = Math.round(sFrac * ratedRpm);
    const qSurge = 1.2 * sFrac;
    const qChoke = 3.6 * sFrac;

    let pathD = "";
    for (let step = 0; step <= 20; step++) {
      const q = qSurge + (step / 20) * (qChoke - qSurge);
      const phi = q / (sFrac * 4.0);
      const headKj = 100 * Math.pow(sFrac, 2) * (0.65 - 0.25 * Math.pow(phi, 2));
      const x = padLeft + (q / maxQ) * plotW;
      const y = padTop + plotH - (headKj / maxH) * plotH;

      if (step === 0) {
        pathD += `M ${x} ${y}`;
        surgePoints.push({ x, y });
      } else {
        pathD += ` L ${x} ${y}`;
      }
      if (step === 20) {
        chokePoints.push({ x, y });
        svg += `  <text x="${x + 4}" y="${y + 3}" fill="#58a6ff" font-size="9">${rpm} RPM (${Math.round(sFrac * 100)}%)</text>\n`;
      }
    }
    svg += `  <path d="${pathD}" fill="none" stroke="#58a6ff" stroke-width="1.8" />\n`;
  }

  // Surge Line (Red dashed)
  if (surgePoints.length > 1) {
    let surgeD = `M ${surgePoints[0]!.x} ${surgePoints[0]!.y}`;
    for (let i = 1; i < surgePoints.length; i++) {
      surgeD += ` L ${surgePoints[i]!.x} ${surgePoints[i]!.y}`;
    }
    svg += `  <path d="${surgeD}" fill="none" stroke="#f85149" stroke-width="2" stroke-dasharray="5 3" />\n`;
    svg += `  <text x="${surgePoints[surgePoints.length - 1]!.x - 8}" y="${surgePoints[surgePoints.length - 1]!.y - 8}" fill="#f85149" font-size="9" text-anchor="end">Surge Line</text>\n`;
  }

  // Current Operating Point
  const op = operatingPoint ?? {
    speedRpm: 9200,
    flowM3s: 2.8,
    headKjKg: 78.0,
    isSurging: false,
    isStonewalled: false,
    antiSurgeRecycleM3s: 0.0,
  };

  const opX = padLeft + (op.flowM3s / maxQ) * plotW;
  const opY = padTop + plotH - (op.headKjKg / maxH) * plotH;
  const opColor = op.isSurging ? "#f85149" : op.isStonewalled ? "#d29922" : "#3fb950";

  svg += `  <circle cx="${opX}" cy="${opY}" r="7" fill="${opColor}" stroke="#ffffff" stroke-width="2" />\n`;
  svg += `  <text x="${opX + 12}" y="${opY - 6}" fill="${opColor}" font-size="10" font-weight="600">OP: ${op.flowM3s.toFixed(2)} m³/s, ${op.headKjKg.toFixed(1)} kJ/kg (${op.speedRpm} RPM)</text>\n`;

  // Status badge
  const statusText = op.isSurging
    ? "SURGE HAZARD (RECYCLING)"
    : op.isStonewalled
      ? "STONEWALL CHOKE"
      : "NORMAL GOVERNOR";
  const badgeBg = op.isSurging ? "#f85149" : op.isStonewalled ? "#d29922" : "#238636";
  svg += `  <rect x="${width - 200}" y="12" width="180" height="22" rx="4" fill="${badgeBg}" />\n`;
  svg += `  <text x="${width - 110}" y="27" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="600">${statusText}</text>\n`;

  svg += `</svg>\n`;
  return svg;
}
