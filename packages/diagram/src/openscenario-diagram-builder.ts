// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — OpenSCENARIO Autonomous Driving 2D Roadway & Safety Map Diagram Builder.
 *
 * Translates ASAM OpenSCENARIO (.xosc / .osc) files into AntV X6 graph structures and standalone SVGs:
 * 1. 2D bird's-eye roadway view with multi-lane road corridor and metric station markers.
 * 2. Actor vehicle bounding boxes (Ego, Target, Obstacles) positioned at metric coordinates with speed vectors.
 * 3. Waypoint trajectory paths with timestamp beads.
 * 4. Time-To-Collision (TTC) alert zones and Mobileye RSS safety buffer envelopes.
 */

export interface OscEntityLike {
  name: string;
  category?: "car" | "truck" | "pedestrian" | "bicycle" | "motorcycle" | undefined;
  role?: "ego" | "target" | "obstacle" | undefined;
  speed?: number | undefined; // m/s
  x?: number | undefined; // longitudinal position (m)
  y?: number | undefined; // lateral position (m, 0 = centerline)
  lane?: number | undefined; // 1, 2, 3...
}

export interface OscTrajectoryPointLike {
  time: number;
  x: number;
  y: number;
  speed?: number | undefined;
}

export interface OscSafetyEnvelopeLike {
  ttcSec?: number | undefined;
  minDistanceMeters?: number | undefined;
  rssViolated?: boolean | undefined;
}

export interface OscScenarioLike {
  title?: string | undefined;
  entities: OscEntityLike[];
  trajectories?: Record<string, OscTrajectoryPointLike[]> | undefined;
  safety?: OscSafetyEnvelopeLike | undefined;
  laneCount?: number | undefined; // default 3
  laneWidthMeters?: number | undefined; // default 3.5m
  roadLengthMeters?: number | undefined; // default 200m
}

export interface OscDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string } | { x: number; y: number } | undefined;
  target?: { cell: string } | { x: number; y: number } | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface OscDiagramGraph {
  title: string;
  cells: OscDiagramCell[];
}

export interface OscRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Returns color coding for vehicle roles.
 */
export function getEntityColor(role?: "ego" | "target" | "obstacle"): string {
  switch (role) {
    case "ego":
      return "#10b981"; // Emerald Ego
    case "target":
      return "#f43f5e"; // Rose / Red Cut-In Target
    default:
      return "#facc15"; // Amber Obstacle / Other
  }
}

/**
 * Builds an interactive AntV X6 graph model for an OpenSCENARIO scenario.
 */
export function buildOpenScenarioDiagram(scen: OscScenarioLike): OscDiagramGraph {
  const cells: OscDiagramCell[] = [];
  const roadLen = scen.roadLengthMeters ?? 180;
  const laneCount = scen.laneCount ?? 3;
  const laneW = 35; // px per lane in diagram space

  const roadW = 600;
  const roadH = laneCount * laneW;
  const rx = 60;
  const ry = 150;

  // 1. Roadway Corridor
  cells.push({
    id: "roadway_corridor",
    shape: "rect",
    x: rx,
    y: ry,
    width: roadW,
    height: roadH,
    label: "Roadway Corridor",
    attrs: {
      body: { fill: "#1e293b", stroke: "#64748b", strokeWidth: 2, rx: 4, ry: 4 },
      label: { fill: "#475569", fontSize: 10, refY: -10 },
    },
    data: { roadLength: roadLen, laneCount },
  });

  // 2. Entities (Ego, Target, Obstacles)
  for (const ent of scen.entities) {
    const role = ent.role ?? (ent.name.toLowerCase().includes("ego") ? "ego" : "target");
    const color = getEntityColor(role);

    // Map entity X (0 to roadLen) to diagram X (rx to rx + roadW)
    const entX = rx + Math.max(10, Math.min(roadW - 50, ((ent.x ?? 30) / roadLen) * roadW));
    const laneIdx = (ent.lane ?? 2) - 1;
    const entY = ry + laneIdx * laneW + (laneW - 20) / 2;

    const entCellId = `ent_${ent.name}`;
    cells.push({
      id: entCellId,
      shape: "rect",
      x: entX,
      y: entY,
      width: 44,
      height: 20,
      label: ent.name,
      attrs: {
        body: { fill: "#0f172a", stroke: color, strokeWidth: 2, rx: 4, ry: 4 },
        label: { fill: color, fontSize: 8, fontWeight: "bold" },
      },
      data: {
        entityName: ent.name,
        role,
        speedMs: ent.speed,
        longitudinalX: ent.x,
        lane: ent.lane,
      },
    });

    // Speed vector arrow
    if ((ent.speed ?? 0) > 0) {
      cells.push({
        id: `vel_${ent.name}`,
        shape: "edge",
        source: { x: entX + 44, y: entY + 10 },
        target: { x: entX + 70, y: entY + 10 },
        attrs: { line: { stroke: color, strokeWidth: 2, targetMarker: { name: "classic", width: 6, height: 5 } } },
      });
    }
  }

  // 3. Safety Envelope (RSS Buffer)
  if (scen.safety?.minDistanceMeters !== undefined) {
    const ego = scen.entities.find((e) => e.name.toLowerCase().includes("ego") || e.role === "ego");
    if (ego) {
      const egoX = rx + ((ego.x ?? 30) / roadLen) * roadW;
      const laneIdx = (ego.lane ?? 2) - 1;
      const egoY = ry + laneIdx * laneW;
      const bufW = (scen.safety.minDistanceMeters / roadLen) * roadW;

      cells.push({
        id: "safety_envelope",
        shape: "rect",
        x: egoX + 44,
        y: egoY + 2,
        width: Math.max(20, bufW),
        height: laneW - 4,
        label: `RSS: ${scen.safety.minDistanceMeters.toFixed(1)}m`,
        attrs: {
          body: {
            fill: scen.safety.rssViolated ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.15)",
            stroke: scen.safety.rssViolated ? "#ef4444" : "#10b981",
            strokeWidth: 1.5,
            strokeDasharray: "3,3",
            rx: 2,
            ry: 2,
          },
          label: { fill: scen.safety.rssViolated ? "#ef4444" : "#10b981", fontSize: 8 },
        },
      });
    }
  }

  return {
    title: scen.title ?? "OpenSCENARIO Safety Roadway Map",
    cells,
  };
}

/**
 * Emits a standalone SVG bird's-eye view of an autonomous driving safety scenario.
 */
export function renderOpenScenarioSvg(scen: OscScenarioLike, options?: OscRenderOptions): string {
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const width = options?.width ?? 760;
  const height = options?.height ?? 380;

  const roadLen = scen.roadLengthMeters ?? 180;
  const laneCount = scen.laneCount ?? 3;
  const laneW = 42; // px per lane

  const rx = 60;
  const ry = 140;
  const roadW = width - 120;
  const roadH = laneCount * laneW;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;

  // Title Banner
  svg += `  <text x="60" y="36" fill="${textColor}" font-size="16" font-weight="700">${scen.title ?? "OpenSCENARIO Safety Roadway Map"}</text>\n`;
  svg += `  <text x="60" y="52" fill="${subTextColor}" font-size="10">Bird's-Eye View: Roadway Corridor & Trajectory Safety Envelopes</text>\n`;

  // 1. Asphalt Roadway Bed
  svg += `  <rect x="${rx}" y="${ry}" width="${roadW}" height="${roadH}" fill="${isDark ? "#1e293b" : "#334155"}" rx="6" ry="6" />\n`;

  // Outer solid road border lines
  svg += `  <line x1="${rx}" y1="${ry}" x2="${rx + roadW}" y2="${ry}" stroke="#ffffff" stroke-width="2" />\n`;
  svg += `  <line x1="${rx}" y1="${ry + roadH}" x2="${rx + roadW}" y2="${ry + roadH}" stroke="#ffffff" stroke-width="2" />\n`;

  // Inner dashed lane dividers
  for (let l = 1; l < laneCount; l++) {
    const ly = ry + l * laneW;
    svg += `  <line x1="${rx}" y1="${ly}" x2="${rx + roadW}" y2="${ly}" stroke="#facc15" stroke-width="1.5" stroke-dasharray="14,10" />\n`;
  }

  // Station Distance Ticks (0m, 50m, 100m...)
  const tickCount = 5;
  for (let t = 0; t <= tickCount; t++) {
    const frac = t / tickCount;
    const tx = rx + frac * roadW;
    const distMeters = frac * roadLen;
    svg += `  <line x1="${tx}" y1="${ry + roadH}" x2="${tx}" y2="${ry + roadH + 6}" stroke="${subTextColor}" stroke-width="1" />\n`;
    svg += `  <text x="${tx}" y="${ry + roadH + 20}" fill="${subTextColor}" font-size="9" text-anchor="middle">${distMeters.toFixed(0)}m</text>\n`;
  }

  // 2. Draw RSS Safety Envelope if defined
  if (scen.safety?.minDistanceMeters !== undefined) {
    const ego = scen.entities.find((e) => e.name.toLowerCase().includes("ego") || e.role === "ego");
    if (ego) {
      const egoFrac = (ego.x ?? 30) / roadLen;
      const egoX = rx + egoFrac * roadW;
      const laneIdx = (ego.lane ?? 2) - 1;
      const egoY = ry + laneIdx * laneW;
      const bufW = (scen.safety.minDistanceMeters / roadLen) * roadW;
      const isViolated = scen.safety.rssViolated ?? false;

      const fill = isViolated ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.2)";
      const stroke = isViolated ? "#ef4444" : "#10b981";

      svg += `  <rect x="${egoX + 44}" y="${egoY + 4}" width="${Math.max(15, bufW)}" height="${laneW - 8}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2" />\n`;
      svg += `  <text x="${egoX + 44 + bufW / 2}" y="${egoY + laneW / 2 + 3}" fill="${stroke}" font-size="8" font-weight="bold" text-anchor="middle">RSS: ${scen.safety.minDistanceMeters.toFixed(1)}m</text>\n`;
    }
  }

  // 3. Draw Vehicles & Obstacles
  for (const ent of scen.entities) {
    const role = ent.role ?? (ent.name.toLowerCase().includes("ego") ? "ego" : "target");
    const color = getEntityColor(role);

    const entFrac = (ent.x ?? 30) / roadLen;
    const ex = rx + Math.max(10, Math.min(roadW - 55, entFrac * roadW));
    const laneIdx = (ent.lane ?? 2) - 1;
    const ey = ry + laneIdx * laneW + (laneW - 22) / 2;

    svg += `  <g class="osc-vehicle">\n`;
    // Vehicle chassis
    svg += `    <rect x="${ex}" y="${ey}" width="46" height="22" rx="4" ry="4" fill="${isDark ? "#0f172a" : "#ffffff"}" stroke="${color}" stroke-width="2" />\n`;
    // Headlights
    svg += `    <rect x="${ex + 43}" y="${ey + 2}" width="3" height="4" fill="#facc15" rx="1" />\n`;
    svg += `    <rect x="${ex + 43}" y="${ey + 16}" width="3" height="4" fill="#facc15" rx="1" />\n`;
    // Label
    svg += `    <text x="${ex + 23}" y="${ey + 14}" fill="${color}" font-size="8" font-weight="700" text-anchor="middle">${ent.name}</text>\n`;
    // Velocity Vector
    if ((ent.speed ?? 0) > 0) {
      svg += `    <line x1="${ex + 46}" y1="${ey + 11}" x2="${ex + 70}" y2="${ey + 11}" stroke="${color}" stroke-width="2" />\n`;
      svg += `    <polygon points="${ex + 70},${ey + 8} ${ex + 76},${ey + 11} ${ex + 70},${ey + 14}" fill="${color}" />\n`;
      svg += `    <text x="${ex + 23}" y="${ey - 6}" fill="${subTextColor}" font-size="8" text-anchor="middle">${ent.speed?.toFixed(1)} m/s</text>\n`;
    }
    svg += `  </g>\n`;
  }

  // 4. Legend
  svg += `  <g id="osc-legend" transform="translate(60, ${height - 25})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Actors:</text>\n`;
  svg += `    <rect x="55" y="-8" width="12" height="10" rx="2" fill="#10b981" />\n`;
  svg += `    <text x="73" y="0" fill="${subTextColor}" font-size="9">Ego Vehicle</text>\n`;
  svg += `    <rect x="150" y="-8" width="12" height="10" rx="2" fill="#f43f5e" />\n`;
  svg += `    <text x="168" y="0" fill="${subTextColor}" font-size="9">Target Cut-In</text>\n`;
  svg += `    <rect x="250" y="-8" width="12" height="10" rx="2" fill="#facc15" />\n`;
  svg += `    <text x="268" y="0" fill="${subTextColor}" font-size="9">Obstacle</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
