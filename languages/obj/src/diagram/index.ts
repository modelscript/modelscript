// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Pure SVG 3D Mesh & Material Renderer.
 *
 * Renders Wavefront OBJ meshes in isometric or orthographic views using
 * painter's algorithm depth sorting, directional + ambient Lambertian/Blinn-Phong
 * shading with MTL `Kd` diffuse colors, optional wireframe overlay, coordinate triad,
 * and an MTL material swatch legend.
 */

import { computeMeshMetrics, triangulateObjMesh } from "../solver/index.js";
import type { MtlMaterial, ObjDocument, RgbColor, Vec3 } from "../types.js";

export type ObjViewMode = "isometric" | "front" | "top" | "right";

export interface ObjSvgOptions {
  /** Viewport width in pixels. Default: 720. */
  width?: number | undefined;
  /** Viewport height in pixels. Default: 480. */
  height?: number | undefined;
  /** Camera projection preset. Default: `"isometric"`. */
  view?: ObjViewMode | undefined;
  /** Azimuth rotation angle in degrees (overrides view preset if specified). */
  azimuthDeg?: number | undefined;
  /** Elevation rotation angle in degrees (overrides view preset if specified). */
  elevationDeg?: number | undefined;
  /** Draw wireframe triangle edges. Default: true. */
  wireframe?: boolean | undefined;
  /** Optional companion MTL material map (defaults to `doc.materials`). */
  materials?: Map<string, MtlMaterial> | undefined;
  /** Background fill color. Default: `"#0f172a"`. */
  background?: string | undefined;
  /** Show material swatch legend when materials are present. Default: true. */
  showLegend?: boolean | undefined;
}

const DEFAULT_PALETTE: RgbColor[] = [
  [0.38, 0.65, 0.98],
  [0.2, 0.83, 0.6],
  [0.98, 0.75, 0.14],
  [0.97, 0.45, 0.35],
  [0.75, 0.52, 0.99],
  [0.22, 0.74, 0.97],
];

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rgbToHex(rgb: RgbColor): string {
  const r = Math.round(clamp01(rgb[0]) * 255)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(clamp01(rgb[1]) * 255)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(clamp01(rgb[2]) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

function viewAngles(view: ObjViewMode): { az: number; el: number } {
  switch (view) {
    case "front":
      return { az: 0, el: 0 };
    case "top":
      return { az: 0, el: 90 };
    case "right":
      return { az: 90, el: 0 };
    case "isometric":
    default:
      return { az: 38, el: 28 };
  }
}

function rotatePoint(
  x: number,
  y: number,
  z: number,
  cosAz: number,
  sinAz: number,
  cosEl: number,
  sinEl: number,
): Vec3 {
  // Rotate around Y (azimuth) then X (elevation)
  const x1 = x * cosAz + z * sinAz;
  const z1 = -x * sinAz + z * cosAz;
  const y2 = y * cosEl - z1 * sinEl;
  const z2 = y * sinEl + z1 * cosEl;
  return [x1, y2, z2];
}

/**
 * Render a Wavefront `ObjDocument` to a self-contained SVG string with shaded faces
 * and an optional MTL material swatch legend.
 */
export function renderObjMeshSvg(doc: ObjDocument, options?: ObjSvgOptions): string {
  const width = options?.width ?? 720;
  const height = options?.height ?? 480;
  const view = options?.view ?? "isometric";
  const preset = viewAngles(view);
  const azRad = ((options?.azimuthDeg ?? preset.az) * Math.PI) / 180;
  const elRad = ((options?.elevationDeg ?? preset.el) * Math.PI) / 180;
  const wireframe = options?.wireframe ?? true;
  const background = options?.background ?? "#0f172a";
  const showLegend = options?.showLegend ?? true;
  const materials = options?.materials ?? doc.materials;

  const triangles = triangulateObjMesh(doc);
  const metrics = computeMeshMetrics(doc);

  if (doc.vertices.length === 0 || triangles.length === 0) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>` +
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="monospace" font-size="14" fill="#94a3b8">` +
      `No renderable faces in Wavefront OBJ mesh</text></svg>`
    );
  }

  const cosAz = Math.cos(azRad);
  const sinAz = Math.sin(azRad);
  const cosEl = Math.cos(elRad);
  const sinEl = Math.sin(elRad);

  const [cx, cy, cz] = metrics.boundingBox.center;
  const projectedVerts: Vec3[] = doc.vertices.map((v) =>
    rotatePoint(v.x - cx, v.y - cy, v.z - cz, cosAz, sinAz, cosEl, sinEl),
  );

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [px, py] of projectedVerts) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  const padLeft = 40;
  const padRight = showLegend && (materials?.size ?? 0) > 0 ? 170 : 40;
  const padTop = 36;
  const padBottom = 42;
  const drawW = Math.max(80, width - padLeft - padRight);
  const drawH = Math.max(80, height - padTop - padBottom);
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = 0.88 * Math.min(drawW / spanX, drawH / spanY);
  const originX = padLeft + drawW / 2 - ((minX + maxX) / 2) * scale;
  const originY = padTop + drawH / 2 + ((minY + maxY) / 2) * scale;

  // Assign deterministic fallback colors per object/material name
  const fallbackColorByKey = new Map<string, RgbColor>();
  const getBaseColor = (matName: string | undefined, objName: string): { rgb: RgbColor; opacity: number } => {
    if (matName && materials?.has(matName)) {
      const m = materials.get(matName)!;
      const rgb: RgbColor = m.Kd ?? m.Ka ?? [0.68, 0.74, 0.82];
      const opacity = m.d !== undefined ? clamp01(m.d) : 1.0;
      return { rgb, opacity };
    }
    const key = matName ?? objName;
    let color = fallbackColorByKey.get(key);
    if (!color) {
      color = DEFAULT_PALETTE[fallbackColorByKey.size % DEFAULT_PALETTE.length]!;
      fallbackColorByKey.set(key, color);
    }
    return { rgb: color, opacity: 1.0 };
  };

  // Directional key light in camera space (normalized)
  const lightDir: Vec3 = [0.42, 0.56, 0.71];

  interface RenderTri {
    depth: number;
    pts: string;
    fill: string;
    opacity: number;
    line: number;
  }

  const renderTris: RenderTri[] = [];
  for (const tri of triangles) {
    const [i0, i1, i2] = tri.indices;
    const p0 = projectedVerts[i0]!;
    const p1 = projectedVerts[i1]!;
    const p2 = projectedVerts[i2]!;

    const depth = (p0[2] + p1[2] + p2[2]) / 3;

    // Rotate face normal into view space for Lambertian shading
    const [rnx, rny, rnz] = rotatePoint(
      tri.faceNormal[0],
      tri.faceNormal[1],
      tri.faceNormal[2],
      cosAz,
      sinAz,
      cosEl,
      sinEl,
    );
    const nLen = Math.sqrt(rnx * rnx + rny * rny + rnz * rnz) || 1;
    const ndotl = Math.abs((rnx * lightDir[0] + rny * lightDir[1] + rnz * lightDir[2]) / nLen);
    const shade = 0.28 + 0.72 * ndotl;

    const { rgb, opacity } = getBaseColor(tri.materialName, tri.objectName);
    const shaded: RgbColor = [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade];

    const sx0 = (originX + p0[0] * scale).toFixed(2);
    const sy0 = (originY - p0[1] * scale).toFixed(2);
    const sx1 = (originX + p1[0] * scale).toFixed(2);
    const sy1 = (originY - p1[1] * scale).toFixed(2);
    const sx2 = (originX + p2[0] * scale).toFixed(2);
    const sy2 = (originY - p2[1] * scale).toFixed(2);

    const srcFace = doc.faces[tri.sourceFaceIndex];
    renderTris.push({
      depth,
      pts: `${sx0},${sy0} ${sx1},${sy1} ${sx2},${sy2}`,
      fill: rgbToHex(shaded),
      opacity,
      line: srcFace?.line ?? 1,
    });
  }

  // Painter's algorithm: back-to-front by camera-space Z
  renderTris.sort((a, b) => a.depth - b.depth);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>`);

  // Header label
  const titleText = doc.objects[0]?.name ? `OBJ Mesh: ${doc.objects[0].name}` : "Wavefront OBJ Mesh";
  parts.push(
    `<text x="16" y="22" font-family="monospace" font-size="12" font-weight="bold" fill="#e2e8f0">${escapeXml(titleText)}</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="22" text-anchor="end" font-family="monospace" font-size="10" fill="#94a3b8">` +
      `View: ${escapeXml(view.toUpperCase())}</text>`,
  );

  // Shaded triangles
  const strokeAttr = wireframe ? ` stroke="#0f172a" stroke-opacity="0.45" stroke-width="0.65"` : "";
  parts.push(`<g class="obj-mesh">`);
  for (const rt of renderTris) {
    const opAttr = rt.opacity < 0.999 ? ` fill-opacity="${rt.opacity.toFixed(2)}"` : "";
    parts.push(`<polygon points="${rt.pts}" fill="${rt.fill}"${opAttr}${strokeAttr} data-line="${rt.line}"/>`);
  }
  parts.push(`</g>`);

  // Coordinate triad in bottom-left
  const triadX = 42;
  const triadY = height - 48;
  const axisLen = 22;
  const axesSpec: Array<{ label: string; vec: Vec3; color: string }> = [
    { label: "X", vec: [1, 0, 0], color: "#f87171" },
    { label: "Y", vec: [0, 1, 0], color: "#4ade80" },
    { label: "Z", vec: [0, 0, 1], color: "#60a5fa" },
  ];
  parts.push(`<g class="obj-triad">`);
  for (const ax of axesSpec) {
    const [rx, ry] = rotatePoint(ax.vec[0], ax.vec[1], ax.vec[2], cosAz, sinAz, cosEl, sinEl);
    const ex = (triadX + rx * axisLen).toFixed(1);
    const ey = (triadY - ry * axisLen).toFixed(1);
    parts.push(`<line x1="${triadX}" y1="${triadY}" x2="${ex}" y2="${ey}" stroke="${ax.color}" stroke-width="1.6"/>`);
    parts.push(
      `<text x="${(triadX + rx * (axisLen + 8)).toFixed(1)}" y="${(triadY - ry * (axisLen + 8) + 3).toFixed(1)}" ` +
        `text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="${ax.color}">${ax.label}</text>`,
    );
  }
  parts.push(`</g>`);

  // Material swatch legend (MTL)
  if (showLegend && materials && materials.size > 0) {
    const legendX = width - 158;
    const legendY = 44;
    const mats = Array.from(materials.values()).slice(0, 10);
    const boxH = 24 + mats.length * 22;
    parts.push(`<g class="obj-mtl-legend">`);
    parts.push(
      `<rect x="${legendX}" y="${legendY}" width="144" height="${boxH}" rx="6" fill="#1e293b" fill-opacity="0.92" stroke="#334155" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${legendX + 10}" y="${legendY + 16}" font-family="monospace" font-size="10" font-weight="bold" fill="#cbd5e1">MTL Materials</text>`,
    );
    mats.forEach((mat, idx) => {
      const y = legendY + 28 + idx * 22;
      const swatchColor = rgbToHex(mat.Kd ?? mat.Ka ?? [0.65, 0.7, 0.78]);
      const swatchOp = mat.d !== undefined ? clamp01(mat.d).toFixed(2) : "1.00";
      parts.push(
        `<rect x="${legendX + 10}" y="${y - 8}" width="12" height="12" rx="2" fill="${swatchColor}" fill-opacity="${swatchOp}" stroke="#94a3b8" stroke-width="0.7"/>`,
      );
      parts.push(
        `<text x="${legendX + 28}" y="${y + 2}" font-family="monospace" font-size="9.5" fill="#e2e8f0">${escapeXml(mat.name.slice(0, 16))}</text>`,
      );
    });
    parts.push(`</g>`);
  }

  // Metrics footer
  parts.push(
    `<text x="16" y="${height - 12}" font-family="monospace" font-size="10" fill="#94a3b8">` +
      `V=${metrics.vertexCount}  F=${metrics.faceCount}  T=${metrics.triangleCount}  ` +
      `A=${metrics.surfaceArea.toFixed(3)}  Vol=${metrics.volume.toFixed(3)}  ` +
      `χ=${metrics.eulerCharacteristic}</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}
