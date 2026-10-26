// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — JSBSim 6-DOF Flight Dynamics 2D Airframe & Kinematics Diagram Builder.
 *
 * Translates JSBSim flight dynamics models (.xml) into AntV X6 graph structures and standalone SVGs:
 * 1. Planform orthogonal projection (wing span, mean aerodynamic chord, fuselage station, horizontal & vertical tail).
 * 2. Key reference points: Center of Gravity (CG &oplus;) and Aerodynamic Reference Point (AERORP &odot;).
 * 3. Static landing gear contact points (nose/tail and main gear bogeys).
 * 4. Engine propulsion thrust vectors.
 */

export interface JsbsimMetricsLike {
  wingarea?: number | undefined; // ft^2 or m^2
  wingspan?: number | undefined; // ft or m
  chord?: number | undefined; // ft or m
  htailarea?: number | undefined;
  htailarm?: number | undefined;
  vtailarea?: number | undefined;
  vtailarm?: number | undefined;
  aerorp?: { x: number; y: number; z: number } | undefined;
}

export interface JsbsimMassBalanceLike {
  emptywt?: number | undefined; // lbs or kg
  cg?: { x: number; y: number; z: number } | undefined;
}

export interface JsbsimGroundReactionLike {
  name: string;
  type: string;
  x: number;
  y: number;
  z: number;
}

export interface JsbsimPropulsionLike {
  engineName?: string | undefined;
  thrustLbs?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  z?: number | undefined;
}

export interface JsbsimFdmLike {
  name?: string | undefined;
  metrics?: JsbsimMetricsLike | undefined;
  massBalance?: JsbsimMassBalanceLike | undefined;
  groundReactions?: JsbsimGroundReactionLike[] | undefined;
  propulsion?: JsbsimPropulsionLike[] | undefined;
}

export interface JsbsimDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface JsbsimDiagramGraph {
  title: string;
  cells: JsbsimDiagramCell[];
}

export interface JsbsimRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Builds an interactive AntV X6 graph model for a JSBSim flight dynamics airframe.
 */
export function buildJsbsimDiagram(fdm: JsbsimFdmLike): JsbsimDiagramGraph {
  const cells: JsbsimDiagramCell[] = [];
  const span = fdm.metrics?.wingspan ?? 36.0;
  const chord = fdm.metrics?.chord ?? 5.0;

  const cx = 350;
  const cy = 200;

  // 1. Fuselage Centerline Body
  cells.push({
    id: "fuselage",
    shape: "rect",
    x: cx - 18,
    y: cy - 140,
    width: 36,
    height: 280,
    label: fdm.name ?? "Airframe Fuselage",
    attrs: {
      body: { fill: "#1e293b", stroke: "#38bdf8", strokeWidth: 2, rx: 18, ry: 18 },
      label: { fill: "#f8fafc", fontSize: 10, fontWeight: "600" },
    },
    data: { emptyWeight: fdm.massBalance?.emptywt },
  });

  // 2. Main Wing Surface
  const wingW = 340;
  const wingH = 46;
  cells.push({
    id: "wing_main",
    shape: "rect",
    x: cx - wingW / 2,
    y: cy - 35,
    width: wingW,
    height: wingH,
    label: `Main Wing (Span: ${span} ft, Chord: ${chord} ft)`,
    attrs: {
      body: { fill: "#0f172a", stroke: "#38bdf8", strokeWidth: 2, rx: 6, ry: 6 },
      label: { fill: "#38bdf8", fontSize: 9, fontWeight: "600" },
    },
    data: { span, chord, wingArea: fdm.metrics?.wingarea },
  });

  // 3. Horizontal Stabilizer
  const htailW = 120;
  const htailH = 26;
  cells.push({
    id: "tail_horizontal",
    shape: "rect",
    x: cx - htailW / 2,
    y: cy + 105,
    width: htailW,
    height: htailH,
    label: "H-Tail",
    attrs: {
      body: { fill: "#0f172a", stroke: "#818cf8", strokeWidth: 1.5, rx: 4, ry: 4 },
      label: { fill: "#c7d2fe", fontSize: 8 },
    },
  });

  // 4. Center of Gravity (CG) and AERORP Markers (dynamically mapped from MAC station)
  const macLeadingEdge = (fdm.metrics?.aerorp?.x ?? 43.1) - chord * 12 * 0.25;
  const stationToY = (station: number) => {
    const fracMac = (station - macLeadingEdge) / Math.max(1, chord * 12);
    return cy - 35 + fracMac * wingH;
  };
  const rawCgX = fdm.massBalance?.cg?.x ?? 41.0;
  const rawAeroX = fdm.metrics?.aerorp?.x ?? 43.1;
  const cgY = Math.max(cy - 30, Math.min(cy + 5, stationToY(rawCgX)));
  const aeroY = Math.max(cy - 30, Math.min(cy + 5, stationToY(rawAeroX)));

  cells.push({
    id: "marker_cg",
    shape: "circle",
    x: cx - 10,
    y: cgY,
    width: 20,
    height: 20,
    label: "CG",
    attrs: {
      body: { fill: "#f59e0b", stroke: "#ffffff", strokeWidth: 2 },
      label: { fill: "#0f172a", fontSize: 8, fontWeight: "bold" },
    },
    data: { x: fdm.massBalance?.cg?.x, y: fdm.massBalance?.cg?.y },
  });

  // 5. Aerodynamic Reference Point (AERORP)
  cells.push({
    id: "marker_aerorp",
    shape: "circle",
    x: cx - 8,
    y: aeroY,
    width: 16,
    height: 16,
    label: "RP",
    attrs: {
      body: { fill: "#10b981", stroke: "#ffffff", strokeWidth: 1.5 },
      label: { fill: "#0f172a", fontSize: 7, fontWeight: "bold" },
    },
    data: { x: fdm.metrics?.aerorp?.x, y: fdm.metrics?.aerorp?.y },
  });

  // 6. Landing Gear Ground Reactions
  if (fdm.groundReactions) {
    for (const gear of fdm.groundReactions) {
      const gearX = cx + (gear.y ? (gear.y / (span / 2)) * (wingW / 2) : 0);
      const gearY = gear.x ? stationToY(gear.x) : cy + 40;
      cells.push({
        id: `gear_${gear.name}`,
        shape: "rect",
        x: gearX - 6,
        y: gearY - 10,
        width: 12,
        height: 20,
        label: gear.name,
        attrs: {
          body: { fill: "#334155", stroke: "#cbd5e1", strokeWidth: 1.5, rx: 3, ry: 3 },
          label: { fill: "#94a3b8", fontSize: 7 },
        },
        data: { ...gear },
      });
    }
  }

  return {
    title: fdm.name ? `${fdm.name} 6-DOF Airframe Geometry` : "JSBSim Flight Dynamics Airframe",
    cells,
  };
}

/**
 * Emits a standalone SVG blueprint planform of a JSBSim aircraft model.
 */
export function renderJsbsimSvg(fdm: JsbsimFdmLike, options?: JsbsimRenderOptions): string {
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const width = options?.width ?? 720;
  const height = options?.height ?? 460;

  const cx = width / 2;
  const cy = height / 2 + 10;
  const span = fdm.metrics?.wingspan ?? 36.0;
  const chord = fdm.metrics?.chord ?? 4.9;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;

  // Grid blueprint pattern
  svg += `  <defs>\n`;
  svg += `    <pattern id="blueprint-grid" width="20" height="20" patternUnits="userSpaceOnUse">\n`;
  svg += `      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${isDark ? "#1e293b" : "#e2e8f0"}" stroke-width="0.8" />\n`;
  svg += `    </pattern>\n`;
  svg += `  </defs>\n`;
  svg += `  <rect width="100%" height="100%" fill="url(#blueprint-grid)" opacity="0.6" />\n`;

  // Title Banner
  svg += `  <text x="50" y="36" fill="${textColor}" font-size="16" font-weight="700">${fdm.name ?? "Flight Dynamics Model"} (Planform Blueprint)</text>\n`;
  svg += `  <text x="50" y="52" fill="${subTextColor}" font-size="10">Airframe Geometry, Reference Points (CG/AERORP), and Control Surfaces</text>\n`;

  // 1. Centerline Datum Axis
  svg += `  <line x1="${cx}" y1="80" x2="${cx}" y2="${height - 60}" stroke="#475569" stroke-width="1" stroke-dasharray="8,4" />\n`;

  // 2. Main Wings
  const wingSpanPx = 360;
  const wingChordPx = 50;
  svg += `  <polygon points="${cx - wingSpanPx / 2},${cy - 10} ${cx},${cy - 25} ${cx + wingSpanPx / 2},${cy - 10} ${cx + wingSpanPx / 2},${cy + wingChordPx - 10} ${cx},${cy + wingChordPx} ${cx - wingSpanPx / 2},${cy + wingChordPx - 10}" fill="${isDark ? "#0f172a" : "#ffffff"}" stroke="#38bdf8" stroke-width="2" />\n`;

  // Wing Span Dimension Callout
  svg += `  <line x1="${cx - wingSpanPx / 2}" y1="${cy - 35}" x2="${cx + wingSpanPx / 2}" y2="${cy - 35}" stroke="#94a3b8" stroke-width="1.5" />\n`;
  svg += `  <line x1="${cx - wingSpanPx / 2}" y1="${cy - 42}" x2="${cx - wingSpanPx / 2}" y2="${cy - 28}" stroke="#94a3b8" stroke-width="1.5" />\n`;
  svg += `  <line x1="${cx + wingSpanPx / 2}" y1="${cy - 42}" x2="${cx + wingSpanPx / 2}" y2="${cy - 28}" stroke="#94a3b8" stroke-width="1.5" />\n`;
  svg += `  <text x="${cx}" y="${cy - 42}" fill="#38bdf8" font-size="10" font-weight="600" text-anchor="middle">b = ${span} ft, c̄ = ${chord} ft</text>\n`;

  // 3. Fuselage Body
  svg += `  <path d="M ${cx},${cy - 120} C ${cx + 18},${cy - 90} ${cx + 18},${cy + 90} ${cx + 6},${cy + 130} L ${cx - 6},${cy + 130} C ${cx - 18},${cy + 90} ${cx - 18},${cy - 90} ${cx},${cy - 120} Z" fill="${isDark ? "#1e293b" : "#f1f5f9"}" stroke="#38bdf8" stroke-width="2" />\n`;

  // 4. Horizontal Stabilizer
  const tailSpanPx = 130;
  svg += `  <polygon points="${cx - tailSpanPx / 2},${cy + 105} ${cx},${cy + 95} ${cx + tailSpanPx / 2},${cy + 105} ${cx + tailSpanPx / 2},${cy + 128} ${cx},${cy + 132} ${cx - tailSpanPx / 2},${cy + 128}" fill="${isDark ? "#0f172a" : "#ffffff"}" stroke="#818cf8" stroke-width="1.8" />\n`;

  // 5. Reference Point Markers (mapped dynamically from Mean Aerodynamic Chord station)
  const macLeadingEdgePx = (fdm.metrics?.aerorp?.x ?? 43.1) - chord * 12 * 0.25;
  const stationToSvgY = (station: number) => {
    const fracMac = (station - macLeadingEdgePx) / Math.max(1, chord * 12);
    return cy - 10 + fracMac * wingChordPx;
  };
  const rawCgX = fdm.massBalance?.cg?.x ?? 41.0;
  const rawAeroX = fdm.metrics?.aerorp?.x ?? 43.1;
  const cgY = Math.max(cy - 10, Math.min(cy + 35, stationToSvgY(rawCgX)));
  const aeroY = Math.max(cy - 10, Math.min(cy + 35, stationToSvgY(rawAeroX)));

  // Center of Gravity (CG)
  svg += `  <circle cx="${cx}" cy="${cgY}" r="9" fill="#f59e0b" stroke="#ffffff" stroke-width="2" />\n`;
  svg += `  <line x1="${cx - 9}" y1="${cgY}" x2="${cx + 9}" y2="${cgY}" stroke="#ffffff" stroke-width="1.5" />\n`;
  svg += `  <line x1="${cx}" y1="${cgY - 9}" x2="${cx}" y2="${cgY + 9}" stroke="#ffffff" stroke-width="1.5" />\n`;
  svg += `  <text x="${cx + 16}" y="${cgY + 4}" fill="#f59e0b" font-size="9" font-weight="bold">CG (Station: ${Number.isInteger(rawCgX) ? rawCgX : rawCgX.toFixed(1)}")</text>\n`;

  // Aerodynamic Reference Point (AERORP)
  svg += `  <circle cx="${cx}" cy="${aeroY}" r="7" fill="none" stroke="#10b981" stroke-width="2.5" />\n`;
  svg += `  <circle cx="${cx}" cy="${aeroY}" r="2" fill="#10b981" />\n`;
  svg += `  <text x="${cx + 16}" y="${aeroY + 4}" fill="#10b981" font-size="9" font-weight="bold">AERORP (${rawAeroX.toFixed(1)}")</text>\n`;

  // Landing Gear Contact Points
  if (fdm.groundReactions) {
    for (const gear of fdm.groundReactions) {
      const gx = cx + (gear.y ? (gear.y / (span / 2)) * (wingSpanPx / 2) : 0);
      const gy = gear.x ? stationToSvgY(gear.x) : cy + 40;
      svg += `  <rect x="${gx - 5}" y="${gy - 8}" width="10" height="16" fill="#475569" stroke="#94a3b8" stroke-width="1.5" rx="2" />\n`;
      svg += `  <text x="${gx}" y="${gy + 16}" fill="${subTextColor}" font-size="7" text-anchor="middle">${gear.name}</text>\n`;
    }
  }

  // 6. Thrust Vector Arrow
  svg += `  <line x1="${cx}" y1="${cy - 120}" x2="${cx}" y2="${cy - 165}" stroke="#ef4444" stroke-width="3" />\n`;
  svg += `  <polygon points="${cx - 6},${cy - 165} ${cx},${cy - 178} ${cx + 6},${cy - 165}" fill="#ef4444" />\n`;
  svg += `  <text x="${cx}" y="${cy - 185}" fill="#ef4444" font-size="9" font-weight="bold" text-anchor="middle">THRUST VECTOR</text>\n`;

  // 7. Legend
  svg += `  <g id="jsbsim-legend" transform="translate(50, ${height - 20})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Legend:</text>\n`;
  svg += `    <circle cx="55" cy="-3" r="5" fill="#f59e0b" />\n`;
  svg += `    <text x="65" y="0" fill="${subTextColor}" font-size="9">Center of Gravity (CG)</text>\n`;
  svg += `    <circle cx="210" cy="-3" r="5" fill="none" stroke="#10b981" stroke-width="2" />\n`;
  svg += `    <text x="220" y="0" fill="${subTextColor}" font-size="9">Aerodynamic Center (AERORP)</text>\n`;
  svg += `    <line x1="380" y1="-3" x2="395" y2="-3" stroke="#ef4444" stroke-width="2.5" />\n`;
  svg += `    <text x="402" y="0" fill="${subTextColor}" font-size="9">Thrust Line</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
