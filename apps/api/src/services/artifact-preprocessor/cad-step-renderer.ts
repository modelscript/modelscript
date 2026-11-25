// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { escapeXml } from "../../util/escape.js";
import type { PreprocessContext, PreprocessResult } from "./types.js";

export interface StepSvgPreviewResult {
  svg: string;
  title: string;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
}

/**
 * Deterministically parses ISO-10303-21 STEP B-Rep entities (`CARTESIAN_POINT`,
 * `VERTEX_POINT`, `EDGE_CURVE`, `ORIENTED_EDGE`, `EDGE_LOOP`) and renders a
 * depth-sorted isometric shaded 3D CAD assembly SVG thumbnail.
 */
export function renderStepIsometricSvg(stepContent: string, fallbackTitle = "CAD Assembly"): StepSvgPreviewResult {
  const width = 800;
  const height = 450;

  const fileDescMatch = /FILE_NAME\s*\(\s*'([^']+)'/i.exec(stepContent);
  const rawName = fileDescMatch?.[1] ? path.parse(fileDescMatch[1]).name : fallbackTitle;
  const displayTitle = escapeXml(fallbackTitle || rawName || "CAD Assembly");

  const cartesianPoints = new Map<number, [number, number, number]>();
  const ptRe =
    /#(\d+)\s*=\s*CARTESIAN_POINT\s*\([^,]*,\s*\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = ptRe.exec(stepContent)) !== null) {
    const id = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    const z = Number(m[4]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      cartesianPoints.set(id, [x, y, z]);
    }
  }

  const vertexPoints = new Map<number, [number, number, number]>();
  const vpRe = /#(\d+)\s*=\s*VERTEX_POINT\s*\([^,]*,\s*#(\d+)\s*\)/g;
  while ((m = vpRe.exec(stepContent)) !== null) {
    const vid = Number(m[1]);
    const pid = Number(m[2]);
    const pt = cartesianPoints.get(pid);
    if (pt) {
      vertexPoints.set(vid, pt);
    }
  }

  const edgeCurves = new Map<number, [[number, number, number], [number, number, number]]>();
  const ecRe = /#(\d+)\s*=\s*EDGE_CURVE\s*\([^,]*,\s*#(\d+)\s*,\s*#(\d+)/g;
  while ((m = ecRe.exec(stepContent)) !== null) {
    const eid = Number(m[1]);
    const v1 = vertexPoints.get(Number(m[2])) ?? cartesianPoints.get(Number(m[2]));
    const v2 = vertexPoints.get(Number(m[3])) ?? cartesianPoints.get(Number(m[3]));
    if (v1 && v2) {
      edgeCurves.set(eid, [v1, v2]);
    }
  }

  const orientedEdges = new Map<number, { edgeId: number; forward: boolean }>();
  const oeRe = /#(\d+)\s*=\s*ORIENTED_EDGE\s*\([^,]*,[^,]*,[^,]*,\s*#(\d+)\s*,\s*\.(T|F)\./g;
  while ((m = oeRe.exec(stepContent)) !== null) {
    orientedEdges.set(Number(m[1]), {
      edgeId: Number(m[2]),
      forward: m[3] === "T",
    });
  }

  const dist3 = (a: [number, number, number], b: [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const pushUniquePt = (arr: [number, number, number][], p: [number, number, number]) => {
    if (arr.length > 0) {
      const last = arr[arr.length - 1]!;
      if (dist3(last, p) < 1e-6) return;
    }
    arr.push(p);
  };

  const faces: [number, number, number][][] = [];
  const elRe = /#(\d+)\s*=\s*EDGE_LOOP\s*\([^,]*,\s*\(([^)]+)\)\s*\)/g;
  while ((m = elRe.exec(stepContent)) !== null) {
    const refs = m[2]!.match(/#(\d+)/g);
    if (!refs || refs.length < 3) continue;
    const segs: [[number, number, number], [number, number, number]][] = [];
    for (const ref of refs) {
      const refId = Number(ref.slice(1));
      const oe = orientedEdges.get(refId);
      if (oe) {
        const curve = edgeCurves.get(oe.edgeId);
        if (curve) {
          segs.push(oe.forward ? [curve[0], curve[1]] : [curve[1], curve[0]]);
        }
      } else {
        const curve = edgeCurves.get(refId);
        if (curve) {
          segs.push([curve[0], curve[1]]);
        }
      }
    }
    if (segs.length < 2) continue;

    const poly: [number, number, number][] = [];
    let firstSeg = segs[0]!;
    const secondSeg = segs[1]!;
    const dEnd = Math.min(dist3(firstSeg[1], secondSeg[0]), dist3(firstSeg[1], secondSeg[1]));
    const dStart = Math.min(dist3(firstSeg[0], secondSeg[0]), dist3(firstSeg[0], secondSeg[1]));
    if (dStart + 1e-6 < dEnd) {
      firstSeg = [firstSeg[1], firstSeg[0]];
    }
    pushUniquePt(poly, firstSeg[0]);
    pushUniquePt(poly, firstSeg[1]);

    for (let i = 1; i < segs.length; i++) {
      let seg = segs[i]!;
      const lastPt = poly[poly.length - 1]!;
      if (dist3(lastPt, seg[1]) + 1e-6 < dist3(lastPt, seg[0])) {
        seg = [seg[1], seg[0]];
      }
      pushUniquePt(poly, seg[0]);
      pushUniquePt(poly, seg[1]);
    }

    if (poly.length >= 2 && dist3(poly[0]!, poly[poly.length - 1]!) < 1e-5) {
      poly.pop();
    }
    if (poly.length >= 3) {
      faces.push(poly);
    }
  }

  // Compute 3D bounding box over all vertex/cartesian points
  const allPts = vertexPoints.size > 0 ? Array.from(vertexPoints.values()) : Array.from(cartesianPoints.values());

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of allPts) {
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

  // Trimetric CAD projection (assuming Y-up or Z-up, tilted so all 3 axes have clear separation)
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const zUp = spanZ < spanY * 0.4; // If Z is thin (e.g. FEA/CFD XY plane with Z thickness), treat Z as vertical
  const isoProjectRaw = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = zUp ? p[2] - cz : p[1] - cy;
    const dz = zUp ? -(p[1] - cy) : p[2] - cz;
    // Rotate yaw 38 deg, pitch 28 deg
    const cosY = 0.78801;
    const sinY = 0.61566;
    const cosP = 0.88295;
    const sinP = 0.46947;
    const rx = dx * cosY + dz * sinY;
    const rz = -dx * sinY + dz * cosY;
    const ry = dy * cosP - rz * sinP;
    const depth = dy * sinP + rz * cosP;
    return [rx, -ry, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of allPts) {
    const [px, py] = isoProjectRaw(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }

  const pSpanX = Math.max(1e-5, pMaxX - pMinX);
  const pSpanY = Math.max(1e-5, pMaxY - pMinY);
  const padX = 90;
  const padY = 72;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProjectRaw(p);
    return [
      +(width * 0.5 + (rx - midPX) * scale).toFixed(1),
      +(height * 0.52 + (ry - midPY) * scale).toFixed(1),
      depth,
    ];
  };

  const renderedElements: string[] = [];

  if (faces.length > 0) {
    interface ProjectedFace {
      pts2d: [number, number][];
      depth: number;
      fill: string;
      stroke: string;
    }
    const projFaces: ProjectedFace[] = [];
    for (const poly of faces.slice(0, 1500)) {
      const proj = poly.map(projectScreen);
      let sumDepth = 0;
      for (const p of proj) sumDepth += p[2];
      const avgDepth = sumDepth / proj.length;

      // Face normal via cross product of first 3 non-collinear vertices
      const p0 = poly[0]!;
      const p1 = poly[1]!;
      const p2 = poly[2]!;
      const ux = p1[0] - p0[0],
        uy = p1[1] - p0[1],
        uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0],
        vy = p2[1] - p0[1],
        vz = p2[2] - p0[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      // Key light from top-right-front
      const lightDot = Math.abs(nx * 0.45 + ny * 0.72 + nz * 0.52);
      const intensity = Math.min(1, Math.max(0.2, 0.25 + lightDot * 0.75));
      const r = Math.round(42 + intensity * 62);
      const g = Math.round(68 + intensity * 84);
      const b = Math.round(98 + intensity * 102);

      projFaces.push({
        pts2d: proj.map((p) => [p[0], p[1]]),
        depth: avgDepth,
        fill: `rgba(${r}, ${g}, ${b}, 0.94)`,
        stroke: `rgba(30, 41, 59, ${+(0.35 + intensity * 0.25).toFixed(2)})`,
      });
    }

    projFaces.sort((a, b) => a.depth - b.depth);
    for (const f of projFaces) {
      renderedElements.push(
        `<polygon points="${f.pts2d.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${f.fill}" stroke="${f.stroke}" stroke-width="0.85" stroke-linejoin="round" />`,
      );
    }
  } else if (edgeCurves.size > 0) {
    for (const [v1, v2] of Array.from(edgeCurves.values()).slice(0, 1200)) {
      const p1 = projectScreen(v1);
      const p2 = projectScreen(v2);
      renderedElements.push(
        `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#334155" stroke-width="1.2" opacity="0.85" />`,
      );
    }
  }

  void displayTitle;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <!-- 3D Projected B-Rep Geometry -->
  <g>
    ${renderedElements.join("\n    ")}
  </g>
</svg>`;

  return {
    svg,
    title: rawName,
    vertexCount: vertexPoints.size || cartesianPoints.size,
    edgeCount: edgeCurves.size,
    faceCount: faces.length,
  };
}

export function preprocessStepArtifact(ctx: PreprocessContext): PreprocessResult {
  const stepSvg = renderStepIsometricSvg(ctx.content, ctx.baseTitle);
  return {
    svg: stepSvg.svg,
    metadata: {
      faceCount: stepSvg.faceCount,
      edgeCount: stepSvg.edgeCount,
      vertexCount: stepSvg.vertexCount,
    },
    viewConfigAdditions: {
      ...(ctx.inlineCode ? { code: ctx.inlineCode, stepSource: ctx.inlineCode } : {}),
      title: stepSvg.title || ctx.baseTitle,
      faceCount: stepSvg.faceCount,
      edgeCount: stepSvg.edgeCount,
      vertexCount: stepSvg.vertexCount,
    },
  };
}
