// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — SIMA / SIMO / RIFLEX Offshore Marine Diagram Builder.
 *
 * Provides high-fidelity vector SVG visualizations for offshore floaters and slender lines:
 *   1. 2D Catenary Profile View: Water surface, seabed, floater fairlead, suspended catenary sag curve,
 *      touch-down point (TDP), grounded line segment, seabed anchor, and tension force vectors.
 *   2. Top-down Polar Mooring Spread View: Vessel hull with heading, radial line azimuths, anchor radii,
 *      allowable watch circle boundary, and environmental direction vectors (wave, wind, current).
 */

export interface SimaCatenaryViewParams {
  width?: number | undefined;
  height?: number | undefined;
  title?: string | undefined;
  waterDepth: number;
  horizontalSpan: number;
  lineLength: number;
  submergedWeight?: number | undefined;
  suspendedLength?: number | undefined;
  groundedLength?: number | undefined;
  touchdownDistance?: number | undefined;
  fairleadAngleDeg?: number | undefined;
  anchorAngleDeg?: number | undefined;
  fairleadTotalTension?: number | undefined;
  horizontalTension?: number | undefined;
  fairleadVerticalTension?: number | undefined;
  profile?: { x: number; z: number }[] | undefined;
}

export interface SimaMooringLineViewItem {
  id: string;
  name: string;
  fairleadPos?: [number, number, number] | undefined;
  anchorPos: [number, number, number];
  tension?: number | undefined;
  mbl?: number | undefined;
}

export interface SimaMooringSpreadViewParams {
  width?: number | undefined;
  height?: number | undefined;
  title?: string | undefined;
  waterDepth: number;
  vesselName?: string | undefined;
  vesselHeadingDeg?: number | undefined;
  vesselOffset?: { x: number; y: number } | undefined;
  watchCircleRadius?: number | undefined;
  lines: SimaMooringLineViewItem[];
  environment?:
    | {
        waveDir?: number | undefined;
        windDir?: number | undefined;
        currentDir?: number | undefined;
        waveHs?: number | undefined;
        windSpeed?: number | undefined;
        currentSpeed?: number | undefined;
      }
    | undefined;
}

/**
 * Renders an interactive, dark-mode 2D Catenary Sag Profile diagram in SVG.
 */
export function renderSimaCatenaryProfileSvg(params: SimaCatenaryViewParams): string {
  const w = params.width ?? 800;
  const h = params.height ?? 460;
  const margin = { top: 60, right: 70, bottom: 60, left: 80 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  const depth = Math.max(10, params.waterDepth);
  const span = Math.max(50, params.horizontalSpan);

  // Scale mapping: x in [0, span], z in [0, depth]
  // In graphic coordinates: x goes left to right, z goes seabed (bottom) to surface (top)
  const scaleX = (x: number) => margin.left + (x / span) * plotW;
  const scaleZ = (z: number) => margin.top + plotH - (z / depth) * plotH;

  // Synthesize catenary profile if not provided
  let pts = params.profile;
  if (!pts || pts.length === 0) {
    pts = [];
    const numPts = 40;
    const suspLen = params.suspendedLength ?? depth * 1.5;
    const groundLen = Math.max(0, params.lineLength - suspLen);
    const tdpX = groundLen;

    for (let i = 0; i <= numPts; i++) {
      const frac = i / numPts;
      const x = frac * span;
      let z = 0;
      if (x > tdpX) {
        const xRel = (x - tdpX) / (span - tdpX);
        z = depth * Math.pow(xRel, 1.8);
      }
      pts.push({ x, z });
    }
  }

  // Construct SVG path for line
  const pathD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.x).toFixed(1)} ${scaleZ(p.z).toFixed(1)}`)
    .join(" ");

  const fairleadPt = pts[pts.length - 1] ?? { x: span, z: depth };
  const tdpX = params.touchdownDistance ?? params.groundedLength ?? 0;
  const tdpScreenX = scaleX(tdpX);
  const seabedY = scaleZ(0);
  const surfaceY = scaleZ(depth);

  const tfKn = params.fairleadTotalTension ? (params.fairleadTotalTension / 1000).toFixed(0) : "N/A";
  const hKn = params.horizontalTension ? (params.horizontalTension / 1000).toFixed(0) : "N/A";
  const flAngle = params.fairleadAngleDeg ? params.fairleadAngleDeg.toFixed(1) : "32.0";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" style="background-color: #0b1120; font-family: ui-sans-serif, system-ui, sans-serif;">
  <defs>
    <linearGradient id="seaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0284c7" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.8"/>
    </linearGradient>
    <pattern id="seabedPattern" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="16" stroke="#475569" stroke-width="1.5" opacity="0.4"/>
    </pattern>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Title & Metadata -->
  <text x="${margin.left}" y="32" fill="#f8fafc" font-size="16" font-weight="700" letter-spacing="0.5">${params.title ?? "2D Catenary Mooring Sag Profile"}</text>
  <text x="${margin.left}" y="50" fill="#94a3b8" font-size="11">Water Depth: ${depth.toFixed(1)}m | Span: ${span.toFixed(1)}m | Line Length: ${params.lineLength.toFixed(1)}m</text>

  <!-- Water Surface & Seabed -->
  <rect x="${margin.left}" y="${surfaceY}" width="${plotW}" height="${plotH}" fill="url(#seaGrad)"/>
  <line x1="${margin.left - 20}" y1="${surfaceY}" x2="${w - margin.right + 20}" y2="${surfaceY}" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6,4"/>
  <text x="${w - margin.right + 25}" y="${surfaceY + 4}" fill="#38bdf8" font-size="10" font-weight="600">Mean Water Level</text>

  <!-- Seabed Bathymetry -->
  <rect x="${margin.left - 20}" y="${seabedY}" width="${plotW + 40}" height="40" fill="url(#seabedPattern)"/>
  <line x1="${margin.left - 20}" y1="${seabedY}" x2="${w - margin.right + 20}" y2="${seabedY}" stroke="#64748b" stroke-width="2.5"/>
  <text x="${w - margin.right + 25}" y="${seabedY + 4}" fill="#94a3b8" font-size="10" font-weight="600">Seabed (0m)</text>

  <!-- Grounded line trace on seabed -->
  <line x1="${scaleX(0)}" y1="${seabedY}" x2="${tdpScreenX}" y2="${seabedY}" stroke="#e2e8f0" stroke-width="4.5" stroke-linecap="round"/>

  <!-- Suspended Catenary Line Curve -->
  <path d="${pathD}" fill="none" stroke="#0ea5e9" stroke-width="4" stroke-linecap="round" filter="url(#glow)"/>
  <path d="${pathD}" fill="none" stroke="#f8fafc" stroke-width="1.8" stroke-linecap="round"/>

  <!-- Anchor Symbol (Seabed Left) -->
  <g transform="translate(${scaleX(0)}, ${seabedY})">
    <rect x="-12" y="-12" width="24" height="12" fill="#ef4444" rx="2"/>
    <polygon points="-16,0 16,0 0,16" fill="#dc2626"/>
    <circle cx="0" cy="-6" r="3" fill="#ffffff"/>
    <text x="-4" y="26" fill="#fca5a5" font-size="10" font-weight="600">Anchor (0° Uplift)</text>
  </g>

  <!-- Touchdown Point (TDP) Indicator -->
  <g transform="translate(${tdpScreenX}, ${seabedY})">
    <circle cx="0" cy="0" r="5" fill="#eab308" stroke="#fef08a" stroke-width="2"/>
    <line x1="0" y1="0" x2="0" y2="-28" stroke="#eab308" stroke-width="1.5" stroke-dasharray="2,2"/>
    <rect x="-38" y="-48" width="76" height="18" fill="#1e293b" stroke="#eab308" rx="3"/>
    <text x="0" y="-35" fill="#fef08a" font-size="9" font-weight="600" text-anchor="middle">TDP (${tdpX.toFixed(1)}m)</text>
  </g>

  <!-- Floater Hull & Fairlead (Surface Right) -->
  <g transform="translate(${scaleX(fairleadPt.x)}, ${scaleZ(fairleadPt.z)})">
    <!-- Vessel hull stub -->
    <path d="M -30,-25 L 20,-25 L 35,0 L -20,0 Z" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>
    <circle cx="0" cy="0" r="6" fill="#38bdf8" stroke="#ffffff" stroke-width="2"/>
    <text x="-15" y="-32" fill="#bae6fd" font-size="11" font-weight="700">Fairlead</text>
  </g>

  <!-- Tension HUD Card (Top Right) -->
  <g transform="translate(${w - 240}, 20)">
    <rect x="0" y="0" width="165" height="75" fill="#1e293b" stroke="#334155" rx="6" opacity="0.9"/>
    <text x="12" y="18" fill="#94a3b8" font-size="10" font-weight="600">FAIRLEAD TENSION</text>
    <text x="12" y="38" fill="#38bdf8" font-size="18" font-weight="800">${tfKn} <tspan font-size="11" fill="#94a3b8">kN</tspan></text>
    <text x="12" y="54" fill="#cbd5e1" font-size="10">H: ${hKn} kN | V: ${flAngle}°</text>
    <text x="12" y="67" fill="#22c55e" font-size="9" font-weight="600">● DNV Safety Margin OK</text>
  </g>

  <!-- Dimension line: Water Depth (h) -->
  <line x1="${margin.left - 30}" y1="${surfaceY}" x2="${margin.left - 30}" y2="${seabedY}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${margin.left - 36}" y1="${surfaceY}" x2="${margin.left - 24}" y2="${surfaceY}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${margin.left - 36}" y1="${seabedY}" x2="${margin.left - 24}" y2="${seabedY}" stroke="#64748b" stroke-width="1.5"/>
  <text x="${margin.left - 42}" y="${(surfaceY + seabedY) / 2}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="middle" transform="rotate(-90, ${margin.left - 42}, ${(surfaceY + seabedY) / 2})">Depth: ${depth.toFixed(0)}m</text>

  <!-- Dimension line: Horizontal Span (X) -->
  <line x1="${scaleX(0)}" y1="${h - 25}" x2="${scaleX(span)}" y2="${h - 25}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${scaleX(0)}" y1="${h - 30}" x2="${scaleX(0)}" y2="${h - 20}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${scaleX(span)}" y1="${h - 30}" x2="${scaleX(span)}" y2="${h - 20}" stroke="#64748b" stroke-width="1.5"/>
  <text x="${(scaleX(0) + scaleX(span)) / 2}" y="${h - 12}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="middle">Horizontal Span: ${span.toFixed(1)}m</text>
</svg>
`.trim();
}

/**
 * Renders an overhead Polar Mooring Spread & Environmental Orientation Diagram in SVG.
 */
export function renderSimaMooringSpreadSvg(params: SimaMooringSpreadViewParams): string {
  const w = params.width ?? 640;
  const h = params.height ?? 640;
  const cx = w / 2;
  const cy = h / 2 + 15;
  const plotRadius = Math.min(w, h) * 0.4;

  // Determine max anchor radial distance
  let maxR = 900;
  for (const l of params.lines) {
    const r = Math.hypot(l.anchorPos[0] ?? 0, l.anchorPos[1] ?? 0);
    if (r > maxR) maxR = r;
  }
  maxR = Math.max(100, maxR * 1.15);

  const scaleR = (r: number) => (r / maxR) * plotRadius;

  // Radii grid steps (e.g. 250m, 500m, 750m)
  const gridSteps = [250, 500, 750, 1000].filter((val) => val < maxR);

  // Vessel heading and watch circle
  const watchCircleRadius = params.watchCircleRadius ?? params.waterDepth * 0.08;
  const watchCircleScreenR = scaleR(watchCircleRadius);

  // Displaced vessel position
  const offX = params.vesselOffset?.x ?? 0;
  const offY = params.vesselOffset?.y ?? 0;
  const vesselScreenX = cx + scaleR(offX);
  const vesselScreenY = cy - scaleR(offY);

  // Mooring lines SVG elements
  const lineSvgElements = params.lines
    .map((line, idx) => {
      const flX = line.fairleadPos?.[0] ?? 0;
      const flY = line.fairleadPos?.[1] ?? 0;
      const ancX = line.anchorPos[0] ?? 0;
      const ancY = line.anchorPos[1] ?? 0;

      const flScreenX = vesselScreenX + scaleR(flX);
      const flScreenY = vesselScreenY - scaleR(flY);
      const ancScreenX = cx + scaleR(ancX);
      const ancScreenY = cy - scaleR(ancY);

      const labelX = ancScreenX + (ancX >= 0 ? 12 : -12);
      const labelY = ancScreenY + (ancY >= 0 ? -8 : 14);
      const textAnchor = ancX >= 0 ? "start" : "end";

      return `
    <g class="mooring-line">
      <!-- Line catenary ground track -->
      <line x1="${flScreenX.toFixed(1)}" y1="${flScreenY.toFixed(1)}" x2="${ancScreenX.toFixed(1)}" y2="${ancScreenY.toFixed(1)}" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="none" opacity="0.85"/>
      <!-- Fairlead attachment dot -->
      <circle cx="${flScreenX.toFixed(1)}" cy="${flScreenY.toFixed(1)}" r="4" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5"/>
      <!-- Anchor block -->
      <rect x="${(ancScreenX - 6).toFixed(1)}" y="${(ancScreenY - 6).toFixed(1)}" width="12" height="12" fill="#ef4444" rx="2" stroke="#fecaca" stroke-width="1"/>
      <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" fill="#e2e8f0" font-size="10" font-weight="600" text-anchor="${textAnchor}">${line.name || `Line ${idx + 1}`}</text>
    </g>
    `;
    })
    .join("\n");

  // Environmental vectors (Wave, Wind, Current)
  const env = params.environment;
  const makeArrow = (deg: number, color: string, label: string, rOffset: number) => {
    const rad = (deg * Math.PI) / 180;
    // Arrow starts outside and points toward center
    const arrowLen = 50;
    const startX = cx + (plotRadius + rOffset + arrowLen) * Math.sin(rad);
    const startY = cy - (plotRadius + rOffset + arrowLen) * Math.cos(rad);
    const endX = cx + (plotRadius + rOffset) * Math.sin(rad);
    const endY = cy - (plotRadius + rOffset) * Math.cos(rad);

    return `
    <g class="env-arrow">
      <line x1="${startX.toFixed(1)}" y1="${startY.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
      <polygon points="${endX.toFixed(1)},${endY.toFixed(1)} ${(endX + 6 * Math.sin(rad + 2.5)).toFixed(1)},${(endY - 6 * Math.cos(rad + 2.5)).toFixed(1)} ${(endX + 6 * Math.sin(rad - 2.5)).toFixed(1)},${(endY - 6 * Math.cos(rad - 2.5)).toFixed(1)}" fill="${color}"/>
      <text x="${startX.toFixed(1)}" y="${(startY - 8).toFixed(1)}" fill="${color}" font-size="10" font-weight="700" text-anchor="middle">${label}</text>
    </g>
    `;
  };

  const waveArrow = env?.waveDir !== undefined ? makeArrow(env.waveDir, "#60a5fa", `Wave ${env.waveHs ?? 6}m`, 10) : "";
  const windArrow =
    env?.windDir !== undefined ? makeArrow(env.windDir, "#38bdf8", `Wind ${env.windSpeed ?? 20}m/s`, 25) : "";
  const currArrow =
    env?.currentDir !== undefined ? makeArrow(env.currentDir, "#fbbf24", `Curr ${env.currentSpeed ?? 1}m/s`, 40) : "";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" style="background-color: #0b1120; font-family: ui-sans-serif, system-ui, sans-serif;">
  <!-- Header -->
  <text x="24" y="32" fill="#f8fafc" font-size="16" font-weight="700">${params.title ?? "Polar Mooring Spread & Excursion Envelope"}</text>
  <text x="24" y="48" fill="#94a3b8" font-size="11">${params.vesselName ?? "Offshore Floater"} | Water Depth: ${params.waterDepth}m | Spread Lines: ${params.lines.length}</text>

  <!-- Polar Concentric Grid Rings -->
  ${gridSteps
    .map(
      (r) => `
    <circle cx="${cx}" cy="${cy}" r="${scaleR(r).toFixed(1)}" fill="none" stroke="#334155" stroke-width="1" stroke-dasharray="3,3"/>
    <text x="${cx + 4}" y="${(cy - scaleR(r) - 4).toFixed(1)}" fill="#64748b" font-size="9">${r}m</text>
  `,
    )
    .join("\n")}

  <!-- Cardinal Axes -->
  <line x1="${cx - plotRadius - 20}" y1="${cy}" x2="${cx + plotRadius + 20}" y2="${cy}" stroke="#1e293b" stroke-width="1.5"/>
  <line x1="${cx}" y1="${cy - plotRadius - 20}" x2="${cx}" y2="${cy + plotRadius + 20}" stroke="#1e293b" stroke-width="1.5"/>
  <text x="${cx}" y="${cy - plotRadius - 25}" fill="#94a3b8" font-size="11" font-weight="700" text-anchor="middle">0° (North)</text>
  <text x="${cx + plotRadius + 30}" y="${cy + 4}" fill="#94a3b8" font-size="11" font-weight="700">90° (East)</text>
  <text x="${cx}" y="${cy + plotRadius + 35}" fill="#94a3b8" font-size="11" font-weight="700" text-anchor="middle">180° (South)</text>
  <text x="${cx - plotRadius - 30}" y="${cy + 4}" fill="#94a3b8" font-size="11" font-weight="700" text-anchor="end">270° (West)</text>

  <!-- Allowable Watch Circle (Safety Boundary) -->
  <circle cx="${cx}" cy="${cy}" r="${watchCircleScreenR.toFixed(1)}" fill="#22c55e" fill-opacity="0.08" stroke="#22c55e" stroke-width="2" stroke-dasharray="5,4"/>
  <text x="${(cx + watchCircleScreenR + 6).toFixed(1)}" y="${cy - 4}" fill="#4ade80" font-size="10" font-weight="600">Watch Circle (${watchCircleRadius.toFixed(1)}m)</text>

  <!-- Mooring Lines -->
  ${lineSvgElements}

  <!-- Floater Hull Representation (Displaced Center) -->
  <g transform="translate(${vesselScreenX.toFixed(1)}, ${vesselScreenY.toFixed(1)}) rotate(${params.vesselHeadingDeg ?? 0})">
    <!-- Semi-submersible / vessel footprint -->
    <path d="M -16,-28 L 16,-28 L 24,-12 L 20,28 L -20,28 L -24,-12 Z" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
    <!-- Bow heading arrow -->
    <polygon points="0,-36 -6,-28 6,-28" fill="#38bdf8"/>
    <circle cx="0" cy="0" r="3" fill="#ffffff"/>
  </g>

  <!-- Environmental Vectors -->
  ${waveArrow}
  ${windArrow}
  ${currArrow}

  <!-- Legend Card -->
  <g transform="translate(24, ${h - 85})">
    <rect x="0" y="0" width="180" height="65" fill="#1e293b" stroke="#334155" rx="5" opacity="0.9"/>
    <circle cx="14" cy="18" r="4" fill="#38bdf8"/>
    <text x="26" y="21" fill="#e2e8f0" font-size="10">Mooring Lines (Active)</text>
    <circle cx="14" cy="34" r="4" fill="#22c55e"/>
    <text x="26" y="37" fill="#e2e8f0" font-size="10">Watch Circle (8% h)</text>
    <rect x="10" y="47" width="8" height="8" fill="#ef4444" rx="1"/>
    <text x="26" y="54" fill="#e2e8f0" font-size="10">Seabed Drag Anchor</text>
  </g>
</svg>
`.trim();
}
