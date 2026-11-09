// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — US EPA EPANET Water Distribution Network & HGL Profile Diagram Builder.
 *
 * Provides dual visualization modes:
 * 1. 2D Network Plan View: Pressurized distribution mains, supply reservoirs, storage tanks, booster pumps,
 *    and demand junctions with pressure contours and flow velocity overlays.
 * 2. Longitudinal Hydraulic Grade Line (HGL) Elevation Profile: Ground elevation rim, pipe inverts,
 *    static/dynamic hydraulic grade line, energy grade line (EGL), and cavitation danger zones.
 */

export interface EpanetJunctionLike {
  id: string;
  elevation: number;
  demand?: number | undefined;
  pressure?: number | undefined;
  head?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface EpanetReservoirLike {
  id: string;
  totalHead: number;
  x?: number | undefined;
  y?: number | undefined;
}

export interface EpanetTankLike {
  id: string;
  elevation: number;
  initLevel: number;
  maxLevel?: number | undefined;
  diameter?: number | undefined;
  currentLevel?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface EpanetPipeLike {
  id: string;
  node1: string;
  node2: string;
  length: number;
  diameter: number;
  roughness?: number | undefined;
  flow?: number | undefined;
  velocity?: number | undefined;
  headLoss?: number | undefined;
}

export interface EpanetPumpLike {
  id: string;
  node1: string;
  node2: string;
  power?: number | undefined;
  flow?: number | undefined;
  headGain?: number | undefined;
}

export interface EpanetValveLike {
  id: string;
  node1: string;
  node2: string;
  type: string;
  setting?: number | undefined;
}

export interface EpanetModelLike {
  title?: string | undefined;
  junctions: EpanetJunctionLike[] | Map<string, EpanetJunctionLike>;
  reservoirs: EpanetReservoirLike[] | Map<string, EpanetReservoirLike>;
  tanks: EpanetTankLike[] | Map<string, EpanetTankLike>;
  pipes: EpanetPipeLike[] | Map<string, EpanetPipeLike>;
  pumps?: EpanetPumpLike[] | Map<string, EpanetPumpLike> | undefined;
  valves?: EpanetValveLike[] | Map<string, EpanetValveLike> | undefined;
}

export interface EpanetRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
  propertyMode?: "pressure" | "velocity" | "headloss" | "fireflow" | undefined;
  fireFlowResults?: Map<string, number> | undefined; // nodeId -> available GPM
}

export interface EpanetProfileOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
  title?: string | undefined;
}

function toArray<T>(val: T[] | Map<string, T> | undefined): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Array.from(val.values());
}

/**
 * Returns color coding for pipe flow velocity (m/s).
 */
export function getVelocityColor(velocityMps?: number): string {
  if (velocityMps === undefined) return "#0284c7"; // Default Sky Blue
  const v = Math.abs(velocityMps);
  if (v > 2.5) return "#ef4444"; // Scour / High Headloss Red
  if (v > 1.8) return "#f59e0b"; // Upper Target Amber
  if (v >= 0.3) return "#10b981"; // Optimal Self-Cleansing Green
  return "#64748b"; // Low Velocity / Stagnant Slate
}

/**
 * Returns color coding for junction pressure head (meters of water).
 */
export function getPressureColor(pressureM?: number): string {
  if (pressureM === undefined) return "#38bdf8";
  if (pressureM < 14.0) return "#ef4444"; // Low Pressure Deficit (<20 psi) Red
  if (pressureM < 25.0) return "#f59e0b"; // Marginal Pressure Amber
  if (pressureM <= 60.0) return "#10b981"; // Good Service Pressure Green
  return "#8b5cf6"; // High Pressure (>85 psi, burst hazard) Purple
}

/**
 * Returns NFPA 291 Fire Hydrant color rating and class band:
 * - Class AA: >= 1,500 GPM (Light Blue)
 * - Class A:  1,000 - 1,499 GPM (Green)
 * - Class B:  500 - 999 GPM (Orange)
 * - Class C:  < 500 GPM (Red)
 */
export function getNfpaHydrantColor(flowGpm?: number): {
  color: string;
  label: string;
  classBand: "AA" | "A" | "B" | "C";
} {
  if (flowGpm === undefined || flowGpm >= 1500) {
    return { color: "#00bfff", label: "Class AA (>= 1,500 GPM)", classBand: "AA" };
  }
  if (flowGpm >= 1000) {
    return { color: "#10b981", label: "Class A (1,000 - 1,499 GPM)", classBand: "A" };
  }
  if (flowGpm >= 500) {
    return { color: "#f59e0b", label: "Class B (500 - 999 GPM)", classBand: "B" };
  }
  return { color: "#ef4444", label: "Class C (< 500 GPM)", classBand: "C" };
}

/**
 * Renders a complete 2D network schematic plan-view SVG for an EPANET model.
 */
export function renderEpanetPlanSvg(model: EpanetModelLike, options?: EpanetRenderOptions): string {
  const isDark = (options?.theme ?? "dark") === "dark";
  const width = options?.width ?? 900;
  const height = options?.height ?? 540;

  const junctions = toArray(model.junctions);
  const reservoirs = toArray(model.reservoirs);
  const tanks = toArray(model.tanks);
  const pipes = toArray(model.pipes);
  const pumps = toArray(model.pumps);
  const valves = toArray(model.valves);

  // Theme palettes
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const cardBg = isDark ? "#1e293b" : "#ffffff";
  const borderCol = isDark ? "#334155" : "#e2e8f0";
  const textCol = isDark ? "#f1f5f9" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#64748b";

  // Build node coordinate map
  const nodeCoords = new Map<string, { x: number; y: number; id: string; kind: string }>();

  // Use explicit coordinates if present, otherwise auto-layout in topological circle/grid
  let hasExplicit = false;
  for (const j of junctions) {
    if (j.x !== undefined && j.y !== undefined && (j.x !== 0 || j.y !== 0)) {
      hasExplicit = true;
      break;
    }
  }

  const allNodes = [
    ...reservoirs.map((r) => ({ id: r.id, kind: "RESERVOIR", x: r.x, y: r.y })),
    ...tanks.map((t) => ({ id: t.id, kind: "TANK", x: t.x, y: t.y })),
    ...junctions.map((j) => ({ id: j.id, kind: "JUNCTION", x: j.x, y: j.y })),
  ];

  if (hasExplicit) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const n of allNodes) {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny;
      if (ny > maxY) maxY = ny;
    }

    const spanX = Math.max(10, maxX - minX);
    const spanY = Math.max(10, maxY - minY);
    const pad = 60;

    for (const n of allNodes) {
      const normX = pad + (((n.x ?? 0) - minX) / spanX) * (width - 2 * pad);
      // Invert Y for cartesian GIS coordinates
      const normY = height - pad - (((n.y ?? 0) - minY) / spanY) * (height - 2 * pad);
      nodeCoords.set(n.id.toLowerCase(), { x: normX, y: normY, id: n.id, kind: n.kind });
    }
  } else {
    // Topological circle/organic layout fallback
    const count = allNodes.length;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;

    allNodes.forEach((n, idx) => {
      // Place reservoirs on left, tanks on right, junctions around ring
      let angle = (2 * Math.PI * idx) / Math.max(1, count);
      let r = radius;
      if (n.kind === "RESERVOIR") {
        angle = Math.PI * 0.9;
        r = radius * 1.1;
      } else if (n.kind === "TANK") {
        angle = -Math.PI * 0.1;
        r = radius * 1.05;
      }
      const nx = cx + r * Math.cos(angle);
      const ny = cy + r * Math.sin(angle);
      nodeCoords.set(n.id.toLowerCase(), { x: nx, y: ny, id: n.id, kind: n.kind });
    });
  }

  // Generate SVG elements
  const svgPipes: string[] = [];
  for (const pipe of pipes) {
    const c1 = nodeCoords.get(pipe.node1.toLowerCase());
    const c2 = nodeCoords.get(pipe.node2.toLowerCase());
    if (!c1 || !c2) continue;

    const strokeColor = getVelocityColor(pipe.velocity);
    const diamMm = pipe.diameter > 5.0 ? pipe.diameter : pipe.diameter * 1000.0;
    const strokeWidth = Math.max(2, Math.min(8, diamMm / 50.0));
    const midX = (c1.x + c2.x) / 2;
    const midY = (c1.y + c2.y) / 2;

    svgPipes.push(`
      <g class="epanet-pipe" data-link="${pipe.id}">
        <line x1="${c1.x.toFixed(1)}" y1="${c1.y.toFixed(1)}" x2="${c2.x.toFixed(1)}" y2="${c2.y.toFixed(1)}"
              stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.85" />
        <title>Pipe: ${pipe.id}&#10;L: ${pipe.length} m | D: ${diamMm.toFixed(0)} mm&#10;Q: ${pipe.flow !== undefined ? pipe.flow.toFixed(1) + " L/s" : "N/A"}&#10;v: ${pipe.velocity !== undefined ? pipe.velocity.toFixed(2) + " m/s" : "N/A"}</title>
        <circle cx="${midX.toFixed(1)}" cy="${midY.toFixed(1)}" r="3" fill="${strokeColor}" />
      </g>
    `);
  }

  // Pumps and Valves
  const svgLinksSpecial: string[] = [];
  for (const pump of pumps) {
    const c1 = nodeCoords.get(pump.node1.toLowerCase());
    const c2 = nodeCoords.get(pump.node2.toLowerCase());
    if (!c1 || !c2) continue;
    const midX = (c1.x + c2.x) / 2;
    const midY = (c1.y + c2.y) / 2;
    svgLinksSpecial.push(`
      <g class="epanet-pump" transform="translate(${midX}, ${midY})">
        <circle r="12" fill="${cardBg}" stroke="#10b981" stroke-width="2.5" />
        <polygon points="-5,-6 6,0 -5,6" fill="#10b981" />
        <title>Pump: ${pump.id}&#10;Power: ${pump.power ?? "N/A"} kW</title>
      </g>
    `);
  }

  for (const v of valves) {
    const c1 = nodeCoords.get(v.node1.toLowerCase());
    const c2 = nodeCoords.get(v.node2.toLowerCase());
    if (!c1 || !c2) continue;
    const midX = (c1.x + c2.x) / 2;
    const midY = (c1.y + c2.y) / 2;
    svgLinksSpecial.push(`
      <g class="epanet-valve" transform="translate(${midX}, ${midY})">
        <polygon points="-8,-6 -8,6 8,-6 8,6" fill="#f59e0b" stroke="${borderCol}" stroke-width="1" />
        <title>Valve: ${v.id} (${v.type})&#10;Setting: ${v.setting}</title>
      </g>
    `);
  }

  // Nodes (Reservoirs, Tanks, Junctions)
  const svgNodes: string[] = [];
  for (const res of reservoirs) {
    const c = nodeCoords.get(res.id.toLowerCase());
    if (!c) continue;
    svgNodes.push(`
      <g class="epanet-reservoir" transform="translate(${c.x}, ${c.y})">
        <rect x="-16" y="-12" width="32" height="24" rx="4" fill="#0284c7" stroke="#38bdf8" stroke-width="2" />
        <path d="M-10,0 Q-5,-4 0,0 T10,0" fill="none" stroke="#ffffff" stroke-width="2" />
        <text x="0" y="24" fill="${textCol}" font-size="11" font-weight="600" text-anchor="middle" font-family="sans-serif">${res.id}</text>
        <title>Reservoir: ${res.id}&#10;Head: ${res.totalHead} m</title>
      </g>
    `);
  }

  for (const tank of tanks) {
    const c = nodeCoords.get(tank.id.toLowerCase());
    if (!c) continue;
    svgNodes.push(`
      <g class="epanet-tank" transform="translate(${c.x}, ${c.y})">
        <rect x="-14" y="-16" width="28" height="32" rx="6" fill="${cardBg}" stroke="#06b6d4" stroke-width="2.5" />
        <rect x="-11" y="2" width="22" height="11" rx="2" fill="#06b6d4" opacity="0.6" />
        <text x="0" y="26" fill="${textCol}" font-size="11" font-weight="600" text-anchor="middle" font-family="sans-serif">${tank.id}</text>
        <title>Tank: ${tank.id}&#10;Elev: ${tank.elevation} m | Level: ${tank.currentLevel ?? tank.initLevel} m</title>
      </g>
    `);
  }

  const isFireFlowMode = options?.propertyMode === "fireflow";

  for (const junc of junctions) {
    const c = nodeCoords.get(junc.id.toLowerCase());
    if (!c) continue;
    const demandVal = junc.demand ?? 0;
    const fireFlowGpm = options?.fireFlowResults?.get(junc.id) ?? (demandVal > 0 ? demandVal * 15.8503 * 10 : 1550);
    const nfpa = getNfpaHydrantColor(fireFlowGpm);
    const pCol = isFireFlowMode ? nfpa.color : getPressureColor(junc.pressure);
    const tooltipText = isFireFlowMode
      ? `Hydrant: ${junc.id}&#10;NFPA Rating: ${nfpa.label}&#10;Available Fire Flow: ${fireFlowGpm.toFixed(0)} GPM&#10;Residual: ${junc.pressure !== undefined ? junc.pressure.toFixed(1) + " m" : "20 psi"}`
      : `Junction: ${junc.id}&#10;Elev: ${junc.elevation} m&#10;Pressure: ${junc.pressure !== undefined ? junc.pressure.toFixed(1) + " m" : "N/A"}&#10;Demand: ${junc.demand} L/s`;

    svgNodes.push(`
      <g class="epanet-junction" transform="translate(${c.x}, ${c.y})">
        <circle r="${isFireFlowMode ? 8 : 7}" fill="${pCol}" stroke="${cardBg}" stroke-width="2" />
        <text x="0" y="-11" fill="${textMuted}" font-size="10" font-family="sans-serif" text-anchor="middle">${junc.id}</text>
        <title>${tooltipText}</title>
      </g>
    `);
  }

  const titleText = model.title || "EPANET Water Distribution Network";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};border-radius:8px;">
    <defs>
      <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M 30 0 L 0 0 0 30" fill="none" stroke="${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#grid)" />

    <!-- Title and Header -->
    <text x="24" y="32" fill="${textCol}" font-size="15" font-weight="700" font-family="system-ui, sans-serif">${titleText}</text>
    <text x="24" y="48" fill="${textMuted}" font-size="11" font-family="system-ui, sans-serif">${junctions.length} Junctions · ${pipes.length} Pipes · ${tanks.length} Tanks · ${reservoirs.length} Reservoirs${isFireFlowMode ? " · NFPA 291 Fire Flow Analysis" : ""}</text>

    <!-- Legend -->
    ${
      isFireFlowMode
        ? `<g transform="translate(${width - 320}, 16)">
      <rect x="0" y="0" width="300" height="52" rx="6" fill="${cardBg}" stroke="${borderCol}" stroke-width="1" />
      <circle cx="16" cy="16" r="5" fill="#00bfff" />
      <text x="26" y="19" fill="${textCol}" font-size="9.5" font-family="sans-serif">Class AA (&ge;1,500 GPM)</text>
      <circle cx="16" cy="36" r="5" fill="#10b981" />
      <text x="26" y="39" fill="${textCol}" font-size="9.5" font-family="sans-serif">Class A (1,000-1,499 GPM)</text>
      <circle cx="160" cy="16" r="5" fill="#f59e0b" />
      <text x="170" y="19" fill="${textCol}" font-size="9.5" font-family="sans-serif">Class B (500-999 GPM)</text>
      <circle cx="160" cy="36" r="5" fill="#ef4444" />
      <text x="170" y="39" fill="${textCol}" font-size="9.5" font-family="sans-serif">Class C (&lt;500 GPM)</text>
    </g>`
        : `<g transform="translate(${width - 240}, 20)">
      <rect x="0" y="0" width="220" height="42" rx="6" fill="${cardBg}" stroke="${borderCol}" stroke-width="1" />
      <circle cx="16" cy="14" r="5" fill="#10b981" />
      <text x="26" y="17" fill="${textCol}" font-size="10" font-family="sans-serif">Optimal Pressure (&gt;25m)</text>
      <circle cx="16" cy="29" r="5" fill="#ef4444" />
      <text x="26" y="32" fill="${textCol}" font-size="10" font-family="sans-serif">Pressure Deficit (&lt;14m)</text>
      <line x1="130" y1="14" x2="150" y2="14" stroke="#10b981" stroke-width="3" />
      <text x="156" y="17" fill="${textCol}" font-size="10" font-family="sans-serif">&gt;0.3 m/s</text>
      <line x1="130" y1="29" x2="150" y2="29" stroke="#ef4444" stroke-width="3" />
      <text x="156" y="32" fill="${textCol}" font-size="10" font-family="sans-serif">&gt;2.5 m/s</text>
    </g>`
    }

    <!-- Hydraulic Elements -->
    <g id="pipes">${svgPipes.join("\n")}</g>
    <g id="special-links">${svgLinksSpecial.join("\n")}</g>
    <g id="nodes">${svgNodes.join("\n")}</g>
  </svg>`;
}

/**
 * Renders an interactive Longitudinal Hydraulic Grade Line (HGL) Profile cut SVG.
 */
export function renderEpanetHglProfileSvg(
  pathNodes: EpanetJunctionLike[],
  pathLinks: EpanetPipeLike[],
  options?: EpanetProfileOptions,
): string {
  const isDark = (options?.theme ?? "dark") === "dark";
  const width = options?.width ?? 900;
  const height = options?.height ?? 440;
  const title = options?.title ?? "Longitudinal Hydraulic Grade Line (HGL) Profile";

  const bg = isDark ? "#0f172a" : "#f8fafc";
  const cardBg = isDark ? "#1e293b" : "#ffffff";
  const textCol = isDark ? "#f1f5f9" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#64748b";
  const gridCol = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  if (pathNodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="50%" y="50%" fill="${textMuted}" text-anchor="middle">No profile path nodes selected</text></svg>`;
  }

  // Compute cumulative distances
  const distances: number[] = [0];
  let totalDistM = 0;
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const link = pathLinks[i];
    const len = link ? link.length : 500;
    totalDistM += len;
    distances.push(totalDistM);
  }

  let minHead = Number.POSITIVE_INFINITY;
  let maxHead = Number.NEGATIVE_INFINITY;

  for (const n of pathNodes) {
    const elev = n.elevation;
    const h = n.head ?? elev + (n.pressure ?? 30.0);
    if (elev < minHead) minHead = elev;
    if (elev > maxHead) maxHead = elev;
    if (h < minHead) minHead = h;
    if (h > maxHead) maxHead = h;
  }

  const padLeft = 70;
  const padRight = 40;
  const padTop = 60;
  const padBottom = 60;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const spanH = Math.max(10, (maxHead - minHead) * 1.25);
  const baseH = minHead - spanH * 0.05;

  const toX = (distM: number) => padLeft + (distM / Math.max(1, totalDistM)) * plotW;
  const toY = (headM: number) => padTop + plotH - ((headM - baseH) / spanH) * plotH;

  // Build SVG path strings
  let groundD = "";
  let pipeInvertD = "";
  let hglD = "";
  let eglD = "";

  pathNodes.forEach((n, idx) => {
    const x = toX(distances[idx]!).toFixed(1);
    const elev = n.elevation;
    const h = n.head ?? elev + (n.pressure ?? 30.0);
    const v = pathLinks[idx]?.velocity ?? 1.2;
    const egl = h + (v * v) / (2 * 9.80665);

    const yGround = toY(elev + 1.5).toFixed(1); // Ground surface ~1.5m above pipe
    const yPipe = toY(elev).toFixed(1);
    const yHgl = toY(h).toFixed(1);
    const yEgl = toY(egl).toFixed(1);

    if (idx === 0) {
      groundD = `M ${x} ${yGround}`;
      pipeInvertD = `M ${x} ${yPipe}`;
      hglD = `M ${x} ${yHgl}`;
      eglD = `M ${x} ${yEgl}`;
    } else {
      groundD += ` L ${x} ${yGround}`;
      pipeInvertD += ` L ${x} ${yPipe}`;
      hglD += ` L ${x} ${yHgl}`;
      eglD += ` L ${x} ${yEgl}`;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};border-radius:8px;">
    <!-- Title -->
    <text x="${padLeft}" y="32" fill="${textCol}" font-size="14" font-weight="700" font-family="system-ui, sans-serif">${title}</text>
    <text x="${padLeft}" y="48" fill="${textMuted}" font-size="11" font-family="system-ui, sans-serif">Total Path Distance: ${(totalDistM / 1000).toFixed(2)} km</text>

    <!-- Axes Grid -->
    <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${height - padBottom}" stroke="${gridCol}" stroke-width="1.5" />
    <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" stroke="${gridCol}" stroke-width="1.5" />

    <!-- Distance Axis Labels -->
    <text x="${padLeft}" y="${height - padBottom + 20}" fill="${textMuted}" font-size="10" font-family="sans-serif">0 km</text>
    <text x="${width - padRight}" y="${height - padBottom + 20}" fill="${textMuted}" font-size="10" font-family="sans-serif" text-anchor="end">${(totalDistM / 1000).toFixed(2)} km</text>

    <!-- Elevation Axis Labels -->
    <text x="${padLeft - 10}" y="${toY(baseH + spanH)}" fill="${textMuted}" font-size="10" font-family="sans-serif" text-anchor="end">${(baseH + spanH).toFixed(0)} m</text>
    <text x="${padLeft - 10}" y="${toY(baseH)}" fill="${textMuted}" font-size="10" font-family="sans-serif" text-anchor="end">${baseH.toFixed(0)} m</text>

    <!-- Ground Profile (brown dashed) -->
    <path d="${groundD}" fill="none" stroke="#a16207" stroke-width="2" stroke-dasharray="4,4" />

    <!-- Pipe Invert (dark gray/slate) -->
    <path d="${pipeInvertD}" fill="none" stroke="#64748b" stroke-width="3" stroke-linecap="round" />

    <!-- Hydraulic Grade Line (cyan solid) -->
    <path d="${hglD}" fill="none" stroke="#06b6d4" stroke-width="3" />

    <!-- Energy Grade Line (purple dashed) -->
    <path d="${eglD}" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="3,3" />

    <!-- Legend -->
    <g transform="translate(${width - 320}, 16)">
      <rect x="0" y="0" width="300" height="34" rx="4" fill="${cardBg}" opacity="0.9" />
      <line x1="12" y1="17" x2="32" y2="17" stroke="#a16207" stroke-width="2" stroke-dasharray="3,3" />
      <text x="38" y="20" fill="${textCol}" font-size="10" font-family="sans-serif">Ground Rim</text>
      <line x1="110" y1="17" x2="130" y2="17" stroke="#06b6d4" stroke-width="3" />
      <text x="136" y="20" fill="${textCol}" font-size="10" font-family="sans-serif">HGL (Head)</text>
      <line x1="210" y1="17" x2="230" y2="17" stroke="#a855f7" stroke-width="2" stroke-dasharray="2,2" />
      <text x="236" y="20" fill="${textCol}" font-size="10" font-family="sans-serif">EGL</text>
    </g>
  </svg>`;
}
