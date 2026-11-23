// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeStlMassProperties } from "../solver/index.js";
import type { StlMeshDocument, Vec3 } from "../types.js";

export type StlProjectionView = "iso" | "xy" | "xz" | "yz";

export interface StlSvgOptions {
  /** Projection camera view (default: "iso"). */
  view?: StlProjectionView | undefined;
  /** Render wireframe overlay or wireframe-only edges (default: false). */
  wireframe?: boolean | undefined;
  /** SVG canvas width in pixels (default: 640). */
  width?: number | undefined;
  /** SVG canvas height in pixels (default: 440). */
  height?: number | undefined;
  /** Show XYZ coordinate triad in bottom-left corner (default: true). */
  showAxes?: boolean | undefined;
  /** Optional custom azimuth angle in degrees (used when view === "iso"). */
  azimuthDeg?: number | undefined;
  /** Optional custom elevation angle in degrees (used when view === "iso"). */
  elevationDeg?: number | undefined;
  /** Background color (default: "#0f172a"). */
  background?: string | undefined;
}

interface ProjectedTri {
  pts: [[number, number], [number, number], [number, number]];
  depth: number;
  shade: number;
  line: number;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getViewBasis(
  view: StlProjectionView,
  azimuthDeg = 45,
  elevationDeg = 35.264,
): { right: Vec3; up: Vec3; forward: Vec3 } {
  switch (view) {
    case "xy":
      return { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] };
    case "xz":
      return { right: [1, 0, 0], up: [0, 0, 1], forward: [0, -1, 0] };
    case "yz":
      return { right: [0, 1, 0], up: [0, 0, 1], forward: [1, 0, 0] };
    case "iso":
    default: {
      const az = (azimuthDeg * Math.PI) / 180;
      const el = (elevationDeg * Math.PI) / 180;
      const cosAz = Math.cos(az);
      const sinAz = Math.sin(az);
      const cosEl = Math.cos(el);
      const sinEl = Math.sin(el);
      // Camera looks from `forward` toward origin
      const forward: Vec3 = [cosEl * cosAz, cosEl * sinAz, sinEl];
      const right: Vec3 = [-sinAz, cosAz, 0];
      const up: Vec3 = [-sinEl * cosAz, -sinEl * sinAz, cosEl];
      return { right, up, forward };
    }
  }
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function computeGeometricNormal(v0: Vec3, v1: Vec3, v2: Vec3): Vec3 {
  const e1x = v1[0] - v0[0];
  const e1y = v1[1] - v0[1];
  const e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0];
  const e2y = v2[1] - v0[1];
  const e2z = v2[2] - v0[2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-15) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/**
 * Pure SVG isometric/orthographic painter's-algorithm 3D mesh & wireframe renderer.
 */
export function renderStlMeshSvg(doc: StlMeshDocument, options?: StlSvgOptions): string {
  const view: StlProjectionView = options?.view ?? "iso";
  const wireframe = options?.wireframe ?? false;
  const width = options?.width ?? 640;
  const height = options?.height ?? 440;
  const showAxes = options?.showAxes ?? true;
  const bg = options?.background ?? "#0f172a";

  const title = doc.solids[0]?.name || doc.header || "STL Mesh";

  if (doc.facets.length === 0) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="${bg}"/>` +
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="monospace" font-size="14" fill="#94a3b8">` +
      `Empty STL mesh (${escapeXml(title)})</text></svg>`
    );
  }

  const props = computeStlMassProperties(doc);
  const { min, max } = props.boundingBox;
  const center: Vec3 = [0.5 * (min[0] + max[0]), 0.5 * (min[1] + max[1]), 0.5 * (min[2] + max[2])];

  const basis = getViewBasis(view, options?.azimuthDeg, options?.elevationDeg);

  // Light direction slightly offset from camera forward + up
  const rawLight: Vec3 = [
    basis.forward[0] * 0.7 + basis.up[0] * 0.55 + basis.right[0] * 0.35,
    basis.forward[1] * 0.7 + basis.up[1] * 0.55 + basis.right[1] * 0.35,
    basis.forward[2] * 0.7 + basis.up[2] * 0.55 + basis.right[2] * 0.35,
  ];
  const lLen = Math.hypot(rawLight[0], rawLight[1], rawLight[2]) || 1;
  const lightDir: Vec3 = [rawLight[0] / lLen, rawLight[1] / lLen, rawLight[2] / lLen];

  // First pass: project all vertices to compute 2D screen bounds
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;

  const projected: ProjectedTri[] = [];

  for (const f of doc.facets) {
    const [v0, v1, v2] = f.vertices;
    if (!Number.isFinite(v0[0]) || !Number.isFinite(v1[0]) || !Number.isFinite(v2[0])) {
      continue;
    }

    const p2d: [[number, number], [number, number], [number, number]] = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    let depthSum = 0;

    for (let k = 0; k < 3; k++) {
      const v = f.vertices[k]!;
      const rel: Vec3 = [v[0] - center[0], v[1] - center[1], v[2] - center[2]];
      const u = dot3(rel, basis.right);
      const w = dot3(rel, basis.up);
      const d = dot3(rel, basis.forward);
      p2d[k] = [u, w];
      depthSum += d;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (w < minV) minV = w;
      if (w > maxV) maxV = w;
    }

    const n = computeGeometricNormal(v0, v1, v2);
    const lambert = Math.abs(dot3(n, lightDir));
    const shade = 0.25 + 0.75 * lambert;

    projected.push({
      pts: p2d,
      depth: depthSum / 3.0,
      shade,
      line: f.line ?? 1,
    });
  }

  // Painter's algorithm: sort back-to-front (smaller depth drawn first)
  projected.sort((a, b) => a.depth - b.depth);

  const spanU = Math.max(maxU - minU, 1e-6);
  const spanV = Math.max(maxV - minV, 1e-6);
  const pad = 44;
  const scale = Math.min((width - 2 * pad) / spanU, (height - 2 * pad) / spanV);
  const midU = 0.5 * (minU + maxU);
  const midV = 0.5 * (minV + maxV);

  const toScreen = (u: number, v: number): [number, number] => [
    width * 0.5 + (u - midU) * scale,
    height * 0.5 - (v - midV) * scale,
  ];

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-stl-view="${view}" data-wireframe="${String(wireframe)}">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${bg}"/>`);

  // Subtle background grid
  parts.push(`<g stroke="#1e293b" stroke-width="0.75" opacity="0.65">`);
  for (let gx = 40; gx < width; gx += 40) {
    parts.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${height}"/>`);
  }
  for (let gy = 40; gy < height; gy += 40) {
    parts.push(`<line x1="0" y1="${gy}" x2="${width}" y2="${gy}"/>`);
  }
  parts.push(`</g>`);

  // Mesh triangles
  parts.push(`<g class="stl-mesh">`);
  for (const tri of projected) {
    const [x0, y0] = toScreen(tri.pts[0][0], tri.pts[0][1]);
    const [x1, y1] = toScreen(tri.pts[1][0], tri.pts[1][1]);
    const [x2, y2] = toScreen(tri.pts[2][0], tri.pts[2][1]);
    const ptsStr = `${x0.toFixed(2)},${y0.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;

    if (wireframe) {
      parts.push(
        `<polygon points="${ptsStr}" fill="#38bdf8" fill-opacity="0.08" stroke="#38bdf8" stroke-width="1.0" stroke-linejoin="round" data-line="${tri.line}"/>`,
      );
    } else {
      const r = Math.round(45 + 115 * tri.shade);
      const g = Math.round(115 + 110 * tri.shade);
      const b = Math.round(175 + 75 * tri.shade);
      const fill = `rgb(${r},${g},${b})`;
      parts.push(
        `<polygon points="${ptsStr}" fill="${fill}" stroke="#0f172a" stroke-opacity="0.45" stroke-width="0.65" stroke-linejoin="round" data-line="${tri.line}"/>`,
      );
    }
  }
  parts.push(`</g>`);

  // Coordinate axes triad
  if (showAxes) {
    const ox = 46;
    const oy = height - 42;
    const axisLen = 26;
    const axes: Array<{ vec: Vec3; label: string; color: string }> = [
      { vec: [1, 0, 0], label: "X", color: "#f87171" },
      { vec: [0, 1, 0], label: "Y", color: "#4ade80" },
      { vec: [0, 0, 1], label: "Z", color: "#60a5fa" },
    ];
    parts.push(`<g class="stl-axes" font-family="monospace" font-size="10" font-weight="bold">`);
    for (const ax of axes) {
      const dx = dot3(ax.vec, basis.right) * axisLen;
      const dy = -dot3(ax.vec, basis.up) * axisLen;
      parts.push(
        `<line x1="${ox}" y1="${oy}" x2="${(ox + dx).toFixed(1)}" y2="${(oy + dy).toFixed(1)}" stroke="${ax.color}" stroke-width="1.8" stroke-linecap="round"/>`,
      );
      parts.push(
        `<text x="${(ox + dx * 1.32).toFixed(1)}" y="${(oy + dy * 1.32 + 3).toFixed(1)}" text-anchor="middle" fill="${ax.color}">${ax.label}</text>`,
      );
    }
    parts.push(`</g>`);
  }

  // HUD view badge
  parts.push(
    `<text x="${width - 14}" y="22" text-anchor="end" font-family="monospace" font-size="11" fill="#94a3b8">` +
      `${escapeXml(title)} · ${view.toUpperCase()}${wireframe ? " WIRE" : " SHADED"} · ${doc.facets.length} tris</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("");
}
