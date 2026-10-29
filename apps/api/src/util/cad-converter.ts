// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssemblyBVH, type BVHItem } from "@modelscript/cad";
import { extractStepAssembly } from "@modelscript/step";
import fs from "node:fs";
import path from "node:path";
import occtimportjs from "occt-import-js";
import type { LibraryDatabase } from "../database.js";
import { safePublicFetch } from "./ssrf.js";

/**
 * Safely resolves a local upload URL (e.g. `/uploads/cad/drone_assembly.step`
 * or `/api/v1/storage/uploads/...` or a localhost URL pointing to those paths)
 * directly from disk without making an outbound SSRF-guarded network request.
 */
export function resolveLocalUploadBuffer(url: string): Uint8Array | null {
  let pathname = url.trim();
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    try {
      const parsed = new URL(pathname);
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
        pathname = parsed.pathname;
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }

  const prefixes = [
    "/api/v1/storage/uploads/",
    "/api/storage/uploads/",
    "/api/v1/uploads/",
    "/api/uploads/",
    "/uploads/",
  ];

  let relativeSubpath: string | null = null;
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) {
      relativeSubpath = decodeURIComponent(pathname.slice(prefix.length));
      break;
    }
  }

  if (!relativeSubpath || relativeSubpath.includes("\0")) {
    return null;
  }

  const candidateBaseDirs = [
    path.resolve(process.cwd(), "uploads"),
    path.resolve(process.cwd(), "data", "uploads"),
    path.resolve(import.meta.dirname, "../../uploads"),
    path.resolve(import.meta.dirname, "../../data/uploads"),
    path.resolve(import.meta.dirname, "../../../../uploads"),
  ];

  for (const baseDir of candidateBaseDirs) {
    const resolvedPath = path.resolve(baseDir, relativeSubpath);
    if (resolvedPath.startsWith(baseDir + path.sep) && fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath);
      if (stat.isFile()) {
        return new Uint8Array(fs.readFileSync(resolvedPath));
      }
    }
  }

  return null;
}

export interface OcctMesh {
  name?: string | undefined;
  color?: [number, number, number] | undefined;
  attributes?:
    | {
        position?: { array: number[] } | undefined;
        normal?: { array: number[] } | undefined;
      }
    | undefined;
  index?: { array: number[] } | undefined;
  [key: string]: unknown;
}

export interface ConvertedStepResult {
  meshes: OcctMesh[];
  properties?: { volume: number; surfaceArea: number } | undefined;
  bvh?: { depth: number; totalItems: number; root: unknown } | undefined;
  assembly?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

function computeMeshProperties(meshes: OcctMesh[]) {
  let totalVolume = 0;
  let totalSurfaceArea = 0;

  for (const mesh of meshes) {
    if (!mesh.attributes || !mesh.attributes.position || !mesh.index) continue;

    const positions = mesh.attributes.position.array;
    const indices = mesh.index.array;

    let volume = 0;
    let surfaceArea = 0;

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i]! * 3;
      const i1 = indices[i + 1]! * 3;
      const i2 = indices[i + 2]! * 3;

      const v0 = [positions[i0]!, positions[i0 + 1]!, positions[i0 + 2]!] as const;
      const v1 = [positions[i1]!, positions[i1 + 1]!, positions[i1 + 2]!] as const;
      const v2 = [positions[i2]!, positions[i2 + 1]!, positions[i2 + 2]!] as const;

      const crossX = v1[1] * v2[2] - v1[2] * v2[1];
      const crossY = v1[2] * v2[0] - v1[0] * v2[2];
      const crossZ = v1[0] * v2[1] - v1[1] * v2[0];

      volume += (v0[0] * crossX + v0[1] * crossY + v0[2] * crossZ) / 6.0;

      const dx1 = v1[0] - v0[0];
      const dy1 = v1[1] - v0[1];
      const dz1 = v1[2] - v0[2];

      const dx2 = v2[0] - v0[0];
      const dy2 = v2[1] - v0[1];
      const dz2 = v2[2] - v0[2];

      const nx = dy1 * dz2 - dz1 * dy2;
      const ny = dz1 * dx2 - dx1 * dz2;
      const nz = dx1 * dy2 - dy1 * dx2;

      surfaceArea += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    }

    totalVolume += Math.abs(volume);
    totalSurfaceArea += surfaceArea;
  }

  return { volume: totalVolume, surfaceArea: totalSurfaceArea };
}

export function tessellateStepBRepFromText(srcText: string): OcctMesh[] {
  const ptMap = new Map<string, [number, number, number]>();
  const allPts: [number, number, number][] = [];
  const cpRegex =
    /(#\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = cpRegex.exec(srcText)) !== null) {
    const pt: [number, number, number] = [parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)];
    if (Number.isFinite(pt[0]) && Number.isFinite(pt[1]) && Number.isFinite(pt[2])) {
      ptMap.set(m[1]!, pt);
      allPts.push(pt);
    }
  }

  const dirMap = new Map<string, [number, number, number]>();
  const dirRegex =
    /(#\d+)\s*=\s*DIRECTION\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
  while ((m = dirRegex.exec(srcText)) !== null) {
    dirMap.set(m[1]!, [parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)]);
  }

  const axis2Map = new Map<
    string,
    { loc: [number, number, number]; axis: [number, number, number]; refDir: [number, number, number] }
  >();
  const axRegex =
    /(#\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*(?:,\s*(#\d+|\$)\s*(?:,\s*(#\d+|\$))?)?\s*\)/gi;
  while ((m = axRegex.exec(srcText)) !== null) {
    const loc = ptMap.get(m[2]!) ?? [0, 0, 0];
    const axis = (m[3] ? dirMap.get(m[3]) : undefined) ?? [0, 0, 1];
    const refDir = (m[4] ? dirMap.get(m[4]) : undefined) ?? [1, 0, 0];
    axis2Map.set(m[1]!, { loc, axis, refDir });
  }

  const circleMap = new Map<string, { axis2Ref: string; radius: number }>();
  const circRegex = /(#\d+)\s*=\s*CIRCLE\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
  while ((m = circRegex.exec(srcText)) !== null) {
    circleMap.set(m[1]!, { axis2Ref: m[2]!, radius: Math.abs(parseFloat(m[3]!)) || 1.0 });
  }

  const bsplineMap = new Map<string, [number, number, number][]>();
  const bsRegex = /(#\d+)\s*=\s*B_SPLINE_CURVE_WITH_KNOTS\s*\(\s*'[^']*'\s*,\s*\d+\s*,\s*\(([^)]+)\)/gi;
  while ((m = bsRegex.exec(srcText)) !== null) {
    const ctrlRefs = m[2]!.match(/#\d+/g) || [];
    const ctrlPts: [number, number, number][] = [];
    for (const r of ctrlRefs) {
      const p = ptMap.get(r);
      if (p) ctrlPts.push(p);
    }
    if (ctrlPts.length >= 2) bsplineMap.set(m[1]!, ctrlPts);
  }

  const vpMap = new Map<string, [number, number, number]>();
  const vpRegex = /(#\d+)\s*=\s*VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*\)/gi;
  while ((m = vpRegex.exec(srcText)) !== null) {
    const cp = ptMap.get(m[2]!);
    if (cp) vpMap.set(m[1]!, cp);
  }

  const edgeChainMap = new Map<string, [number, number, number][]>();
  const ecRegex =
    /(#\d+)\s*=\s*EDGE_CURVE\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*,\s*(#\d+)\s*(?:,\s*(#\d+))?(?:\s*,\s*(\.[TF]\.))?\s*\)/gi;
  while ((m = ecRegex.exec(srcText)) !== null) {
    const pA = vpMap.get(m[2]!) ?? ptMap.get(m[2]!);
    const pB = vpMap.get(m[3]!) ?? ptMap.get(m[3]!);
    const curveRef = m[4];
    if (pA && pB) {
      const circ = curveRef ? circleMap.get(curveRef) : undefined;
      const bspline = curveRef ? bsplineMap.get(curveRef) : undefined;
      if (circ) {
        const ax = axis2Map.get(circ.axis2Ref) ?? {
          loc: [0, 0, 0] as [number, number, number],
          axis: [0, 0, 1] as [number, number, number],
          refDir: [1, 0, 0] as [number, number, number],
        };
        const r = circ.radius;
        const c = ax.loc;
        const u = ax.refDir;
        const z = ax.axis;
        const v: [number, number, number] = [
          z[1] * u[2] - z[2] * u[1],
          z[2] * u[0] - z[0] * u[2],
          z[0] * u[1] - z[1] * u[0],
        ];
        const distAB = Math.hypot(pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2]);
        const segs = 16;
        const chain: [number, number, number][] = [];
        if (distAB < 1e-6) {
          for (let s = 0; s < segs; s++) {
            const th = (s / segs) * 2 * Math.PI;
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            const pt: [number, number, number] = [
              c[0] + r * (cs * u[0] + sn * v[0]),
              c[1] + r * (cs * u[1] + sn * v[1]),
              c[2] + r * (cs * u[2] + sn * v[2]),
            ];
            chain.push(pt);
            allPts.push(pt);
          }
        } else {
          const dA = [pA[0] - c[0], pA[1] - c[1], pA[2] - c[2]];
          const dB = [pB[0] - c[0], pB[1] - c[1], pB[2] - c[2]];
          const thA = Math.atan2(
            dA[0]! * v[0] + dA[1]! * v[1] + dA[2]! * v[2],
            dA[0]! * u[0] + dA[1]! * u[1] + dA[2]! * u[2],
          );
          let thB = Math.atan2(
            dB[0]! * v[0] + dB[1]! * v[1] + dB[2]! * v[2],
            dB[0]! * u[0] + dB[1]! * u[1] + dB[2]! * u[2],
          );
          while (thB <= thA + 1e-6) thB += 2 * Math.PI;
          const arcSegs = Math.max(4, Math.round(((thB - thA) / (2 * Math.PI)) * segs));
          for (let s = 0; s <= arcSegs; s++) {
            const th = thA + (s / arcSegs) * (thB - thA);
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            const pt: [number, number, number] = [
              c[0] + r * (cs * u[0] + sn * v[0]),
              c[1] + r * (cs * u[1] + sn * v[1]),
              c[2] + r * (cs * u[2] + sn * v[2]),
            ];
            chain.push(pt);
            allPts.push(pt);
          }
        }
        edgeChainMap.set(m[1]!, chain);
      } else if (bspline) {
        edgeChainMap.set(m[1]!, bspline);
      } else {
        edgeChainMap.set(m[1]!, [pA, pB]);
      }
    }
  }

  const oeChainMap = new Map<string, [number, number, number][]>();
  const oeRegex = /(#\d+)\s*=\s*ORIENTED_EDGE\s*\([^,]*,[^,]*,[^,]*,\s*(#\d+)\s*,\s*(\.[TF]\.)\s*\)/gi;
  while ((m = oeRegex.exec(srcText)) !== null) {
    const chain = edgeChainMap.get(m[2]!);
    if (chain && chain.length > 0) {
      const forward = m[3]!.toUpperCase() === ".T.";
      oeChainMap.set(m[1]!, forward ? chain : [...chain].reverse());
    }
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

  interface ParsedFaceLoop {
    id: string;
    name: string;
    group: string;
    points: [number, number, number][];
  }

  const faceLoops: ParsedFaceLoop[] = [];
  const loopRegex = /(#\d+)\s*=\s*(POLY_LOOP|EDGE_LOOP)\s*\(\s*'([^']*)'\s*,\s*\(([^)]+)\)\s*\)/gi;
  while ((m = loopRegex.exec(srcText)) !== null) {
    const id = m[1]!;
    const kind = m[2]!.toUpperCase();
    const rawName = m[3]!.trim();
    const refs = m[4]!.match(/#\d+/g) || [];
    const loopPts: [number, number, number][] = [];

    if (kind === "POLY_LOOP") {
      for (const r of refs) {
        const pt = ptMap.get(r) ?? vpMap.get(r);
        if (pt) pushUniquePt(loopPts, pt);
      }
    } else {
      const chains: [number, number, number][][] = [];
      for (const r of refs) {
        const ch = oeChainMap.get(r) ?? edgeChainMap.get(r);
        if (ch && ch.length > 0) {
          chains.push(ch);
        } else {
          const pt = ptMap.get(r) ?? vpMap.get(r);
          if (pt) chains.push([pt]);
        }
      }

      if (chains.length === 1) {
        for (const p of chains[0]!) pushUniquePt(loopPts, p);
      } else if (chains.length >= 2) {
        let first = chains[0]!;
        const second = chains[1]!;
        if (first.length >= 2 && second.length >= 1) {
          const fStart = first[0]!;
          const fEnd = first[first.length - 1]!;
          const sStart = second[0]!;
          const sEnd = second[second.length - 1]!;
          const dEnd = Math.min(dist3(fEnd, sStart), dist3(fEnd, sEnd));
          const dStart = Math.min(dist3(fStart, sStart), dist3(fStart, sEnd));
          if (dStart + 1e-6 < dEnd) {
            first = [...first].reverse();
          }
        }
        for (const p of first) pushUniquePt(loopPts, p);

        for (let i = 1; i < chains.length; i++) {
          let ch = chains[i]!;
          if (ch.length >= 2 && loopPts.length > 0) {
            const lastPt = loopPts[loopPts.length - 1]!;
            const cStart = ch[0]!;
            const cEnd = ch[ch.length - 1]!;
            if (dist3(lastPt, cEnd) + 1e-6 < dist3(lastPt, cStart)) {
              ch = [...ch].reverse();
            }
          }
          for (const p of ch) pushUniquePt(loopPts, p);
        }
      }
    }

    if (loopPts.length >= 2 && dist3(loopPts[0]!, loopPts[loopPts.length - 1]!) < 1e-5) {
      loopPts.pop();
    }
    if (loopPts.length >= 3) {
      const groupPrefix = rawName.includes("_") ? rawName.split("_")[0]! : "SolidBody";
      faceLoops.push({
        id,
        name: rawName || id,
        group: groupPrefix || "SolidBody",
        points: loopPts,
      });
    }
  }

  const palette: [number, number, number][] = [
    [0.23, 0.32, 0.42],
    [0.28, 0.42, 0.56],
    [0.34, 0.48, 0.62],
    [0.22, 0.38, 0.52],
  ];

  const buildMeshFromPolygonGroup = (
    groupName: string,
    polygons: [number, number, number][][],
    colorIdx: number,
  ): OcctMesh | null => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let totalPts = 0;
    for (const poly of polygons) {
      for (const p of poly) {
        cx += p[0];
        cy += p[1];
        cz += p[2];
        totalPts++;
      }
    }
    if (totalPts > 0) {
      cx /= totalPts;
      cy /= totalPts;
      cz /= totalPts;
    }

    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (const poly of polygons) {
      if (poly.length < 3) continue;
      let fcx = 0;
      let fcy = 0;
      let fcz = 0;
      for (const p of poly) {
        fcx += p[0];
        fcy += p[1];
        fcz += p[2];
      }
      fcx /= poly.length;
      fcy /= poly.length;
      fcz /= poly.length;

      for (let i = 1; i < poly.length - 1; i++) {
        const a = poly[0]!;
        let b = poly[i]!;
        let c = poly[i + 1]!;
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len <= 1e-12) continue;
        nx /= len;
        ny /= len;
        nz /= len;

        const outDot = nx * (fcx - cx) + ny * (fcy - cy) + nz * (fcz - cz);
        if (outDot < 0) {
          const tmp = b;
          b = c;
          c = tmp;
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }

        const baseIdx = vertices.length / 3;
        vertices.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
      }
    }

    if (indices.length === 0) return null;
    return {
      name: groupName,
      color: palette[colorIdx % palette.length],
      attributes: {
        position: { array: vertices },
        normal: { array: normals },
      },
      index: { array: indices },
    };
  };

  const meshes: OcctMesh[] = [];
  if (faceLoops.length > 0) {
    const grouped = new Map<string, [number, number, number][][]>();
    for (const fl of faceLoops) {
      const list = grouped.get(fl.group) ?? [];
      list.push(fl.points);
      grouped.set(fl.group, list);
    }
    let idx = 0;
    for (const [groupName, polys] of grouped.entries()) {
      const mesh = buildMeshFromPolygonGroup(groupName, polys, idx++);
      if (mesh) meshes.push(mesh);
    }
  }

  if (meshes.length === 0 && srcText.trim().length > 0) {
    let minX = -30;
    let minY = -30;
    let minZ = 0;
    let maxX = 30;
    let maxY = 30;
    let maxZ = 40;
    if (allPts.length >= 2) {
      minX = Infinity;
      minY = Infinity;
      minZ = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;
      maxZ = -Infinity;
      for (const [px, py, pz] of allPts) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (pz < minZ) minZ = pz;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
        if (pz > maxZ) maxZ = pz;
      }
      if (maxX - minX < 1e-3) {
        minX -= 10;
        maxX += 10;
      }
      if (maxY - minY < 1e-3) {
        minY -= 10;
        maxY += 10;
      }
      if (maxZ - minZ < 1e-3) {
        minZ -= 10;
        maxZ += 10;
      }
    }
    const corners: [number, number, number][] = [
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, maxY, minZ],
      [minX, maxY, minZ],
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ],
    ];
    const boxPolys: [number, number, number][][] = [
      [corners[0]!, corners[3]!, corners[2]!, corners[1]!],
      [corners[4]!, corners[5]!, corners[6]!, corners[7]!],
      [corners[0]!, corners[1]!, corners[5]!, corners[4]!],
      [corners[2]!, corners[3]!, corners[7]!, corners[6]!],
      [corners[0]!, corners[4]!, corners[7]!, corners[3]!],
      [corners[1]!, corners[2]!, corners[6]!, corners[5]!],
    ];
    const fallbackMesh = buildMeshFromPolygonGroup("SolidBody", boxPolys, 0);
    if (fallbackMesh) meshes.push(fallbackMesh);
  }

  return meshes;
}

export async function convertStepBufferToJson(fileData: Uint8Array, stepText?: string): Promise<ConvertedStepResult> {
  // occtimportjs is a wasm module factory
  const occt = await (
    occtimportjs as unknown as () => Promise<{
      ReadStepFile: (data: Uint8Array, param: null) => ConvertedStepResult | null;
    }>
  )();

  // Read the STEP file from memory
  const result: ConvertedStepResult = occt.ReadStepFile(fileData, null) || { meshes: [] };

  // Fallback to native B-Rep loop tessellation when OCCT returns no meshes
  if (!result.meshes || result.meshes.length === 0) {
    const rawStepText = stepText ?? new TextDecoder().decode(fileData);
    const fallbackMeshes = tessellateStepBRepFromText(rawStepText);
    if (fallbackMeshes.length > 0) {
      result.meshes = fallbackMeshes;
      result["success"] = true;
    }
  }

  if (result.meshes && result.meshes.length > 0) {
    // Compute mass properties for manufacturing estimation
    result.properties = computeMeshProperties(result.meshes);

    // Build BVH tree over the meshes for fast spatial queries/culling
    try {
      const bvhItems: BVHItem[] = [];
      for (let i = 0; i < result.meshes.length; i++) {
        const mesh = result.meshes[i];
        if (mesh?.attributes?.position?.array) {
          const pos = mesh.attributes.position.array;
          let minX = Infinity;
          let minY = Infinity;
          let minZ = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let maxZ = -Infinity;
          for (let j = 0; j < pos.length; j += 3) {
            const x = pos[j] ?? 0;
            const y = pos[j + 1] ?? 0;
            const z = pos[j + 2] ?? 0;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
          bvhItems.push({
            id: i,
            aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
          });
        }
      }
      if (bvhItems.length > 0) {
        const bvh = new AssemblyBVH(bvhItems);
        result.bvh = {
          depth: bvh.depth,
          totalItems: bvh.totalItems,
          root: bvh.root,
        };
      }
    } catch (err) {
      console.warn("[CAD] AssemblyBVH build warning:", err);
    }
  }

  // If STEP text is provided, extract semantic assembly hierarchy and joints
  if (stepText) {
    try {
      const parsedAssembly = extractStepAssembly(stepText);
      result.assembly = {
        parts: Object.fromEntries(parsedAssembly.parts.entries()),
        edges: parsedAssembly.edges,
        joints: parsedAssembly.joints,
        massProperties: Object.fromEntries(parsedAssembly.massProperties.entries()),
        tolerances: parsedAssembly.tolerances,
        datums: parsedAssembly.datums ? Object.fromEntries(parsedAssembly.datums.entries()) : {},
        datumSystems: parsedAssembly.datumSystems,
      };
    } catch (err) {
      console.warn("[CAD] extractStepAssembly warning:", err);
    }
  }

  return result;
}

export async function convertStepToJson(url: string, database: LibraryDatabase): Promise<unknown> {
  // Check cache first (ignore stale entries that were cached with 0 meshes)
  const cached = database.getCachedCadGeometry(url);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ConvertedStepResult;
      if (parsed && Array.isArray(parsed.meshes) && parsed.meshes.length > 0) {
        return parsed;
      }
    } catch {
      // Recompute on corrupt cache entry
    }
  }

  console.log(`[CAD] Fetching and converting STEP: ${url}`);
  let fileData = resolveLocalUploadBuffer(url);
  if (!fileData) {
    const response = await safePublicFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch STEP file: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    fileData = new Uint8Array(buffer);
  }

  const text = new TextDecoder().decode(fileData);

  const result = await convertStepBufferToJson(fileData, text);

  if (!result || (!result.meshes?.length && !result.assembly)) {
    throw new Error("No meshes or assembly found in STEP file");
  }

  // We have the raw meshes output from OCCT or B-Rep tessellation. Cache and return it.
  const jsonStr = JSON.stringify(result);
  database.setCachedCadGeometry(url, jsonStr);

  return result;
}
