// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Vector SVG Road Network Visualizer.
 *
 * Generates interactive, high-precision dark-mode SVG vector schematics
 * of OpenDRIVE road networks, lane boundaries, clothoid curves, and junctions.
 */

import { sampleRoadTrack } from "../geometry/clothoid.js";
import type { OpenDriveDocument, OpenDriveRoad, TrackPoint3D } from "../types.js";

export interface OpenDriveSvgOptions {
  width?: number;
  height?: number;
  sampleStep?: number;
  theme?: "dark" | "light";
  showLanes?: boolean;
  showLabels?: boolean;
  padding?: number;
}

export function renderOpenDriveSvg(
  target: OpenDriveRoad | OpenDriveDocument,
  options: OpenDriveSvgOptions = {},
): string {
  const roads: OpenDriveRoad[] = "roads" in target ? target.roads : [target];
  const sampleStep = options.sampleStep ?? 2.0;
  const isDark = options.theme !== "light";
  const padding = options.padding ?? 40;
  const showLabels = options.showLabels !== false;

  // 1. Sample all road tracks
  const roadTracks: { road: OpenDriveRoad; points: TrackPoint3D[] }[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const road of roads) {
    const points = sampleRoadTrack(road, sampleStep);
    roadTracks.push({ road, points });

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) {
    minX = -50;
    maxX = 50;
    minY = -50;
    maxY = 50;
  }

  // Ensure minimum span
  const spanX = Math.max(maxX - minX, 10);
  const spanY = Math.max(maxY - minY, 10);

  const viewBoxX = minX - padding;
  const viewBoxY = minY - padding;
  const viewBoxW = spanX + 2 * padding;
  const viewBoxH = spanY + 2 * padding;

  const bgFill = isDark ? "#0f172a" : "#f8fafc";
  const roadAsphalt = isDark ? "#1e293b" : "#cbd5e1";
  const roadBorder = isDark ? "#334155" : "#94a3b8";
  const refLineColor = isDark ? "#f59e0b" : "#d97706";
  const laneDividerColor = isDark ? "#64748b" : "#e2e8f0";
  const textColor = isDark ? "#f1f5f9" : "#0f172a";
  const badgeBg = isDark ? "#1e1b4b" : "#e0e7ff";
  const badgeBorder = isDark ? "#6366f1" : "#4f46e5";

  const svgParts: string[] = [];

  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX.toFixed(2)} ${viewBoxY.toFixed(2)} ${viewBoxW.toFixed(2)} ${viewBoxH.toFixed(2)}" width="100%" height="100%" style="background-color: ${bgFill}; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">`,
  );

  // Grid pattern
  svgParts.push(`  <defs>`);
  svgParts.push(`    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">`);
  svgParts.push(
    `      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${isDark ? "#1e293b" : "#e2e8f0"}" stroke-width="0.5" opacity="0.4"/>`,
  );
  svgParts.push(`    </pattern>`);
  svgParts.push(`    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">`);
  svgParts.push(`      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.4"/>`);
  svgParts.push(`    </filter>`);
  svgParts.push(`  </defs>`);

  svgParts.push(
    `  <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="url(#grid)" />`,
  );

  // Render roads
  for (const { road, points } of roadTracks) {
    if (points.length < 2) continue;

    // Approximate road half-width (default 3.5m per lane, or based on lane section)
    const laneSec = road.lanes.laneSections[0];
    const leftCount = laneSec?.leftLanes.length ?? 1;
    const rightCount = laneSec?.rightLanes.length ?? 1;
    const totalHalfWidth = Math.max((leftCount + rightCount) * 1.75, 4.0);

    // Build left & right outer boundary polygons
    const leftEdge: { x: number; y: number }[] = [];
    const rightEdge: { x: number; y: number }[] = [];

    for (const p of points) {
      // Normal vector to road heading: nx = -sin(hdg), ny = cos(hdg)
      const nx = -Math.sin(p.hdg);
      const ny = Math.cos(p.hdg);

      leftEdge.push({
        x: p.x + nx * totalHalfWidth,
        y: p.y + ny * totalHalfWidth,
      });
      rightEdge.push({
        x: p.x - nx * totalHalfWidth,
        y: p.y - ny * totalHalfWidth,
      });
    }

    // Outer asphalt polygon: left edge forward + right edge backward
    const polyPoints: string[] = [];
    for (const pt of leftEdge) {
      polyPoints.push(`${pt.x.toFixed(2)},${pt.y.toFixed(2)}`);
    }
    for (let i = rightEdge.length - 1; i >= 0; i--) {
      polyPoints.push(`${rightEdge[i]!.x.toFixed(2)},${rightEdge[i]!.y.toFixed(2)}`);
    }

    // Asphalt surface
    svgParts.push(`  <!-- Road ${road.id} Asphalt Surface -->`);
    svgParts.push(
      `  <polygon points="${polyPoints.join(" ")}" fill="${roadAsphalt}" stroke="${roadBorder}" stroke-width="1.5" />`,
    );

    // Outer edge curbs
    const leftPath = leftEdge.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");
    const rightPath = rightEdge
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
      .join(" ");
    svgParts.push(`  <path d="${leftPath}" fill="none" stroke="${roadBorder}" stroke-width="1" />`);
    svgParts.push(`  <path d="${rightPath}" fill="none" stroke="${roadBorder}" stroke-width="1" />`);

    // Reference Line (golden dashed line)
    const refPath = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");
    svgParts.push(`  <!-- Road ${road.id} Center Reference Line -->`);
    svgParts.push(
      `  <path d="${refPath}" fill="none" stroke="${refLineColor}" stroke-width="1.8" stroke-dasharray="6,4" opacity="0.9" />`,
    );

    // Inner lane divider lines
    if (options.showLanes !== false && (leftCount > 1 || rightCount > 1)) {
      const laneWidth = totalHalfWidth / Math.max(leftCount, rightCount, 1);
      for (let l = 1; l < Math.max(leftCount, rightCount); l++) {
        const offset = l * laneWidth;
        const innerLeft = points
          .map((p, i) => {
            const nx = -Math.sin(p.hdg);
            const ny = Math.cos(p.hdg);
            return `${i === 0 ? "M" : "L"} ${(p.x + nx * offset).toFixed(2)} ${(p.y + ny * offset).toFixed(2)}`;
          })
          .join(" ");
        svgParts.push(
          `  <path d="${innerLeft}" fill="none" stroke="${laneDividerColor}" stroke-width="0.8" stroke-dasharray="4,4" opacity="0.6" />`,
        );
      }
    }

    // Road label badge at start point
    if (showLabels && points.length > 0) {
      const p0 = points[0]!;
      const labelText = road.name ? `${road.name} (#${road.id})` : `Road ${road.id}`;
      svgParts.push(`  <!-- Road Label -->`);
      svgParts.push(`  <g transform="translate(${p0.x.toFixed(2)}, ${p0.y.toFixed(2)})">`);
      svgParts.push(`    <circle r="4" fill="${refLineColor}" stroke="#ffffff" stroke-width="1"/>`);
      svgParts.push(
        `    <rect x="8" y="-12" width="${labelText.length * 7 + 12}" height="20" rx="4" fill="${badgeBg}" stroke="${badgeBorder}" stroke-width="1" filter="url(#shadow)"/>`,
      );
      svgParts.push(`    <text x="14" y="2" fill="${textColor}" font-size="10" font-weight="bold">${labelText}</text>`);
      svgParts.push(`  </g>`);
    }
  }

  // Render Junctions
  if ("junctions" in target) {
    for (const junc of target.junctions) {
      if (junc.connections.length === 0) continue;
      // Find connected roads
      const connRoadIds = new Set(junc.connections.map((c) => c.connectingRoad));
      const juncTracks = roadTracks.filter((rt) => connRoadIds.has(rt.road.id));
      if (juncTracks.length > 0) {
        const midP = juncTracks[0]!.points[Math.floor(juncTracks[0]!.points.length / 2)];
        if (midP && showLabels) {
          svgParts.push(`  <!-- Junction ${junc.id} Badge -->`);
          svgParts.push(`  <g transform="translate(${midP.x.toFixed(2)}, ${midP.y.toFixed(2)})">`);
          svgParts.push(`    <circle r="6" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/>`);
          svgParts.push(
            `    <text x="10" y="4" fill="${textColor}" font-size="11" font-weight="600">Junction ${junc.id}</text>`,
          );
          svgParts.push(`  </g>`);
        }
      }
    }
  }

  svgParts.push(`</svg>`);
  return svgParts.join("\n");
}
