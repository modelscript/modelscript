// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Polyglot Pharmacometrics & PK/PD Compartment Diagram Builder.
 *
 * Translates Monolix MLXTRAN and NONMEM NMTRAN models into interactive AntV X6 graphs and standalone SVGs:
 * 1. Depot, Central, Peripheral, and Excretion compartments as themed rounded containers.
 * 2. Absorption, distribution (inter-compartmental clearance Q), and elimination (CL) pipes.
 * 3. IV bolus, zero-order infusion, and extravascular oral dosing ports.
 */

export type PkCompartmentRole = "depot" | "central" | "peripheral" | "excretion";

export interface PkCompartmentNode {
  id: string;
  name: string;
  role: PkCompartmentRole;
  volumeParam?: string | undefined;
  volumeValue?: number | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  trajectory?: { times: number[]; values: number[] } | undefined;
  sparklineSvg?: string | undefined;
  peakConcentration?: number | undefined;
  unit?: string | undefined;
}

export interface PkTransferEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  bidirectional?: boolean | undefined;
  rateParam?: string | undefined;
  clearanceParam?: string | undefined;
}

export interface PkDosingPort {
  id: string;
  target: string;
  route: "oral" | "iv" | "infusion";
  label: string;
}

export interface PkDiagramGraph {
  title: string;
  compartments: PkCompartmentNode[];
  transfers: PkTransferEdge[];
  dosings: PkDosingPort[];
  width: number;
  height: number;
}

export function buildPkDiagramFromGeneric(options: {
  title?: string | undefined;
  hasDepot?: boolean | undefined;
  hasPeripheral?: boolean | undefined;
  peripheralCount?: number | undefined;
  params?: Record<string, number | string> | undefined;
}): PkDiagramGraph {
  const title = options.title ?? "Pharmacokinetic Compartment Model";
  const hasDepot = options.hasDepot ?? false;
  const pCount = options.peripheralCount ?? (options.hasPeripheral ? 1 : 0);

  const compartments: PkCompartmentNode[] = [];
  const transfers: PkTransferEdge[] = [];
  const dosings: PkDosingPort[] = [];

  const boxW = 150;
  const boxH = 90;
  const startY = 120;

  let curX = 60;

  // 1. Depot compartment
  if (hasDepot) {
    compartments.push({
      id: "depot",
      name: "Depot / GI Tract",
      role: "depot",
      x: curX,
      y: startY,
      width: boxW,
      height: boxH,
    });

    dosings.push({
      id: "dose_oral",
      target: "depot",
      route: "oral",
      label: "Oral Dose (Tablet / Liquid)",
    });

    curX += boxW + 80;
  }

  // 2. Central compartment
  const centralX = curX;
  compartments.push({
    id: "central",
    name: "Central Blood Plasma",
    role: "central",
    volumeParam: "V",
    x: centralX,
    y: startY,
    width: boxW + 20,
    height: boxH + 10,
  });

  if (hasDepot) {
    transfers.push({
      id: "absorption",
      from: "depot",
      to: "central",
      label: "Absorption (ka)",
      rateParam: "ka",
    });
  } else {
    dosings.push({
      id: "dose_iv",
      target: "central",
      route: "iv",
      label: "IV Bolus / Infusion",
    });
  }

  // 3. Elimination Sink
  const elimX = centralX;
  const elimY = startY + boxH + 90;
  compartments.push({
    id: "elimination",
    name: "Elimination / Clearance",
    role: "excretion",
    x: elimX + 15,
    y: elimY,
    width: boxW - 10,
    height: boxH - 20,
  });

  transfers.push({
    id: "elim",
    from: "central",
    to: "elimination",
    label: "Elimination (CL / V)",
    clearanceParam: "CL",
  });

  // 4. Peripheral compartments
  curX = centralX + boxW + 90;
  for (let p = 1; p <= pCount; p++) {
    const pId = `peripheral_${p}`;
    const pY = startY + (p - 1) * (boxH + 50);
    compartments.push({
      id: pId,
      name: `Peripheral Tissue ${p}`,
      role: "peripheral",
      volumeParam: p === 1 ? "V2" : `V${p + 1}`,
      x: curX,
      y: pY,
      width: boxW,
      height: boxH,
    });

    transfers.push({
      id: `dist_${p}`,
      from: "central",
      to: pId,
      label: p === 1 ? "Distribution (Q / V1 ↔ Q / V2)" : `Distribution (Q${p})`,
      bidirectional: true,
      clearanceParam: p === 1 ? "Q" : `Q${p}`,
    });
  }

  const totalW = Math.max(800, curX + boxW + 80);
  const totalH = Math.max(500, elimY + boxH + 60);

  return {
    title,
    compartments,
    transfers,
    dosings,
    width: totalW,
    height: totalH,
  };
}

export function renderPkDiagramSvg(graph: PkDiagramGraph, isDark = true): string {
  const bg = isDark ? "#090d16" : "#ffffff";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${graph.width} ${graph.height}" width="100%" height="100%" style="background:${bg};font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;">\n`;

  // Defs & Markers
  svg += `  <defs>\n`;
  svg += `    <marker id="pk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `    <marker id="elim-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />\n`;
  svg += `    </marker>\n`;
  svg += `    <marker id="dose-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;

  // Title Banner
  svg += `  <text x="50" y="40" fill="${textColor}" font-size="18" font-weight="700">${graph.title}</text>\n`;
  svg += `  <text x="50" y="60" fill="${subTextColor}" font-size="11">Pharmacometric ADME Compartments, Clearances &amp; Kinetic Transfers</text>\n`;

  const nodeMap = new Map<string, PkCompartmentNode>();
  for (const c of graph.compartments) {
    nodeMap.set(c.id, c);
  }

  // Draw Transfers
  for (const tr of graph.transfers) {
    const from = nodeMap.get(tr.from);
    const to = nodeMap.get(tr.to);
    if (!from || !to) continue;

    const isElim = tr.id === "elim" || to.role === "excretion";
    const stroke = isElim ? "#ef4444" : "#38bdf8";
    const marker = isElim ? "url(#elim-arrow)" : "url(#pk-arrow)";

    // Calculate connector points
    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;

    if (isElim) {
      x1 = from.x + from.width / 2;
      y1 = from.y + from.height;
      x2 = to.x + to.width / 2;
      y2 = to.y;
    } else {
      x1 = from.x + from.width;
      y1 = from.y + from.height / 2;
      x2 = to.x;
      y2 = to.y + to.height / 2;
    }

    svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="2.5" marker-end="${marker}" />\n`;
    if (tr.bidirectional) {
      svg += `  <line x1="${x2}" y1="${y2 - 10}" x2="${x1}" y2="${y1 - 10}" stroke="${stroke}" stroke-width="2.5" marker-end="${marker}" stroke-dasharray="4,3" />\n`;
    }

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 12;
    svg += `  <rect x="${midX - 50}" y="${midY - 10}" width="100" height="20" rx="4" fill="${isDark ? "#1e293b" : "#e2e8f0"}" stroke="${stroke}" stroke-width="1" />\n`;
    svg += `  <text x="${midX}" y="${midY + 4}" fill="${textColor}" font-size="9" font-weight="600" text-anchor="middle">${tr.label}</text>\n`;
  }

  // Draw Dosing Ports
  for (const d of graph.dosings) {
    const target = nodeMap.get(d.target);
    if (!target) continue;

    const x1 = target.x + target.width / 2;
    const y1 = target.y - 45;
    const x2 = target.x + target.width / 2;
    const y2 = target.y;

    svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#10b981" stroke-width="3" marker-end="url(#dose-arrow)" />\n`;
    svg += `  <circle cx="${x1}" cy="${y1}" r="5" fill="#10b981" />\n`;
    svg += `  <text x="${x1}" y="${y1 - 10}" fill="#10b981" font-size="10" font-weight="700" text-anchor="middle">${d.label}</text>\n`;
  }

  // Draw Compartments
  for (const c of graph.compartments) {
    let strokeColor = "#38bdf8";
    let headerBg = isDark ? "#0369a1" : "#bae6fd";
    let bodyBg = isDark ? "rgba(15, 23, 42, 0.85)" : "#f8fafc";

    if (c.role === "depot") {
      strokeColor = "#f59e0b";
      headerBg = isDark ? "#b45309" : "#fde68a";
    } else if (c.role === "central") {
      strokeColor = "#3b82f6";
      headerBg = isDark ? "#1d4ed8" : "#bfdbfe";
    } else if (c.role === "peripheral") {
      strokeColor = "#10b981";
      headerBg = isDark ? "#047857" : "#a7f3d0";
    } else if (c.role === "excretion") {
      strokeColor = "#ef4444";
      headerBg = isDark ? "#b91c1c" : "#fecaca";
    }

    svg += `  <!-- Compartment: ${c.name} -->\n`;
    svg += `  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="10" ry="10" fill="${bodyBg}" stroke="${strokeColor}" stroke-width="2.5" />\n`;
    svg += `  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="28" rx="10" ry="10" fill="${headerBg}" opacity="0.4" />\n`;
    svg += `  <path d="M ${c.x} ${c.y + 28} L ${c.x + c.width} ${c.y + 28}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `  <text x="${c.x + 12}" y="${c.y + 19}" fill="${textColor}" font-size="11" font-weight="700">${c.name}</text>\n`;

    if (c.volumeParam) {
      svg += `  <text x="${c.x + 12}" y="${c.y + 48}" fill="${subTextColor}" font-size="9.5">Volume: ${c.volumeParam}</text>\n`;
    }
    if (c.sparklineSvg) {
      svg += `  <g transform="translate(${c.x + c.width - 55}, ${c.y + 36})">\n`;
      svg += `    ${c.sparklineSvg}\n`;
      svg += `  </g>\n`;
    }
    if (c.peakConcentration !== undefined) {
      svg += `  <text x="${c.x + 12}" y="${c.y + 64}" fill="${strokeColor}" font-size="9" font-weight="600">Cmax: ${c.peakConcentration.toFixed(2)}</text>\n`;
    } else {
      svg += `  <text x="${c.x + 12}" y="${c.y + 66}" fill="${subTextColor}" font-size="9">ID: ${c.id}</text>\n`;
    }
  }

  svg += `</svg>\n`;
  return svg;
}

/**
 * Linear interpolation helper for simulation trajectory points.
 */
export function interpolatePkConcentration(times: number[], values: number[], targetTime: number): number {
  if (times.length === 0 || values.length === 0) return 0;
  if (times.length === 1 || targetTime <= (times[0] ?? 0)) return values[0] ?? 0;
  const lastIdx = times.length - 1;
  if (targetTime >= (times[lastIdx] ?? 0)) return values[lastIdx] ?? 0;

  // Binary search for interval
  let low = 0;
  let high = lastIdx;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const tMid = times[mid] ?? 0;
    if (tMid <= targetTime && targetTime <= (times[mid + 1] ?? 0)) {
      const t0 = times[mid] ?? 0;
      const t1 = times[mid + 1] ?? 1;
      const v0 = values[mid] ?? 0;
      const v1 = values[mid + 1] ?? 0;
      const fraction = t1 > t0 ? (targetTime - t0) / (t1 - t0) : 0;
      return v0 + fraction * (v1 - v0);
    }
    if (tMid < targetTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return values[lastIdx] ?? 0;
}

export interface PkSparklineOptions {
  width?: number | undefined;
  height?: number | undefined;
  lineColor?: string | undefined;
  strokeColor?: string | undefined;
  currentTime?: number | undefined;
  asSvgRoot?: boolean | undefined;
}

export interface PkStreamingState {
  currentTime: number;
  trajectories?: Record<string, { times: number[]; values: number[] }> | undefined;
  isPlaying?: boolean | undefined;
  playSpeed?: number | undefined;
  theme?: "light" | "dark" | undefined;
}

/**
 * Generates an inline SVG polyline sparkline representing concentration dynamics.
 */
export function renderPkSparklineSvg(
  times: number[],
  values: number[],
  widthOrOptions?: number | PkSparklineOptions | undefined,
  heightArg = 32,
  strokeColorArg = "#38bdf8",
  currentTimeArg?: number | undefined,
): string {
  if (times.length < 2 || values.length < 2) return "";

  let width = 50;
  let height = heightArg;
  let strokeColor = strokeColorArg;
  let currentTime = currentTimeArg;
  let asSvgRoot = false;

  if (typeof widthOrOptions === "object" && widthOrOptions !== null) {
    width = widthOrOptions.width ?? 50;
    height = widthOrOptions.height ?? 32;
    strokeColor = widthOrOptions.lineColor ?? widthOrOptions.strokeColor ?? "#38bdf8";
    currentTime = widthOrOptions.currentTime;
    asSvgRoot = widthOrOptions.asSvgRoot ?? true;
  } else if (typeof widthOrOptions === "number") {
    width = widthOrOptions;
  }

  const minT = times[0] ?? 0;
  const maxT = times[times.length - 1] ?? 1;
  const rangeT = maxT > minT ? maxT - minT : 1;

  const minV = 0;
  const maxV = Math.max(...values, 1e-6);
  const rangeV = maxV > minV ? maxV - minV : 1;

  const points: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i] ?? 0;
    const v = values[i] ?? 0;
    const px = ((t - minT) / rangeT) * width;
    const py = height - ((v - minV) / rangeV) * (height - 6) - 3;
    points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }

  let scrubLine = "";
  if (currentTime !== undefined && currentTime >= minT && currentTime <= maxT) {
    const scrubX = (((currentTime - minT) / rangeT) * width).toFixed(1);
    scrubLine = `<line x1="${scrubX}" y1="0" x2="${scrubX}" y2="${height}" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="2,1" /><circle cx="${scrubX}" cy="${(height / 2).toFixed(1)}" r="2" fill="#f59e0b" />`;
  }

  const inner = `<polyline points="${points.join(" ")}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />${scrubLine}`;
  if (asSvgRoot) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${inner}</svg>`;
  }
  return inner;
}

/**
 * Attaches numerical simulation trajectories directly to PK diagram compartments,
 * generating mini sparkline waveform overlays and computing Cmax.
 */
export function attachSimulationTrajectoryToPkDiagram(
  graph: PkDiagramGraph,
  trajectories?: Record<string, { times: number[]; values: number[] }> | undefined,
  currentTime?: number,
): PkDiagramGraph {
  if (!trajectories) {
    // Re-render sparklines with currentTime if compartments already have trajectories
    for (const c of graph.compartments) {
      if (c.trajectory && c.trajectory.values.length > 0) {
        let color = "#3b82f6";
        if (c.role === "depot") color = "#f59e0b";
        else if (c.role === "peripheral") color = "#10b981";
        else if (c.role === "excretion") color = "#ef4444";
        c.sparklineSvg = renderPkSparklineSvg(c.trajectory.times, c.trajectory.values, 50, 32, color, currentTime);
      }
    }
    return graph;
  }

  for (const c of graph.compartments) {
    const traj =
      trajectories[c.id] ||
      trajectories[c.name.toLowerCase()] ||
      trajectories[`A_${c.id}`] ||
      trajectories[`C_${c.id}`];
    if (traj && traj.values.length > 0) {
      c.trajectory = traj;
      c.peakConcentration = Math.max(...traj.values);
      let color = "#3b82f6";
      if (c.role === "depot") color = "#f59e0b";
      else if (c.role === "peripheral") color = "#10b981";
      else if (c.role === "excretion") color = "#ef4444";
      c.sparklineSvg = renderPkSparklineSvg(traj.times, traj.values, 50, 32, color, currentTime);
    }
  }
  return graph;
}

/**
 * Renders an enhanced standalone SVG of the PK compartment diagram with animated
 * concentration intensity wash, scrub bar timeline, and live state values.
 */
export function renderPkDiagramSvgWithStreaming(
  graph: PkDiagramGraph,
  streamState: PkStreamingState,
  isDarkArg = true,
): string {
  // Update graph with current trajectories and scrubber
  attachSimulationTrajectoryToPkDiagram(graph, streamState.trajectories, streamState.currentTime);

  const isDark = streamState.theme ? streamState.theme === "dark" : isDarkArg;
  const bg = isDark ? "#090d16" : "#ffffff";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${graph.width} ${graph.height + 40}" width="100%" height="100%" style="background:${bg};font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;">\n`;

  // Defs & Markers
  svg += `  <defs>\n`;
  svg += `    <marker id="pk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `    <marker id="elim-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />\n`;
  svg += `    </marker>\n`;
  svg += `    <marker id="dose-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />\n`;
  svg += `    </marker>\n`;
  svg += `    <filter id="node-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feGaussianBlur stdDeviation="6" result="blur" />\n`;
  svg += `      <feComposite in="SourceGraphic" in2="blur" operator="over" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n`;

  // Title Banner with Simulation Scrub Status
  svg += `  <text x="50" y="38" fill="${textColor}" font-size="18" font-weight="700">${graph.title}</text>\n`;
  svg += `  <text x="50" y="58" fill="${subTextColor}" font-size="11">Pharmacometric ADME Compartments, Clearances &amp; Live Simulation Stream</text>\n`;

  // Timeline Scrubber Indicator Banner
  const scrubBadgeX = graph.width - 240;
  svg += `  <rect x="${scrubBadgeX}" y="20" width="190" height="38" rx="6" fill="${isDark ? "#1e293b" : "#e2e8f0"}" stroke="#38bdf8" stroke-width="1.5" />\n`;
  svg += `  <circle cx="${scrubBadgeX + 18}" cy="39" r="6" fill="#10b981" />\n`;
  svg += `  <text x="${scrubBadgeX + 32}" y="36" fill="${textColor}" font-size="10" font-weight="700">t = ${streamState.currentTime.toFixed(2)} h</text>\n`;
  svg += `  <text x="${scrubBadgeX + 32}" y="49" fill="${subTextColor}" font-size="8.5">Stream: ${streamState.isPlaying ? "PLAYING" : "PAUSED"} (${(streamState.playSpeed ?? 1.0).toFixed(1)}x)</text>\n`;

  const nodeMap = new Map<string, PkCompartmentNode>();
  for (const c of graph.compartments) {
    nodeMap.set(c.id, c);
  }

  // Draw Transfers
  for (const tr of graph.transfers) {
    const from = nodeMap.get(tr.from);
    const to = nodeMap.get(tr.to);
    if (!from || !to) continue;

    const isElim = tr.id === "elim" || to.role === "excretion";
    const stroke = isElim ? "#ef4444" : "#38bdf8";
    const marker = isElim ? "url(#elim-arrow)" : "url(#pk-arrow)";

    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;

    if (isElim) {
      x1 = from.x + from.width / 2;
      y1 = from.y + from.height;
      x2 = to.x + to.width / 2;
      y2 = to.y;
    } else {
      x1 = from.x + from.width;
      y1 = from.y + from.height / 2;
      x2 = to.x;
      y2 = to.y + to.height / 2;
    }

    svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="2.5" marker-end="${marker}" />\n`;
    if (tr.bidirectional) {
      svg += `  <line x1="${x2}" y1="${y2 - 10}" x2="${x1}" y2="${y1 - 10}" stroke="${stroke}" stroke-width="2.5" marker-end="${marker}" stroke-dasharray="4,3" />\n`;
    }

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 12;
    svg += `  <rect x="${midX - 50}" y="${midY - 10}" width="100" height="20" rx="4" fill="${isDark ? "#1e293b" : "#e2e8f0"}" stroke="${stroke}" stroke-width="1" />\n`;
    svg += `  <text x="${midX}" y="${midY + 4}" fill="${textColor}" font-size="9" font-weight="600" text-anchor="middle">${tr.label}</text>\n`;
  }

  // Draw Dosing Ports
  for (const d of graph.dosings) {
    const target = nodeMap.get(d.target);
    if (!target) continue;

    const x1 = target.x + target.width / 2;
    const y1 = target.y - 45;
    const x2 = target.x + target.width / 2;
    const y2 = target.y;

    svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#10b981" stroke-width="3" marker-end="url(#dose-arrow)" />\n`;
    svg += `  <circle cx="${x1}" cy="${y1}" r="5" fill="#10b981" />\n`;
    svg += `  <text x="${x1}" y="${y1 - 10}" fill="#10b981" font-size="10" font-weight="700" text-anchor="middle">${d.label}</text>\n`;
  }

  // Draw Compartments with dynamic wash intensity
  for (const c of graph.compartments) {
    let strokeColor = "#38bdf8";
    let headerBg = isDark ? "#0369a1" : "#bae6fd";
    let baseBodyBg = isDark ? "rgba(15, 23, 42, 0.9)" : "#f8fafc";

    if (c.role === "depot") {
      strokeColor = "#f59e0b";
      headerBg = isDark ? "#b45309" : "#fde68a";
    } else if (c.role === "central") {
      strokeColor = "#3b82f6";
      headerBg = isDark ? "#1d4ed8" : "#bfdbfe";
    } else if (c.role === "peripheral") {
      strokeColor = "#10b981";
      headerBg = isDark ? "#047857" : "#a7f3d0";
    } else if (c.role === "excretion") {
      strokeColor = "#ef4444";
      headerBg = isDark ? "#b91c1c" : "#fecaca";
    }

    // Compute instantaneous value and pulse intensity
    let instVal = 0;
    let intensity = 0;
    if (c.trajectory && c.trajectory.times.length > 0) {
      instVal = interpolatePkConcentration(c.trajectory.times, c.trajectory.values, streamState.currentTime);
      const cMax = c.peakConcentration ?? 1;
      intensity = cMax > 0 ? Math.min(1, Math.max(0, instVal / cMax)) : 0;
    }

    const washAlpha = (0.08 + intensity * 0.35).toFixed(2);
    const filterAttr = intensity > 0.4 ? 'filter="url(#node-glow)"' : "";

    svg += `  <!-- Compartment: ${c.name} -->\n`;
    svg += `  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="10" ry="10" fill="${baseBodyBg}" stroke="${strokeColor}" stroke-width="${(2 + intensity * 2).toFixed(1)}" ${filterAttr} />\n`;
    // Pulsing gradient wash overlay
    svg += `  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="10" ry="10" fill="${strokeColor}" opacity="${washAlpha}" />\n`;
    svg += `  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="28" rx="10" ry="10" fill="${headerBg}" opacity="0.45" />\n`;
    svg += `  <path d="M ${c.x} ${c.y + 28} L ${c.x + c.width} ${c.y + 28}" stroke="${strokeColor}" stroke-width="1.5" />\n`;
    svg += `  <text x="${c.x + 12}" y="${c.y + 19}" fill="${textColor}" font-size="11" font-weight="700">${c.name}</text>\n`;

    if (c.volumeParam) {
      svg += `  <text x="${c.x + 12}" y="${c.y + 46}" fill="${subTextColor}" font-size="9">Vol: ${c.volumeParam}</text>\n`;
    }
    if (c.sparklineSvg) {
      svg += `  <g transform="translate(${c.x + c.width - 60}, ${c.y + 34})">\n`;
      svg += `    ${c.sparklineSvg}\n`;
      svg += `  </g>\n`;
    }

    // Instantaneous concentration badge
    const unitLabel = c.unit ?? (c.role === "depot" ? "mg" : "mg/L");
    svg += `  <text x="${c.x + 12}" y="${c.y + 64}" fill="${strokeColor}" font-size="10" font-weight="700">C(t): ${instVal.toFixed(2)} ${unitLabel}</text>\n`;
    if (c.peakConcentration !== undefined) {
      svg += `  <text x="${c.x + 12}" y="${c.y + 78}" fill="${subTextColor}" font-size="8.5">Cmax: ${c.peakConcentration.toFixed(2)} ${unitLabel}</text>\n`;
    }
  }

  svg += `</svg>\n`;
  return svg;
}

export type PkDiagramReconcileAction =
  | {
      type: "add_peripheral";
      compartmentName?: string | undefined;
      v2Param?: string | undefined;
      qParam?: string | undefined;
    }
  | { type: "remove_peripheral"; compartmentName?: string | undefined; id?: string | undefined }
  | { type: "add_depot"; kaParam?: string | undefined; kaValue?: number | undefined }
  | { type: "remove_depot" }
  | { type: "update_parameter"; name: string; value: number }
  | {
      type: "update_volume";
      compartmentId: string;
      volumeParam?: string | undefined;
      volume?: number | undefined;
      value?: number | undefined;
    }
  | {
      type: "connect_clearance";
      from?: string | undefined;
      to?: string | undefined;
      sourceId?: string | undefined;
      clearanceParam?: string | undefined;
      clParam?: string | undefined;
      value?: number | undefined;
    }
  | { type: "add_dosing"; targetId: string; route: "iv" | "oral"; rateOrKa?: number | undefined };

/**
 * Reconciles visual diagram modifications directly back into MLXTRAN source code (Bi-directional editing).
 */
export function reconcilePkDiagramChangeToMlxtran(sourceText: string, action: PkDiagramReconcileAction): string {
  let updated = sourceText;

  if (action.type === "add_peripheral") {
    const v2 = action.v2Param ?? "V2";
    const q = action.qParam ?? "Q";

    // 1. Add parameters to input = { ... }
    const inputMatch = updated.match(/input\s*=\s*\{([^}]*)\}/);
    if (inputMatch) {
      const existing = inputMatch[1]?.trim() ?? "";
      if (!existing.includes(v2)) {
        const newInputs = existing ? `${existing}, ${v2} = 20.0, ${q} = 5.0` : `${v2} = 20.0, ${q} = 5.0`;
        updated = updated.replace(inputMatch[0], `input = {${newInputs}}`);
      }
    }

    // 2. Add peripheral ODE to EQUATION:
    const eqHeaderMatch = updated.match(/EQUATION:/);
    if (eqHeaderMatch) {
      const periphOde = `\n; Peripheral compartment kinetics\nddt_A_peripheral = (${q} / V) * A_central - (${q} / ${v2}) * A_peripheral\n`;
      updated = updated.replace(/EQUATION:/, `EQUATION:${periphOde}`);

      // 3. Connect peripheral transfer to central compartment
      updated = updated.replace(
        /(ddt_A_central\s*=[^\n;]*)/,
        `$1 - (${q} / V) * A_central + (${q} / ${v2}) * A_peripheral`,
      );
    }
  } else if (action.type === "remove_peripheral") {
    // Remove peripheral ODE line
    updated = updated.replace(/\nddt_A_peripheral\s*=[^\n]*/g, "");
    // Remove peripheral terms from central ODE
    updated = updated.replace(/\s*-\s*\([^)]*\)\s*\*\s*A_central\s*\+\s*\([^)]*\)\s*\*\s*A_peripheral/g, "");
  } else if (action.type === "add_depot") {
    const ka = action.kaParam ?? "ka";
    const kaVal = action.kaValue ?? 1.0;
    const formattedKa = Number.isInteger(kaVal) ? `${kaVal}.0` : `${kaVal}`;

    const inputMatch = updated.match(/input\s*=\s*\{([^}]*)\}/);
    if (inputMatch) {
      const existing = inputMatch[1]?.trim() ?? "";
      if (!existing.includes(ka)) {
        const newInputs = existing ? `${existing}, ${ka} = ${formattedKa}` : `${ka} = ${formattedKa}`;
        updated = updated.replace(inputMatch[0], `input = {${newInputs}}`);
      }
    }

    const eqHeaderMatch = updated.match(/EQUATION:/);
    if (eqHeaderMatch) {
      const depotOde = `\n; Depot extravascular absorption\nddt_A_depot = -${ka} * A_depot\n`;
      updated = updated.replace(/EQUATION:/, `EQUATION:${depotOde}`);
      updated = updated.replace(/(ddt_A_central\s*=[^\n;]*)/, `$1 + ${ka} * A_depot`);
    }
  } else if (action.type === "remove_depot") {
    updated = updated.replace(/\nddt_A_depot\s*=[^\n]*/g, "");
    updated = updated.replace(/\s*\+\s*ka\s*\*\s*A_depot/g, "");
  } else if (action.type === "update_parameter" || action.type === "update_volume") {
    let name = "";
    let val = 0;
    if (action.type === "update_parameter") {
      name = action.name;
      val = action.value;
    } else {
      name = action.volumeParam ?? (action.compartmentId === "central" ? "V" : "V2");
      val = action.value ?? action.volume ?? 10.0;
    }
    const paramRegex = new RegExp(`(${name}\\s*=\\s*)[0-9.]+`);
    if (paramRegex.test(updated)) {
      updated = updated.replace(paramRegex, `$1${val}`);
    } else {
      const inputMatch = updated.match(/input\s*=\s*\{([^}]*)\}/);
      if (inputMatch) {
        const existing = inputMatch[1]?.trim() ?? "";
        const replaced = existing ? `${existing}, ${name} = ${val}` : `${name} = ${val}`;
        updated = updated.replace(inputMatch[0], `input = {${replaced}}`);
      }
    }
  } else if (action.type === "connect_clearance") {
    const qName = action.clearanceParam ?? action.clParam ?? "Cl";
    const qVal = action.value ?? 10.0;
    const inputMatch = updated.match(/input\s*=\s*\{([^}]*)\}/);
    if (inputMatch) {
      const existing = inputMatch[1]?.trim() ?? "";
      if (!existing.includes(qName)) {
        const newInputs = existing ? `${existing}, ${qName} = ${qVal}` : `${qName} = ${qVal}`;
        updated = updated.replace(inputMatch[0], `input = {${newInputs}}`);
      }
    }
  } else if (action.type === "add_dosing") {
    const macroCall =
      action.route === "iv" ? "iv(cmt=1)" : `oral(cmt=1${action.rateOrKa ? `, ka=${action.rateOrKa}` : ""})`;
    if (updated.includes("[PK]")) {
      updated = updated.replace(/(\[PK\][^\n]*\n)/, `$1${macroCall}\n`);
    } else if (updated.includes("[LONGITUDINAL]")) {
      updated = updated.replace(/(\[LONGITUDINAL\][^\n]*\n)/, `[PK]\n${macroCall}\n\n$1`);
    } else {
      updated = `[PK]\n${macroCall}\n\n${updated}`;
    }
  }

  return updated;
}
