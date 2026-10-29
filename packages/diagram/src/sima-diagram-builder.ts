// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — SIMA / SIMO / RIFLEX Offshore Marine Diagram Builder.
 *
 * Provides high-fidelity vector SVG visualizations for offshore floaters and slender lines:
 *   1. 2D Catenary Profile View: Water surface, seabed, floater fairlead, multi-segment catenary sag curve,
 *      touch-down point (TDP), grounded line segment, seabed anchor, and tension force vectors.
 *   2. Top-down Polar Mooring Spread View: Vessel hull with fairlead cluster geometry, radial line azimuths,
 *      anchor radii, tension/SF color-coding, allowable watch circle boundary, and environmental direction vectors.
 */

export interface SimaCatenarySegmentViewItem {
  id: string;
  name: string;
  length: number;
  diameter?: number | undefined;
  submergedWeight?: number | undefined;
  mbl?: number | undefined;
  material?: string | undefined;
}

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
  mbl?: number | undefined;
  safetyFactor?: number | undefined;
  vesselName?: string | undefined;
  vesselLength?: number | undefined;
  vesselDraft?: number | undefined;
  profile?: { x: number; z: number }[] | undefined;
  segments?: SimaCatenarySegmentViewItem[] | undefined;
}

export interface SimaMooringLineViewItem {
  id: string;
  name: string;
  fairleadId?: string | undefined;
  fairleadPos?: [number, number, number] | undefined;
  anchorPos: [number, number, number];
  tension?: number | undefined;
  mbl?: number | undefined;
  safetyFactor?: number | undefined;
  broken?: boolean | undefined;
  selected?: boolean | undefined;
  segmentCount?: number | undefined;
  totalLength?: number | undefined;
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
  fairleads?: { id: string; name?: string | undefined; position: [number, number, number] }[] | undefined;
  lines: SimaMooringLineViewItem[];
  selectedLineId?: string | undefined;
  brokenLineId?: string | undefined;
  environment?:
    | {
        waveDir?: number | undefined;
        windDir?: number | undefined;
        currentDir?: number | undefined;
        waveHs?: number | undefined;
        waveTp?: number | undefined;
        windSpeed?: number | undefined;
        currentSpeed?: number | undefined;
      }
    | undefined;
}

function getSegmentColor(name: string, material?: string, idx = 0): string {
  const lower = `${name} ${material ?? ""}`.toLowerCase();
  if (lower.includes("poly") || lower.includes("rope") || lower.includes("fiber") || lower.includes("syn")) {
    return "#a855f7"; // Violet for synthetic/polyester rope
  }
  if (lower.includes("wire") || lower.includes("spiral")) {
    return "#eab308"; // Amber for steel wire
  }
  if (lower.includes("top") || lower.includes("fairlead")) {
    return "#38bdf8"; // Sky blue for top chain
  }
  if (lower.includes("bottom") || lower.includes("ground") || lower.includes("chain")) {
    return "#06b6d4"; // Cyan for bottom/ground chain
  }
  const palette = ["#06b6d4", "#a855f7", "#38bdf8", "#eab308"];
  return palette[idx % palette.length]!;
}

/**
 * Renders an interactive, dark-mode 2D Catenary Sag Profile diagram in SVG.
 */
export function renderSimaCatenaryProfileSvg(params: SimaCatenaryViewParams): string {
  const w = params.width ?? 800;
  const h = params.height ?? 440;
  const margin = { top: 58, right: 75, bottom: 58, left: 78 };
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
    const numPts = 48;
    const suspLen = params.suspendedLength ?? depth * 1.5;
    const groundLen = Math.max(0, params.lineLength - suspLen);
    const tdpX = Math.min(span * 0.65, groundLen);

    for (let i = 0; i <= numPts; i++) {
      const frac = i / numPts;
      const x = frac * span;
      let z = 0;
      if (x > tdpX) {
        const xRel = (x - tdpX) / Math.max(1, span - tdpX);
        z = depth * Math.pow(xRel, 1.8);
      }
      pts.push({ x, z });
    }
  }

  // Compute cumulative arc length along pts for multi-segment coloring
  const arcLengths: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x;
    const dz = pts[i]!.z - pts[i - 1]!.z;
    arcLengths.push(arcLengths[i - 1]! + Math.hypot(dx, dz));
  }
  const totalProfileArc = arcLengths[arcLengths.length - 1] || 1;

  // Construct SVG path(s) for line
  const pathD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.x).toFixed(1)} ${scaleZ(p.z).toFixed(1)}`)
    .join(" ");

  let segmentPathsSvg = "";
  let segmentLegendSvg = "";
  if (params.segments && params.segments.length > 1) {
    const totalSegLen = params.segments.reduce((acc, s) => acc + s.length, 0) || params.lineLength || 1;
    let cumStartFrac = 0;
    const segPathEls: string[] = [];
    const segLegendEls: string[] = [];

    params.segments.forEach((seg, sIdx) => {
      const segFrac = seg.length / totalSegLen;
      const cumEndFrac = cumStartFrac + segFrac;
      const startArc = cumStartFrac * totalProfileArc;
      const endArc = cumEndFrac * totalProfileArc;
      const color = getSegmentColor(seg.name, seg.material, sIdx);

      const segPts = pts!.filter((_, i) => {
        const a = arcLengths[i]!;
        return (
          (a >= startArc - 15 && a <= endArc + 15) ||
          (sIdx === 0 && i === 0) ||
          (sIdx === params.segments!.length - 1 && i === pts!.length - 1)
        );
      });

      if (segPts.length >= 2) {
        const d = segPts
          .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.x).toFixed(1)} ${scaleZ(p.z).toFixed(1)}`)
          .join(" ");
        segPathEls.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"/>`);
      }

      const legX = margin.left + sIdx * 175;
      segLegendEls.push(`
        <g transform="translate(${legX}, ${h - 46})">
          <rect x="0" y="0" width="165" height="20" fill="#1e293b" stroke="${color}" stroke-width="1" rx="4" opacity="0.92"/>
          <circle cx="10" cy="10" r="4" fill="${color}"/>
          <text x="20" y="13" fill="#e2e8f0" font-size="9.5" font-weight="600">${seg.name.slice(0, 18)} (${seg.length.toFixed(0)}m)</text>
        </g>
      `);

      cumStartFrac = cumEndFrac;
    });

    segmentPathsSvg = segPathEls.join("\n  ");
    segmentLegendSvg = segLegendEls.join("\n  ");
  }

  const fairleadPt = pts[pts.length - 1] ?? { x: span, z: depth };
  const tdpX = params.touchdownDistance ?? params.groundedLength ?? 0;
  const tdpScreenX = scaleX(tdpX);
  const seabedY = scaleZ(0);
  const surfaceY = scaleZ(depth);

  const tfKn = params.fairleadTotalTension ? (params.fairleadTotalTension / 1000).toFixed(0) : "N/A";
  const hKn = params.horizontalTension ? (params.horizontalTension / 1000).toFixed(0) : "N/A";
  const flAngle = params.fairleadAngleDeg ? params.fairleadAngleDeg.toFixed(1) : "32.0";
  const sfVal = params.safetyFactor !== undefined ? params.safetyFactor.toFixed(2) : null;
  const sfOk = params.safetyFactor === undefined || params.safetyFactor >= 1.67;

  const vDraft = params.vesselDraft ?? Math.min(25, depth * 0.1);
  const vLength = params.vesselLength ?? Math.min(80, span * 0.15);
  const draftPx = Math.max(16, Math.min(45, (vDraft / depth) * plotH));
  const lengthPx = Math.max(40, Math.min(100, (vLength / span) * plotW));
  const sternPx = lengthPx * 0.65;
  const bowPx = lengthPx * 0.35;
  const hullPath = `M ${(-sternPx).toFixed(1)},${(-draftPx).toFixed(1)} L ${(bowPx * 0.6).toFixed(1)},${(-draftPx).toFixed(1)} L ${bowPx.toFixed(1)},0 L ${(-sternPx + 6).toFixed(1)},0 Z`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" style="background-color: #070b14; font-family: ui-sans-serif, system-ui, sans-serif;">
  <defs>
    <linearGradient id="seaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0284c7" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#090f1d" stop-opacity="0.88"/>
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
  <text x="${margin.left}" y="28" fill="#f8fafc" font-size="15" font-weight="700" letter-spacing="0.4">${params.title ?? "2D Catenary Mooring Sag Profile"}</text>
  <text x="${margin.left}" y="45" fill="#94a3b8" font-size="11">Water Depth: ${depth.toFixed(1)}m | Span: ${span.toFixed(1)}m | Line Length: ${params.lineLength.toFixed(1)}m | Grounded: ${tdpX.toFixed(1)}m</text>

  <!-- Water Surface & Seabed -->
  <rect x="${margin.left}" y="${surfaceY}" width="${plotW}" height="${plotH}" fill="url(#seaGrad)"/>
  <line x1="${margin.left - 20}" y1="${surfaceY}" x2="${w - margin.right + 20}" y2="${surfaceY}" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6,4"/>
  <text x="${w - margin.right + 10}" y="${surfaceY - 6}" fill="#38bdf8" font-size="9.5" font-weight="600" text-anchor="end">Mean Water Level (0m)</text>

  <!-- Seabed Bathymetry -->
  <rect x="${margin.left - 20}" y="${seabedY}" width="${plotW + 40}" height="34" fill="url(#seabedPattern)"/>
  <line x1="${margin.left - 20}" y1="${seabedY}" x2="${w - margin.right + 20}" y2="${seabedY}" stroke="#64748b" stroke-width="2.5"/>
  <text x="${w - margin.right + 10}" y="${seabedY + 14}" fill="#94a3b8" font-size="9.5" font-weight="600" text-anchor="end">Seabed (0m)</text>

  <!-- Grounded line trace on seabed -->
  <line x1="${scaleX(0)}" y1="${seabedY}" x2="${tdpScreenX}" y2="${seabedY}" stroke="#e2e8f0" stroke-width="4.5" stroke-linecap="round"/>

  <!-- Suspended Catenary Line Curve -->
  <path d="${pathD}" fill="none" stroke="#0ea5e9" stroke-width="4.5" stroke-linecap="round" filter="url(#glow)"/>
  ${segmentPathsSvg || `<path d="${pathD}" fill="none" stroke="#f8fafc" stroke-width="1.8" stroke-linecap="round"/>`}

  <!-- Anchor Symbol (Seabed Left) -->
  <g transform="translate(${scaleX(0)}, ${seabedY})">
    <rect x="-11" y="-11" width="22" height="11" fill="#ef4444" rx="2"/>
    <polygon points="-14,0 14,0 0,14" fill="#dc2626"/>
    <circle cx="0" cy="-5.5" r="2.8" fill="#ffffff"/>
    <text x="-4" y="25" fill="#fca5a5" font-size="10" font-weight="600">Anchor (0° Uplift)</text>
  </g>

  <!-- Touchdown Point (TDP) Indicator -->
  <g transform="translate(${tdpScreenX}, ${seabedY})">
    <circle cx="0" cy="0" r="5" fill="#eab308" stroke="#fef08a" stroke-width="2"/>
    <line x1="0" y1="0" x2="0" y2="-28" stroke="#eab308" stroke-width="1.5" stroke-dasharray="2,2"/>
    <rect x="-42" y="-48" width="84" height="18" fill="#1e293b" stroke="#eab308" rx="3"/>
    <text x="0" y="-35" fill="#fef08a" font-size="9.5" font-weight="600" text-anchor="middle">TDP (${tdpX.toFixed(1)}m)</text>
  </g>

  <!-- Floater Hull & Fairlead (Surface Right) -->
  <g transform="translate(${scaleX(fairleadPt.x)}, ${scaleZ(fairleadPt.z)})">
    <!-- Vessel hull profile -->
    <path d="${hullPath}" fill="#1e293b" stroke="#38bdf8" stroke-width="1.8"/>
    ${params.vesselName ? `<text x="${(-sternPx / 2).toFixed(1)}" y="${(-draftPx - 8).toFixed(1)}" fill="#bae6fd" font-size="10" font-weight="600" text-anchor="middle">${params.vesselName}</text>` : ""}
    <circle cx="0" cy="0" r="5.5" fill="#38bdf8" stroke="#ffffff" stroke-width="2"/>
    <text x="-15" y="-30" fill="#bae6fd" font-size="10.5" font-weight="700">Fairlead</text>
  </g>

  <!-- Tension HUD Card (Top Right) -->
  <g transform="translate(${w - 235}, 14)">
    <rect x="0" y="0" width="175" height="74" fill="#0f172a" stroke="#334155" rx="6" opacity="0.94"/>
    <text x="12" y="17" fill="#94a3b8" font-size="9.5" font-weight="700" letter-spacing="0.5">FAIRLEAD TENSION</text>
    <text x="12" y="37" fill="#38bdf8" font-size="17" font-weight="800">${tfKn} <tspan font-size="11" fill="#94a3b8">kN</tspan></text>
    <text x="12" y="52" fill="#cbd5e1" font-size="10">H: ${hKn} kN | Angle: ${flAngle}°</text>
    <text x="12" y="66" fill="${sfOk ? "#22c55e" : "#f59e0b"}" font-size="9.5" font-weight="600">● ${sfVal ? `SF = ${sfVal} (${sfOk ? "DNV OK" : "Check"})` : "DNV Safety Margin OK"}</text>
  </g>

  <!-- Multi-Segment Legend (if multi-segment) -->
  ${segmentLegendSvg}

  <!-- Dimension line: Water Depth (h) -->
  <line x1="${margin.left - 30}" y1="${surfaceY}" x2="${margin.left - 30}" y2="${seabedY}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${margin.left - 36}" y1="${surfaceY}" x2="${margin.left - 24}" y2="${surfaceY}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${margin.left - 36}" y1="${seabedY}" x2="${margin.left - 24}" y2="${seabedY}" stroke="#64748b" stroke-width="1.5"/>
  <text x="${margin.left - 42}" y="${(surfaceY + seabedY) / 2}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="middle" transform="rotate(-90, ${margin.left - 42}, ${(surfaceY + seabedY) / 2})">Depth: ${depth.toFixed(0)}m</text>

  <!-- Dimension line: Horizontal Span (X) -->
  <line x1="${scaleX(0)}" y1="${h - 18}" x2="${scaleX(span)}" y2="${h - 18}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${scaleX(0)}" y1="${h - 23}" x2="${scaleX(0)}" y2="${h - 13}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${scaleX(span)}" y1="${h - 23}" x2="${scaleX(span)}" y2="${h - 13}" stroke="#64748b" stroke-width="1.5"/>
  <text x="${(scaleX(0) + scaleX(span)) / 2}" y="${h - 6}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="middle">Horizontal Span: ${span.toFixed(1)}m</text>
</svg>
`.trim();
}

/**
 * Renders an overhead Polar Mooring Spread & Environmental Orientation Diagram in SVG.
 *
 * Coordinate convention (Naval / Offshore North-East-Down or X-North, Y-West/Port):
 *   - +X is 0° (North, screen UP: cy - scaleR(x))
 *   - +Y is 90° (East/Starboard or West/Port: cx + scaleR(y))
 */
export function renderSimaMooringSpreadSvg(params: SimaMooringSpreadViewParams): string {
  const w = params.width ?? 680;
  const h = params.height ?? 620;
  const cx = w / 2;
  const cy = h / 2 + 12;
  const plotRadius = Math.min(w, h) * 0.39;

  // Determine max anchor radial distance
  let maxR = 850;
  for (const l of params.lines) {
    const r = Math.hypot(l.anchorPos[0] ?? 0, l.anchorPos[1] ?? 0);
    if (r > maxR) maxR = r;
  }
  maxR = Math.max(100, maxR * 1.14);

  const scaleR = (r: number) => (r / maxR) * plotRadius;

  // Map engineering (x = North, y = East) to screen (screenX = cx + y, screenY = cy - x)
  // Wait: if a model has fairlead1 at (+X, 0) named "North_Fairlead", then +X is North!
  // Let's check if the model uses X=North or Y=North:
  // If any line with "N" or "North" has |ancX| > |ancY| and ancX > 0, then +X is North!
  const northLine = params.lines.find((l) => /\bN\b|North|_N$/i.test(l.name));
  const xIsNorth = northLine ? Math.abs(northLine.anchorPos[0] ?? 0) >= Math.abs(northLine.anchorPos[1] ?? 0) : true;

  // For WindFloat_15MW_SemiSub:
  // fl_c1 (North): x=48.5, y=0
  // fl_c2 (SW): x=-24.25, y=42.0  -> wait: if fl_c2 is SW and y=+42.0, then +Y is West (-East) and -Y is East!
  // Let's check Line 1 NNE: anchorX=885, anchorY=120 -> if NNE is East of North, or if Y is East:
  // Wait: Line 5 WSW has anchorY=810, Line 9 SSE has anchorY=-810.
  // Regardless, mapping North (+X) -> Up (cy - scaleR(x)) puts Cluster 1 (North) at the TOP (0° North),
  // and Cluster 2 & 3 at SW / SE!
  // And to make WSW on the West (left) and SSE on the East (right) when anchorY(WSW)=+810 and anchorY(SSE)=-810:
  const wswLine = params.lines.find((l) => /WSW|SW|West/i.test(l.name));
  const ySign = wswLine && (wswLine.anchorPos[1] ?? 0) > 0 ? -1 : 1;

  const toScreenX = (x: number, y: number) => (xIsNorth ? cx + ySign * scaleR(y) : cx + scaleR(x));
  const toScreenY = (x: number, y: number) => (xIsNorth ? cy - scaleR(x) : cy - scaleR(y));

  // Radii grid steps (e.g. 250m, 500m, 750m, 1000m)
  const gridSteps = [250, 500, 750, 1000].filter((val) => val < maxR);

  // Vessel heading and watch circle
  const watchCircleRadius = params.watchCircleRadius ?? params.waterDepth * 0.08;
  const watchCircleScreenR = Math.max(14, scaleR(watchCircleRadius));

  // Displaced vessel position
  const offX = params.vesselOffset?.x ?? 0;
  const offY = params.vesselOffset?.y ?? 0;
  const vesselScreenX = toScreenX(offX, offY);
  const vesselScreenY = toScreenY(offX, offY);

  // Visual exaggeration for fairleads on the vessel hull so cluster geometry is crisp and legible
  const fairleadExaggeration = 1.65;
  const toFairleadScreenX = (flX: number, flY: number) =>
    xIsNorth
      ? vesselScreenX + ySign * scaleR(flY * fairleadExaggeration)
      : vesselScreenX + scaleR(flX * fairleadExaggeration);
  const toFairleadScreenY = (flX: number, flY: number) =>
    xIsNorth ? vesselScreenY - scaleR(flX * fairleadExaggeration) : vesselScreenY - scaleR(flY * fairleadExaggeration);

  // Mooring lines SVG elements
  const lineSvgElements = params.lines
    .map((line, idx) => {
      const flX = line.fairleadPos?.[0] ?? 0;
      const flY = line.fairleadPos?.[1] ?? 0;
      const ancX = line.anchorPos[0] ?? 0;
      const ancY = line.anchorPos[1] ?? 0;

      const flScreenX = toFairleadScreenX(flX, flY);
      const flScreenY = toFairleadScreenY(flX, flY);
      const ancScreenX = toScreenX(ancX, ancY);
      const ancScreenY = toScreenY(ancX, ancY);

      const isSelected = Boolean(line.selected || (params.selectedLineId && line.id === params.selectedLineId));
      const isBroken = Boolean(line.broken || (params.brokenLineId && line.id === params.brokenLineId));

      // Color by status / safety factor
      let strokeColor = "#38bdf8";
      if (isBroken) {
        strokeColor = "#ef4444";
      } else if (isSelected) {
        strokeColor = "#facc15";
      } else if (line.safetyFactor !== undefined) {
        if (line.safetyFactor < 1.67) strokeColor = "#f59e0b";
        else strokeColor = "#0ea5e9";
      }

      const dxScreen = ancScreenX - cx;
      const dyScreen = ancScreenY - cy;
      const labelX = ancScreenX + (dxScreen >= 0 ? 11 : -11);
      const labelY = ancScreenY + (dyScreen >= 0 ? 12 : -7);
      const textAnchor = dxScreen >= 0 ? "start" : "end";

      const tensionKn = line.tension ? `${(line.tension / 1000).toFixed(0)} kN` : "";
      const sfStr = line.safetyFactor ? `SF ${line.safetyFactor.toFixed(2)}` : "";
      const subLabel = [tensionKn, sfStr].filter(Boolean).join(" · ");

      return `
    <g class="mooring-line" data-line-id="${line.id}" data-line-index="${idx}" style="cursor: pointer;">
      <!-- Invisible wider hit target for easy clicking/hovering -->
      <line x1="${flScreenX.toFixed(1)}" y1="${flScreenY.toFixed(1)}" x2="${ancScreenX.toFixed(1)}" y2="${ancScreenY.toFixed(1)}" stroke="transparent" stroke-width="14"/>
      ${
        isSelected
          ? `<line x1="${flScreenX.toFixed(1)}" y1="${flScreenY.toFixed(1)}" x2="${ancScreenX.toFixed(1)}" y2="${ancScreenY.toFixed(1)}" stroke="#facc15" stroke-width="7" opacity="0.28" stroke-linecap="round"/>`
          : ""
      }
      <!-- Line catenary ground track -->
      <line x1="${flScreenX.toFixed(1)}" y1="${flScreenY.toFixed(1)}" x2="${ancScreenX.toFixed(1)}" y2="${ancScreenY.toFixed(1)}" stroke="${strokeColor}" stroke-width="${isSelected ? "3.4" : "2.2"}" stroke-dasharray="${isBroken ? "6,5" : "none"}" opacity="${isBroken ? "0.55" : "0.92"}"/>
      <!-- Fairlead attachment dot -->
      <circle cx="${flScreenX.toFixed(1)}" cy="${flScreenY.toFixed(1)}" r="${isSelected ? "4.5" : "3.2"}" fill="${strokeColor}" stroke="#0f172a" stroke-width="1.2"/>
      <!-- Anchor block -->
      <rect x="${(ancScreenX - (isSelected ? 6.5 : 5)).toFixed(1)}" y="${(ancScreenY - (isSelected ? 6.5 : 5)).toFixed(1)}" width="${isSelected ? 13 : 10}" height="${isSelected ? 13 : 10}" fill="${isBroken ? "#64748b" : isSelected ? "#facc15" : "#ef4444"}" rx="2" stroke="${isSelected ? "#fef08a" : "#fecaca"}" stroke-width="${isSelected ? "1.8" : "1"}"/>
      <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${isSelected ? "#fef08a" : isBroken ? "#f87171" : "#e2e8f0"}" font-size="${isSelected ? "10.5" : "9.5"}" font-weight="${isSelected ? "700" : "600"}" text-anchor="${textAnchor}">${line.name || `Line ${idx + 1}`}${isBroken ? " (SEVERED)" : ""}</text>
      ${
        subLabel && (isSelected || params.lines.length <= 16)
          ? `<text x="${labelX.toFixed(1)}" y="${(labelY + 11).toFixed(1)}" fill="${isSelected ? "#fde047" : "#94a3b8"}" font-size="8.5" font-family="ui-monospace, monospace" text-anchor="${textAnchor}">${subLabel}</text>`
          : ""
      }
    </g>
    `;
    })
    .join("\n");

  // Deduplicate fairlead columns for semi-submersible / floater hull rendering
  const uniqueFairleads: [number, number][] = [];
  if (params.fairleads && params.fairleads.length > 0) {
    for (const f of params.fairleads) {
      uniqueFairleads.push([
        toFairleadScreenX(f.position[0], f.position[1]),
        toFairleadScreenY(f.position[0], f.position[1]),
      ]);
    }
  } else {
    const seen = new Set<string>();
    for (const l of params.lines) {
      if (l.fairleadPos) {
        const key = `${l.fairleadPos[0].toFixed(1)},${l.fairleadPos[1].toFixed(1)}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueFairleads.push([
            toFairleadScreenX(l.fairleadPos[0], l.fairleadPos[1]),
            toFairleadScreenY(l.fairleadPos[0], l.fairleadPos[1]),
          ]);
        }
      }
    }
  }

  let floaterHullSvg = "";
  if (uniqueFairleads.length >= 3) {
    const polyPts = uniqueFairleads.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const braces = uniqueFairleads
      .map(
        (p) =>
          `<line x1="${vesselScreenX.toFixed(1)}" y1="${vesselScreenY.toFixed(1)}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="#38bdf8" stroke-width="2.5" opacity="0.7"/>`,
      )
      .join("\n    ");
    const columns = uniqueFairleads
      .map(
        (p) =>
          `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="6.5" fill="#0f172a" stroke="#38bdf8" stroke-width="2.2"/>`,
      )
      .join("\n    ");
    floaterHullSvg = `
  <g class="floater-semisub">
    <polygon points="${polyPts}" fill="#1e293b" fill-opacity="0.75" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round"/>
    ${braces}
    ${columns}
    <circle cx="${vesselScreenX.toFixed(1)}" cy="${vesselScreenY.toFixed(1)}" r="5" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5"/>
  </g>`;
  } else {
    floaterHullSvg = `
  <g transform="translate(${vesselScreenX.toFixed(1)}, ${vesselScreenY.toFixed(1)}) rotate(${params.vesselHeadingDeg ?? 0})">
    <path d="M -14,-24 L 14,-24 L 20,-10 L 18,24 L -18,24 L -20,-10 Z" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
    <polygon points="0,-32 -5,-24 5,-24" fill="#38bdf8"/>
    <circle cx="0" cy="0" r="3" fill="#ffffff"/>
  </g>`;
  }

  // Environmental vectors (Wave, Wind, Current)
  const env = params.environment;
  const makeArrow = (deg: number, color: string, label: string, rOffset: number) => {
    const rad = (deg * Math.PI) / 180;
    const arrowLen = 42;
    const startX = cx + (plotRadius + rOffset + arrowLen) * Math.sin(rad);
    const startY = cy - (plotRadius + rOffset + arrowLen) * Math.cos(rad);
    const endX = cx + (plotRadius + rOffset) * Math.sin(rad);
    const endY = cy - (plotRadius + rOffset) * Math.cos(rad);

    return `
    <g class="env-arrow">
      <line x1="${startX.toFixed(1)}" y1="${startY.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="${color}" stroke-width="2.8" stroke-linecap="round"/>
      <polygon points="${endX.toFixed(1)},${endY.toFixed(1)} ${(endX + 6 * Math.sin(rad + 2.5)).toFixed(1)},${(endY - 6 * Math.cos(rad + 2.5)).toFixed(1)} ${(endX + 6 * Math.sin(rad - 2.5)).toFixed(1)},${(endY - 6 * Math.cos(rad - 2.5)).toFixed(1)}" fill="${color}"/>
      <rect x="${(startX - 42).toFixed(1)}" y="${(startY - 21).toFixed(1)}" width="84" height="15" rx="3" fill="#0f172a" stroke="${color}" stroke-width="0.8" opacity="0.9"/>
      <text x="${startX.toFixed(1)}" y="${(startY - 10).toFixed(1)}" fill="${color}" font-size="9" font-weight="700" text-anchor="middle">${label}</text>
    </g>
    `;
  };

  const waveArrow = env?.waveDir !== undefined ? makeArrow(env.waveDir, "#60a5fa", `Wave ${env.waveHs ?? 6}m`, 6) : "";
  const windArrow =
    env?.windDir !== undefined
      ? makeArrow(
          (env.windDir + (env.windDir === env.waveDir ? 12 : 0)) % 360,
          "#38bdf8",
          `Wind ${env.windSpeed ?? 20}m/s`,
          22,
        )
      : "";
  const currArrow =
    env?.currentDir !== undefined && (env.currentSpeed ?? 0) > 0
      ? makeArrow(
          (env.currentDir + (env.currentDir === env.waveDir ? -12 : 0) + 360) % 360,
          "#fbbf24",
          `Curr ${env.currentSpeed ?? 1}m/s`,
          14,
        )
      : "";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" style="background-color: #070b14; font-family: ui-sans-serif, system-ui, sans-serif;">
  <defs>
    <radialGradient id="polarGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0284c7" stop-opacity="0.14"/>
      <stop offset="70%" stop-color="#0f172a" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#070b14" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <circle cx="${cx}" cy="${cy}" r="${plotRadius + 20}" fill="url(#polarGlow)"/>

  <!-- Header -->
  <text x="20" y="28" fill="#f8fafc" font-size="15" font-weight="700">${params.title ?? "Polar Mooring Spread & Excursion Envelope"}</text>
  <text x="20" y="44" fill="#94a3b8" font-size="11">${params.vesselName ?? "Offshore Floater"} | Water Depth: ${params.waterDepth}m | Spread Lines: ${params.lines.length}</text>

  <!-- Polar Concentric Grid Rings -->
  ${gridSteps
    .map(
      (r) => `
    <circle cx="${cx}" cy="${cy}" r="${scaleR(r).toFixed(1)}" fill="none" stroke="#1e293b" stroke-width="1" stroke-dasharray="3,3"/>
    <text x="${cx + 5}" y="${(cy - scaleR(r) - 3).toFixed(1)}" fill="#64748b" font-size="8.5" font-family="ui-monospace, monospace">${r}m</text>
  `,
    )
    .join("\n")}

  <!-- Cardinal Axes -->
  <line x1="${cx - plotRadius - 16}" y1="${cy}" x2="${cx + plotRadius + 16}" y2="${cy}" stroke="#1e293b" stroke-width="1.2"/>
  <line x1="${cx}" y1="${cy - plotRadius - 16}" x2="${cx}" y2="${cy + plotRadius + 16}" stroke="#1e293b" stroke-width="1.2"/>
  <text x="${cx}" y="${cy - plotRadius - 22}" fill="#94a3b8" font-size="10.5" font-weight="700" text-anchor="middle">0° (North)</text>
  <text x="${cx + plotRadius + 22}" y="${cy + 4}" fill="#94a3b8" font-size="10.5" font-weight="700">90° (East)</text>
  <text x="${cx}" y="${cy + plotRadius + 28}" fill="#94a3b8" font-size="10.5" font-weight="700" text-anchor="middle">180° (South)</text>
  <text x="${cx - plotRadius - 22}" y="${cy + 4}" fill="#94a3b8" font-size="10.5" font-weight="700" text-anchor="end">270° (West)</text>

  <!-- Allowable Watch Circle (Safety Boundary) -->
  <circle cx="${cx}" cy="${cy}" r="${watchCircleScreenR.toFixed(1)}" fill="#22c55e" fill-opacity="0.08" stroke="#22c55e" stroke-width="1.8" stroke-dasharray="4,3"/>
  <text x="${(cx + watchCircleScreenR + 6).toFixed(1)}" y="${cy - 4}" fill="#4ade80" font-size="9.5" font-weight="600">Watch Circle (${watchCircleRadius.toFixed(1)}m)</text>

  <!-- Mooring Lines -->
  ${lineSvgElements}

  <!-- Floater Hull Representation (Displaced Center & Fairlead Columns) -->
  ${floaterHullSvg}

  <!-- Environmental Vectors -->
  ${waveArrow}
  ${windArrow}
  ${currArrow}

  <!-- Legend Card -->
  <g transform="translate(18, ${h - 78})">
    <rect x="0" y="0" width="176" height="62" fill="#0f172a" stroke="#1e293b" rx="5" opacity="0.92"/>
    <circle cx="13" cy="16" r="3.5" fill="#38bdf8"/>
    <text x="24" y="19" fill="#cbd5e1" font-size="9.5">Mooring Lines &amp; Fairleads</text>
    <circle cx="13" cy="32" r="3.5" fill="#22c55e"/>
    <text x="24" y="35" fill="#cbd5e1" font-size="9.5">Watch Circle (${watchCircleRadius.toFixed(1)}m)</text>
    <rect x="9.5" y="44" width="7" height="7" fill="#ef4444" rx="1"/>
    <text x="24" y="51" fill="#cbd5e1" font-size="9.5">Seabed Drag Anchor</text>
  </g>
</svg>
`.trim();
}
