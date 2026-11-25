// SPDX-License-Identifier: AGPL-3.0-or-later

import { sampleScientificColormap } from "./colormap.js";
import type { PreprocessContext, PreprocessResult } from "./types.js";

export interface VtuSvgPreviewResult {
  svg: string;
  pointCount: number;
  cellCount: number;
  fieldName: string;
  minValue: number;
  maxValue: number;
}

/**
 * Deterministically parses an UnstructuredGrid VTU XML string (`<Points>`, `<Cells>`,
 * `<PointData>`) and renders a depth-sorted isometric 3D finite-element contour mesh
 * SVG on a uniform radial greyscale background.
 */
export function renderVtuIsometricSvg(
  vtuXml: string,
  fallbackTitle = "Simulation Result",
  fieldUnits?: Record<string, string>,
): VtuSvgPreviewResult {
  const width = 800;
  const height = 450;
  void fallbackTitle;
  void fieldUnits;

  const pointsMatch = /<Points>[\s\S]*?<DataArray[^>]*>([\s\S]*?)<\/DataArray>[\s\S]*?<\/Points>/i.exec(vtuXml);
  const rawCoordNumbers = pointsMatch?.[1]
    ? pointsMatch[1]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : [];

  const points: [number, number, number][] = [];
  for (let i = 0; i + 2 < rawCoordNumbers.length; i += 3) {
    points.push([rawCoordNumbers[i]!, rawCoordNumbers[i + 1]!, rawCoordNumbers[i + 2]!]);
  }

  const connMatch = /<DataArray[^>]*Name=["']connectivity["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(vtuXml);
  const offsetsMatch = /<DataArray[^>]*Name=["']offsets["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(vtuXml);

  const connectivity = connMatch?.[1]
    ? connMatch[1]
        .trim()
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    : [];
  const offsets = offsetsMatch?.[1]
    ? offsetsMatch[1]
        .trim()
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    : [];

  // Extract first PointData or CellData array
  const pointDataBlock = /<PointData[^>]*>([\s\S]*?)<\/PointData>/i.exec(vtuXml)?.[1] ?? vtuXml;
  const dataArrayMatch = /<DataArray[^>]*Name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(pointDataBlock);
  const fieldName = dataArrayMatch?.[1] || "ScalarField";
  const numCompsMatch = dataArrayMatch?.[0] ? /NumberOfComponents=["'](\d+)["']/i.exec(dataArrayMatch[0]) : null;
  const numComps = numCompsMatch ? Math.max(1, Number.parseInt(numCompsMatch[1]!, 10)) : 1;

  const rawFieldVals = dataArrayMatch?.[2]
    ? dataArrayMatch[2]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : [];

  const nodalScalars: number[] = [];
  if (numComps === 1) {
    for (const v of rawFieldVals) nodalScalars.push(v);
  } else {
    for (let i = 0; i + numComps - 1 < rawFieldVals.length; i += numComps) {
      let sumSq = 0;
      for (let c = 0; c < numComps; c++) {
        const compVal = rawFieldVals[i + c] ?? 0;
        sumSq += compVal * compVal;
      }
      nodalScalars.push(Math.sqrt(sumSq));
    }
  }

  // Optional 3-component Velocity vector array for aerodynamic streamlines
  const velocityMatch =
    /<DataArray[^>]*Name=["']Velocity["'][^>]*NumberOfComponents=["']3["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(
      pointDataBlock,
    ) ??
    /<DataArray[^>]*NumberOfComponents=["']3["'][^>]*Name=["']Velocity["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(
      pointDataBlock,
    );
  const rawVelVals = velocityMatch?.[1]
    ? velocityMatch[1]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : [];
  const velocityVectors: [number, number, number][] = [];
  for (let i = 0; i + 2 < rawVelVals.length; i += 3) {
    velocityVectors.push([rawVelVals[i]!, rawVelVals[i + 1]!, rawVelVals[i + 2]!]);
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of nodalScalars) {
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  if (!Number.isFinite(minVal)) minVal = 0;
  if (!Number.isFinite(maxVal)) maxVal = 1;

  // Build boundary/cell faces
  const triFaces: [number, number, number][] = [];
  let prevOffset = 0;
  for (const endOffset of offsets) {
    const cellNodes = connectivity.slice(prevOffset, endOffset);
    prevOffset = endOffset;
    if (cellNodes.length === 4) {
      const [n0, n1, n2, n3] = cellNodes as [number, number, number, number];
      triFaces.push([n0, n1, n2], [n0, n1, n3], [n0, n2, n3], [n1, n2, n3]);
    } else if (cellNodes.length === 3) {
      triFaces.push([cellNodes[0]!, cellNodes[1]!, cellNodes[2]!]);
    } else if (cellNodes.length >= 4) {
      for (let k = 1; k + 1 < cellNodes.length; k++) {
        triFaces.push([cellNodes[0]!, cellNodes[k]!, cellNodes[k + 1]!]);
      }
    }
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cx = Number.isFinite(minX) ? (minX + maxX) * 0.5 : 0;
  const cy = Number.isFinite(minY) ? (minY + maxY) * 0.5 : 0;
  const cz = Number.isFinite(minZ) ? (minZ + maxZ) * 0.5 : 0;

  // Isometric camera with Z-up orientation (standard for FEA/CFD XY chassis meshes)
  const isoProject = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const cosA = 0.76604; // 40 deg
    const sinA = 0.64279;
    const cosP = 0.81915; // 35 deg pitch
    const sinP = 0.57358;
    const rx = dx * cosA - dy * sinA;
    const ryPlanar = dx * sinA + dy * cosA;
    const sy = dz * cosP - ryPlanar * sinP;
    const depth = dz * sinP + ryPlanar * cosP;
    return [rx, -sy, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of points) {
    const [px, py] = isoProject(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }

  const pSpanX = Math.max(1e-6, pMaxX - pMinX);
  const pSpanY = Math.max(1e-6, pMaxY - pMinY);
  const padX = 85;
  const padY = 54;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProject(p);
    return [+(width * 0.5 + (rx - midPX) * scale).toFixed(1), +(height * 0.5 + (ry - midPY) * scale).toFixed(1), depth];
  };

  interface ShadedTri {
    pts: [[number, number], [number, number], [number, number]];
    depth: number;
    fill: string;
    stroke: string;
  }

  const shadedTris: ShadedTri[] = [];
  const valSpan = Math.max(1e-9, maxVal - minVal);

  for (const [i0, i1, i2] of triFaces.slice(0, 1600)) {
    const v0 = points[i0];
    const v1 = points[i1];
    const v2 = points[i2];
    if (!v0 || !v1 || !v2) continue;

    const s0 = projectScreen(v0);
    const s1 = projectScreen(v1);
    const s2 = projectScreen(v2);
    const avgDepth = (s0[2] + s1[2] + s2[2]) / 3;

    const f0 = nodalScalars[i0] ?? minVal;
    const f1 = nodalScalars[i1] ?? minVal;
    const f2 = nodalScalars[i2] ?? minVal;
    const avgScalar = (f0 + f1 + f2) / 3;
    const normT = (avgScalar - minVal) / valSpan;

    const [cr, cg, cb] = sampleScientificColormap(normT);

    // Compute normal shading
    const ux = v1[0] - v0[0],
      uy = v1[1] - v0[1],
      uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0],
      vy = v2[1] - v0[1],
      vz = v2[2] - v0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    const shade = 0.68 + 0.32 * Math.abs(nx * 0.35 + ny * 0.45 + nz * 0.82);

    const r = Math.min(255, Math.round(cr * shade));
    const g = Math.min(255, Math.round(cg * shade));
    const b = Math.min(255, Math.round(cb * shade));

    shadedTris.push({
      pts: [
        [s0[0], s0[1]],
        [s1[0], s1[1]],
        [s2[0], s2[1]],
      ],
      depth: avgDepth,
      fill: `rgb(${r}, ${g}, ${b})`,
      stroke: `rgba(15, 23, 42, 0.32)`,
    });
  }

  shadedTris.sort((a, b) => a.depth - b.depth);

  // Optional aerodynamic flow streamlines if Velocity field is present
  const streakLines: string[] = [];
  if (velocityVectors.length > 0 && points.length > 0) {
    let vMin = Infinity;
    let vMax = -Infinity;
    const vMags: number[] = [];
    for (const [vx, vy, vz] of velocityVectors) {
      const mag = Math.hypot(vx, vy, vz);
      vMags.push(mag);
      if (mag < vMin) vMin = mag;
      if (mag > vMax) vMax = mag;
    }
    const vSpan = Math.max(1e-6, vMax - vMin);
    const bboxDiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const streakScale = (bboxDiag * 0.22) / Math.max(1e-6, vMax);
    const step = Math.max(1, Math.floor(points.length / 64));
    for (let i = 0; i < points.length && i < velocityVectors.length; i += step) {
      const pt = points[i]!;
      const vel = velocityVectors[i]!;
      const mag = vMags[i] ?? 0;
      if (mag <= 1e-5) continue;
      const pStart: [number, number, number] = [
        pt[0] - vel[0] * streakScale * 0.45,
        pt[1] - vel[1] * streakScale * 0.45,
        pt[2] - vel[2] * streakScale * 0.45,
      ];
      const pEnd: [number, number, number] = [
        pt[0] + vel[0] * streakScale * 0.55,
        pt[1] + vel[1] * streakScale * 0.55,
        pt[2] + vel[2] * streakScale * 0.55,
      ];
      const sA = projectScreen(pStart);
      const sB = projectScreen(pEnd);
      const [sr, sg, sb] = sampleScientificColormap((mag - vMin) / vSpan);
      streakLines.push(
        `<line x1="${sA[0]}" y1="${sA[1]}" x2="${sB[0]}" y2="${sB[1]}" stroke="rgba(${sr}, ${sg}, ${sb}, 0.72)" stroke-width="1.25" stroke-linecap="round" />`,
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <!-- 3D Finite-Element Contour Mesh -->
  <g>
    ${shadedTris
      .map(
        (t) =>
          `<polygon points="${t.pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="0.6" stroke-linejoin="round" />`,
      )
      .join("\n    ")}
  </g>
  ${streakLines.length > 0 ? `<g>\n    ${streakLines.join("\n    ")}\n  </g>` : ""}
</svg>`;

  return {
    svg,
    pointCount: points.length,
    cellCount: offsets.length,
    fieldName,
    minValue: minVal,
    maxValue: maxVal,
  };
}

/**
 * Deterministically renders an isometric 3D CFD melt-front animation preview SVG
 * on the uniform radial greyscale background.
 */
export function renderCfdAnimationIsometricSvg(
  frames: {
    time?: number | undefined;
    geometry?: { positions?: number[] | undefined; indices?: number[] | undefined } | undefined;
    fields?: Record<string, number[] | undefined> | undefined;
  }[],
  moldGeometry?: { length?: number | undefined; width?: number | undefined; height?: number | undefined } | undefined,
): { svg: string; vertexCount: number; frameCount: number } {
  const width = 800;
  const height = 450;

  const f0 = frames[0];
  const rawPositions = f0?.geometry?.positions ?? [];
  const rawIndices = f0?.geometry?.indices ?? [];

  const points: [number, number, number][] = [];
  for (let i = 0; i + 2 < rawPositions.length; i += 3) {
    points.push([rawPositions[i]!, rawPositions[i + 1]!, rawPositions[i + 2]!]);
  }

  // Pick a representative mid-fill frame (~38% through the fill sequence)
  const targetFrameIdx = frames.length > 1 ? Math.min(frames.length - 1, Math.floor(frames.length * 0.38)) : 0;
  const activeFrame = frames[targetFrameIdx] ?? f0;
  const alphaField = activeFrame?.fields?.["alpha.polymer"] ?? [];
  const tempField = activeFrame?.fields?.["temperature"] ?? [];

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX)) {
    const mLen = moldGeometry?.length ?? 0.15;
    const mWid = moldGeometry?.width ?? 0.1;
    const mHei = moldGeometry?.height ?? 0.02;
    minX = -mLen * 0.5;
    maxX = mLen * 0.5;
    minY = -mWid * 0.5;
    maxY = mWid * 0.5;
    minZ = -mHei * 0.5;
    maxZ = mHei * 0.5;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const isoProject = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const cosA = 0.81915; // 35 deg
    const sinA = 0.57358;
    const cosP = 0.84805; // 32 deg pitch
    const sinP = 0.52992;
    const rx = dx * cosA - dy * sinA;
    const ryPlanar = dx * sinA + dy * cosA;
    const sy = dz * cosP - ryPlanar * sinP;
    const depth = dz * sinP + ryPlanar * cosP;
    return [rx, -sy, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of points) {
    const [px, py] = isoProject(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }
  if (!Number.isFinite(pMinX)) {
    pMinX = -0.1;
    pMaxX = 0.1;
    pMinY = -0.06;
    pMaxY = 0.06;
  }

  const pSpanX = Math.max(1e-6, pMaxX - pMinX);
  const pSpanY = Math.max(1e-6, pMaxY - pMinY);
  const padX = 110;
  const padY = 64;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProject(p);
    return [+(width * 0.5 + (rx - midPX) * scale).toFixed(1), +(height * 0.5 + (ry - midPY) * scale).toFixed(1), depth];
  };

  const sampleMeltColor = (alpha: number, temp: number): [number, number, number] => {
    if (alpha < 0.01) {
      return [45, 55, 72];
    }
    const t = Math.max(0, Math.min(1, (temp - 300) / 213));
    const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
    const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
    const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
    let cr = Math.round(r * 255);
    let cg = Math.round(g * 255);
    let cb = Math.round(b * 255);
    if (alpha < 0.5) {
      const u = alpha / 0.5;
      cr = Math.round(45 * (1 - u) + cr * u);
      cg = Math.round(55 * (1 - u) + cg * u);
      cb = Math.round(72 * (1 - u) + cb * u);
    }
    return [cr, cg, cb];
  };

  interface ShadedTri {
    pts: [[number, number], [number, number], [number, number]];
    depth: number;
    fill: string;
  }

  const totalTris = Math.floor(rawIndices.length / 3);
  const triStride = Math.max(1, Math.floor(totalTris / 2400));
  const shadedTris: ShadedTri[] = [];

  for (let tIdx = 0; tIdx < totalTris; tIdx += triStride) {
    const base = tIdx * 3;
    const i0 = rawIndices[base]!;
    const i1 = rawIndices[base + 1]!;
    const i2 = rawIndices[base + 2]!;
    const v0 = points[i0];
    const v1 = points[i1];
    const v2 = points[i2];
    if (!v0 || !v1 || !v2) continue;

    const s0 = projectScreen(v0);
    const s1 = projectScreen(v1);
    const s2 = projectScreen(v2);
    const avgDepth = (s0[2] + s1[2] + s2[2]) / 3;

    const a0 = alphaField[i0] ?? 0;
    const a1 = alphaField[i1] ?? 0;
    const a2 = alphaField[i2] ?? 0;
    const avgAlpha = (a0 + a1 + a2) / 3;

    const t0 = tempField[i0] ?? 420;
    const t1 = tempField[i1] ?? 420;
    const t2 = tempField[i2] ?? 420;
    const avgTemp = (t0 + t1 + t2) / 3;

    const [cr, cg, cb] = sampleMeltColor(avgAlpha, avgTemp);

    const ux = v1[0] - v0[0],
      uy = v1[1] - v0[1],
      uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0],
      vy = v2[1] - v0[1],
      vz = v2[2] - v0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    const shade = 0.72 + 0.28 * Math.abs(nx * 0.35 + ny * 0.45 + nz * 0.82);

    const r = Math.min(255, Math.round(cr * shade));
    const g = Math.min(255, Math.round(cg * shade));
    const b = Math.min(255, Math.round(cb * shade));

    shadedTris.push({
      pts: [
        [s0[0], s0[1]],
        [s1[0], s1[1]],
        [s2[0], s2[1]],
      ],
      depth: avgDepth,
      fill: `rgb(${r}, ${g}, ${b})`,
    });
  }

  shadedTris.sort((a, b) => a.depth - b.depth);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <!-- 3D Melt-Front Cavity Mesh -->
  <g>
    ${shadedTris
      .map(
        (t) =>
          `<polygon points="${t.pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${t.fill}" stroke="${t.fill}" stroke-width="0.8" stroke-linejoin="round" />`,
      )
      .join("\n    ")}
  </g>
</svg>`;

  return {
    svg,
    vertexCount: points.length,
    frameCount: frames.length,
  };
}

export function preprocessVtuResultArtifact(ctx: PreprocessContext): PreprocessResult {
  const vtuSvg = renderVtuIsometricSvg(ctx.content, ctx.baseTitle);
  return {
    svg: vtuSvg.svg,
    metadata: {
      pointCount: vtuSvg.pointCount,
      cellCount: vtuSvg.cellCount,
      fieldName: vtuSvg.fieldName,
      minValue: vtuSvg.minValue,
      maxValue: vtuSvg.maxValue,
    },
    viewConfigAdditions: {
      title: ctx.baseTitle,
      pointCount: vtuSvg.pointCount,
      cellCount: vtuSvg.cellCount,
      fieldName: vtuSvg.fieldName,
    },
  };
}
