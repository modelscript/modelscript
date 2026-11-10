// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Complex Impedance R-X Plane Diagram Builder.
 *
 * Generates standalone, publication-quality SVGs rendering distance protection
 * relay characteristics on the complex impedance plane (R on x-axis, X on y-axis):
 *   - Mho Circles (Zone 1, Zone 2, Zone 3)
 *   - Quadrilateral Envelopes (forward/reverse reach, resistive blinders)
 *   - Load Encroachment Blinder Zones
 *   - Apparent Impedance Trajectories Z_app(t) = V(t) / I(t) with fault trip markers
 */

export interface RxZoneGraphic {
  zoneNumber: 1 | 2 | 3;
  characteristic: "mho" | "quadrilateral";
  reachOhm: number;
  lineAngleDeg: number;
  resistanceReachOhm?: number | undefined;
  directional?: "forward" | "reverse" | "non_directional" | undefined;
  delaySec?: number | undefined;
  color?: string | undefined;
}

export interface RxTrajectoryPoint {
  tSec: number;
  rOhm: number;
  xOhm: number;
  label?: string | undefined;
}

export interface RxDiagramOptions {
  title?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  zones?: RxZoneGraphic[] | undefined;
  trajectory?: RxTrajectoryPoint[] | undefined;
  tripPoint?: { tSec: number; rOhm: number; xOhm: number; zone: 1 | 2 | 3 } | undefined;
  loadEncroachment?: { rMinOhm: number; angleDeg: number } | undefined;
  rRange?: { min: number; max: number } | undefined;
  xRange?: { min: number; max: number } | undefined;
  theme?: "dark" | "light" | undefined;
}

const DEFAULT_ZONE_COLORS: Record<1 | 2 | 3, string> = {
  1: "#ef4444", // Red - Zone 1 Instantaneous
  2: "#f59e0b", // Amber - Zone 2 Delayed
  3: "#3b82f6", // Blue - Zone 3 Remote Backup
};

/**
 * Renders an interactive, standalone SVG of distance protection zones and apparent impedance trajectories.
 */
export function renderRxDiagramSvg(options: RxDiagramOptions = {}): string {
  const width = options.width ?? 750;
  const height = options.height ?? 750;
  const isDark = (options.theme ?? "dark") === "dark";

  const bgColor = isDark ? "#0f172a" : "#ffffff";
  const axisColor = isDark ? "#64748b" : "#94a3b8";
  const gridColor = isDark ? "#1e293b" : "#f1f5f9";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const zones = options.zones ?? [];
  const trajectory = options.trajectory ?? [];

  // Determine coordinate bounds
  let maxVal = 20.0;
  for (const z of zones) {
    maxVal = Math.max(maxVal, z.reachOhm * 1.3);
  }
  for (const p of trajectory) {
    maxVal = Math.max(maxVal, Math.abs(p.rOhm) * 1.2, Math.abs(p.xOhm) * 1.2);
  }

  const rMin = options.rRange?.min ?? -maxVal * 0.4;
  const rMax = options.rRange?.max ?? maxVal;
  const xMin = options.xRange?.min ?? -maxVal * 0.3;
  const xMax = options.xRange?.max ?? maxVal * 1.1;

  // Viewport padding
  const pad = 60;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  // Coordinate transforms: world (R, X) -> screen (px, py)
  const mapR = (r: number) => pad + ((r - rMin) / (rMax - rMin)) * plotW;
  const mapX = (x: number) => pad + plotH - ((x - xMin) / (xMax - xMin)) * plotH;

  const originX = mapR(0);
  const originY = mapX(0);

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${bgColor};font-family:Inter,system-ui,sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <filter id="rx-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="blur"/><feComposite in="SourceGraphic" in2="blur" operator="over"/></filter>\n`;
  svg += `    <marker id="traj-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 2 L 8 5 L 0 8 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n\n`;

  // Title
  const title = options.title ?? "Distance Protection Characteristic (R-X Plane)";
  svg += `  <text x="${width / 2}" y="32" fill="${textColor}" font-size="16" font-weight="700" text-anchor="middle">${title}</text>\n`;

  // Grid Lines
  const rStep = Math.pow(10, Math.floor(Math.log10((rMax - rMin) / 6)));
  const xStep = Math.pow(10, Math.floor(Math.log10((xMax - xMin) / 6)));

  svg += `  <!-- Grid & Axes -->\n`;
  for (let r = Math.ceil(rMin / rStep) * rStep; r <= rMax; r += rStep) {
    if (Math.abs(r) < 1e-6) continue;
    const sx = mapR(r);
    svg += `  <line x1="${sx.toFixed(1)}" y1="${pad}" x2="${sx.toFixed(1)}" y2="${pad + plotH}" stroke="${gridColor}" stroke-width="1" stroke-dasharray="3,3" />\n`;
    svg += `  <text x="${sx.toFixed(1)}" y="${pad + plotH + 16}" fill="${subTextColor}" font-size="10" text-anchor="middle">${r.toFixed(0)}Ω</text>\n`;
  }
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
    if (Math.abs(x) < 1e-6) continue;
    const sy = mapX(x);
    svg += `  <line x1="${pad}" y1="${sy.toFixed(1)}" x2="${pad + plotW}" y2="${sy.toFixed(1)}" stroke="${gridColor}" stroke-width="1" stroke-dasharray="3,3" />\n`;
    svg += `  <text x="${pad - 8}" y="${(sy + 4).toFixed(1)}" fill="${subTextColor}" font-size="10" text-anchor="end">${x.toFixed(0)}Ω</text>\n`;
  }

  // Major Axes (R = 0 and X = 0)
  svg += `  <line x1="${pad}" y1="${originY.toFixed(1)}" x2="${pad + plotW}" y2="${originY.toFixed(1)}" stroke="${axisColor}" stroke-width="1.5" />\n`;
  svg += `  <line x1="${originX.toFixed(1)}" y1="${pad}" x2="${originX.toFixed(1)}" y2="${pad + plotH}" stroke="${axisColor}" stroke-width="1.5" />\n`;
  svg += `  <text x="${pad + plotW + 15}" y="${(originY + 4).toFixed(1)}" fill="${textColor}" font-size="12" font-weight="600">R (Ω)</text>\n`;
  svg += `  <text x="${originX.toFixed(1)}" y="${pad - 12}" fill="${textColor}" font-size="12" font-weight="600" text-anchor="middle">X (Ω)</text>\n\n`;

  // Render Protection Zones (Outer Zone 3 first, then Zone 2, then Zone 1)
  const sortedZones = [...zones].sort((a, b) => b.reachOhm - a.reachOhm);
  svg += `  <!-- Protection Reach Zones -->\n`;

  for (const zone of sortedZones) {
    const color = zone.color ?? DEFAULT_ZONE_COLORS[zone.zoneNumber] ?? "#ef4444";
    const thetaRad = (zone.lineAngleDeg * Math.PI) / 180.0;

    if (zone.characteristic === "mho") {
      // Mho Circle through origin
      const centerR = (zone.reachOhm * Math.cos(thetaRad)) / 2.0;
      const centerX = (zone.reachOhm * Math.sin(thetaRad)) / 2.0;
      const radiusOhm = zone.reachOhm / 2.0;

      const scX = mapR(centerR);
      const scY = mapX(centerX);
      const sRadius = (radiusOhm / (rMax - rMin)) * plotW;

      svg += `  <g class="rx-zone" data-zone="${zone.zoneNumber}">\n`;
      svg += `    <circle cx="${scX.toFixed(1)}" cy="${scY.toFixed(1)}" r="${sRadius.toFixed(1)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="2" />\n`;
      svg += `    <text x="${(scX + sRadius * 0.7).toFixed(1)}" y="${(scY - sRadius * 0.7).toFixed(1)}" fill="${color}" font-size="11" font-weight="700">Zone ${zone.zoneNumber} (${zone.reachOhm.toFixed(1)}Ω)</text>\n`;
      svg += `  </g>\n`;
    } else {
      // Quadrilateral Polygon
      const rReach = zone.resistanceReachOhm ?? zone.reachOhm * Math.cos(thetaRad) * 1.5;
      const xReach = zone.reachOhm * Math.sin(thetaRad);

      const p1 = `${mapR(-rReach).toFixed(1)},${mapX(0).toFixed(1)}`;
      const p2 = `${mapR(-rReach).toFixed(1)},${mapX(xReach).toFixed(1)}`;
      const p3 = `${mapR(rReach).toFixed(1)},${mapX(xReach).toFixed(1)}`;
      const p4 = `${mapR(rReach).toFixed(1)},${mapX(0).toFixed(1)}`;

      svg += `  <g class="rx-zone" data-zone="${zone.zoneNumber}">\n`;
      svg += `    <polygon points="${p1} ${p2} ${p3} ${p4}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="2" stroke-dasharray="4,2" />\n`;
      svg += `    <text x="${mapR(rReach * 0.5).toFixed(1)}" y="${mapX(xReach + 0.5).toFixed(1)}" fill="${color}" font-size="11" font-weight="700">Zone ${zone.zoneNumber} (Quad)</text>\n`;
      svg += `  </g>\n`;
    }
  }

  // Characteristic Line Angle Vector
  if (zones.length > 0) {
    const mainAngle = zones[0]!.lineAngleDeg;
    const maxZ = zones[0]!.reachOhm * 1.2;
    const endR = maxZ * Math.cos((mainAngle * Math.PI) / 180.0);
    const endX = maxZ * Math.sin((mainAngle * Math.PI) / 180.0);
    svg += `  <!-- Characteristic Line Angle -->\n`;
    svg += `  <line x1="${originX.toFixed(1)}" y1="${originY.toFixed(1)}" x2="${mapR(endR).toFixed(1)}" y2="${mapX(endX).toFixed(1)}" stroke="${subTextColor}" stroke-width="1.5" stroke-dasharray="4,4" />\n`;
    svg += `  <text x="${mapR(endR).toFixed(1)}" y="${(mapX(endX) - 8).toFixed(1)}" fill="${subTextColor}" font-size="10">Line θ = ${mainAngle.toFixed(0)}°</text>\n`;
  }

  // Apparent Impedance Trajectory
  if (trajectory.length > 1) {
    svg += `  <!-- Apparent Impedance Trajectory Z_app(t) -->\n`;
    let d = "";
    for (let i = 0; i < trajectory.length; i++) {
      const pt = trajectory[i]!;
      const sx = mapR(pt.rOhm);
      const sy = mapX(pt.xOhm);
      d += i === 0 ? `M ${sx.toFixed(1)} ${sy.toFixed(1)} ` : `L ${sx.toFixed(1)} ${sy.toFixed(1)} `;
    }
    svg += `  <path d="${d}" fill="none" stroke="#38bdf8" stroke-width="2.5" marker-end="url(#traj-arrow)" />\n`;

    // Render trajectory waypoints
    for (const pt of trajectory) {
      const sx = mapR(pt.rOhm);
      const sy = mapX(pt.xOhm);
      svg += `  <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.5" fill="#38bdf8" stroke="${bgColor}" stroke-width="1.5" />\n`;
      if (pt.label) {
        svg += `  <text x="${(sx + 6).toFixed(1)}" y="${(sy - 6).toFixed(1)}" fill="#38bdf8" font-size="9" font-weight="600">${pt.label}</text>\n`;
      }
    }
  }

  // Fault Trip Point Marker
  if (options.tripPoint) {
    const tp = options.tripPoint;
    const sx = mapR(tp.rOhm);
    const sy = mapX(tp.xOhm);
    svg += `  <!-- Trip Marker -->\n`;
    svg += `  <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="8" fill="#ef4444" fill-opacity="0.8" stroke="#ffffff" stroke-width="2" filter="url(#rx-glow)" />\n`;
    svg += `  <text x="${(sx + 12).toFixed(1)}" y="${(sy + 4).toFixed(1)}" fill="#ef4444" font-size="12" font-weight="700">TRIP Zone ${tp.zone} (t=${(tp.tSec * 1000).toFixed(0)}ms)</text>\n`;
  }

  // Legend
  svg += `  <!-- Legend -->\n`;
  svg += `  <g transform="translate(${pad + 10}, ${pad + 15})">\n`;
  svg += `    <rect width="180" height="90" rx="6" fill="${bgColor}" fill-opacity="0.85" stroke="${axisColor}" stroke-width="1" />\n`;
  svg += `    <circle cx="15" cy="20" r="5" fill="#ef4444" />\n`;
  svg += `    <text x="28" y="24" fill="${textColor}" font-size="10">Zone 1 (Instantaneous)</text>\n`;
  svg += `    <circle cx="15" cy="40" r="5" fill="#f59e0b" />\n`;
  svg += `    <text x="28" y="44" fill="${textColor}" font-size="10">Zone 2 (Time-Delayed)</text>\n`;
  svg += `    <circle cx="15" cy="60" r="5" fill="#3b82f6" />\n`;
  svg += `    <text x="28" y="64" fill="${textColor}" font-size="10">Zone 3 (Remote Backup)</text>\n`;
  svg += `    <line x1="10" y1="78" x2="20" y2="78" stroke="#38bdf8" stroke-width="2.5" />\n`;
  svg += `    <text x="28" y="82" fill="#38bdf8" font-size="10">Z_app(t) Trajectory</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
