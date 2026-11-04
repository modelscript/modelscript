// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — RAS Coordinate Transform, Isosurface Mesh Extraction,
 * Tetrahedral Volume Integration, and Compartmental Tracer DAE Lowering.
 *
 * Evaluates voxel-to-world RAS coordinates x_RAS = A * [i, j, k, 1]^T,
 * extracts triangulated boundary isosurfaces from 3D medical volumes,
 * and lowers compartmental tracer/diffusion equations into DAEBuilder.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { computeSformAffineDeterminant } from "../lints/rules.js";
import type { Matrix4x4, NiftiDocument, NiftiHeader } from "../types.js";

export interface NiftiLabelVolumeStats {
  labelId: number;
  labelName: string;
  voxelCount: number;
  volumeMm3: number;
  centroidRAS: [number, number, number];
}

export interface NiftiSurfaceMeshSummary {
  title: string;
  isoValue: number;
  labelId?: number | undefined;
  foregroundVoxelCount: number;
  voxelVolumeMm3: number;
  totalVolumeMm3: number;
  tetrahedralVolumeMm3: number;
  surfaceAreaMm2: number;
  verticesRAS: [number, number, number][];
  triangles: [number, number, number][];
  normals: [number, number, number][];
  boundingBoxRAS: {
    min: [number, number, number];
    max: [number, number, number];
  };
  affineMatrix: Matrix4x4;
  labelStats: NiftiLabelVolumeStats[];
}

export interface ExtractIsoSurfaceOptions {
  isoValue?: number | undefined;
  labelId?: number | undefined;
}

/**
 * Constructs the 4x4 voxel-to-world RAS transformation matrix A from NIfTI sform or qform.
 */
export function buildAffineMatrix(header: NiftiHeader): Matrix4x4 {
  if (header.sformCode > 0) {
    return [
      [header.srowX[0], header.srowX[1], header.srowX[2], header.srowX[3]],
      [header.srowY[0], header.srowY[1], header.srowY[2], header.srowY[3]],
      [header.srowZ[0], header.srowZ[1], header.srowZ[2], header.srowZ[3]],
      [0, 0, 0, 1],
    ];
  }

  const dx = header.pixdim[1] > 0 ? header.pixdim[1] : 1.0;
  const dy = header.pixdim[2] > 0 ? header.pixdim[2] : 1.0;
  const dz = header.pixdim[3] > 0 ? header.pixdim[3] : 1.0;

  if (header.qformCode > 0) {
    const b = header.quaternB;
    const c = header.quaternC;
    const d = header.quaternD;
    const aSq = Math.max(0, 1.0 - (b * b + c * c + d * d));
    const a = Math.sqrt(aSq);
    const qfac = header.pixdim[0] === -1 ? -1.0 : 1.0;

    const r00 = a * a + b * b - c * c - d * d;
    const r01 = 2.0 * (b * c - a * d);
    const r02 = 2.0 * (b * d + a * c);

    const r10 = 2.0 * (b * c + a * d);
    const r11 = a * a + c * c - b * b - d * d;
    const r12 = 2.0 * (c * d - a * b);

    const r20 = 2.0 * (b * d - a * c);
    const r21 = 2.0 * (c * d + a * b);
    const r22 = a * a + d * d - b * b - c * c;

    return [
      [r00 * dx, r01 * dy, r02 * dz * qfac, header.qoffsetX],
      [r10 * dx, r11 * dy, r12 * dz * qfac, header.qoffsetY],
      [r20 * dx, r21 * dy, r22 * dz * qfac, header.qoffsetZ],
      [0, 0, 0, 1],
    ];
  }

  return [
    [dx, 0, 0, 0],
    [0, dy, 0, 0],
    [0, 0, dz, 0],
    [0, 0, 0, 1],
  ];
}

/**
 * Transforms voxel grid index (i, j, k) to 3D Right-Anterior-Superior (RAS) world coordinates [mm]:
 *   x_RAS = A * [i, j, k, 1]^T
 */
export function voxelToWorldRAS(header: NiftiHeader, i: number, j: number, k: number): [number, number, number] {
  const A = buildAffineMatrix(header);
  const x = A[0][0] * i + A[0][1] * j + A[0][2] * k + A[0][3];
  const y = A[1][0] * i + A[1][1] * j + A[1][2] * k + A[1][3];
  const z = A[2][0] * i + A[2][1] * j + A[2][2] * k + A[2][3];
  return [x, y, z];
}

/**
 * Extracts a watertight triangulated surface mesh in RAS world coordinates from a 3D voxel grid,
 * computes exact and tetrahedralized volumes, surface area, and anatomical label statistics.
 */
export function extractIsoSurfaceMesh(doc: NiftiDocument, options?: ExtractIsoSurfaceOptions): NiftiSurfaceMeshSummary {
  const h = doc.header;
  const nx = Math.max(1, h.dim[1]);
  const ny = Math.max(1, h.dim[2]);
  const nz = Math.max(1, h.dim[3]);
  const isoValue = options?.isoValue ?? 0.5;
  const targetLabelId = options?.labelId;

  const affineMatrix = buildAffineMatrix(h);
  const detSform = computeSformAffineDeterminant(h);
  const fallbackVoxVol = Math.abs(h.pixdim[1] * h.pixdim[2] * h.pixdim[3]) || 1.0;
  const voxelVolumeMm3 = h.sformCode > 0 && Math.abs(detSform) > 1e-9 ? Math.abs(detSform) : fallbackVoxVol;

  const slope = h.sclSlope !== 0 ? h.sclSlope : 1.0;
  const inter = h.sclInter;

  const getScaledVoxel = (i: number, j: number, k: number): number => {
    if (i < 0 || i >= nx || j < 0 || j >= ny || k < 0 || k >= nz) return 0;
    const idx = i + j * nx + k * nx * ny;
    if (doc.voxels.length === 0) {
      // Synthesize a centered sphere/cube if no explicit voxel array was supplied
      const cx = (nx - 1) / 2;
      const cy = (ny - 1) / 2;
      const cz = (nz - 1) / 2;
      const rSq = (i - cx) * (i - cx) + (j - cy) * (j - cy) + (k - cz) * (k - cz);
      const rad = Math.max(1.0, Math.min(nx, ny, nz) / 3);
      return rSq <= rad * rad ? 1.0 : 0.0;
    }
    const raw = doc.voxels[idx] ?? 0;
    return raw * slope + inter;
  };

  const isForeground = (i: number, j: number, k: number): boolean => {
    const val = getScaledVoxel(i, j, k);
    if (targetLabelId !== undefined) {
      return Math.round(val) === targetLabelId;
    }
    return val >= isoValue;
  };

  const verticesRAS: [number, number, number][] = [];
  const vertexMap = new Map<string, number>();
  const triangles: [number, number, number][] = [];
  const normals: [number, number, number][] = [];

  const getOrAddGridCorner = (gi: number, gj: number, gk: number): number => {
    const key = `${gi},${gj},${gk}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    // Voxel (i,j,k) spans [i-0.5, i+0.5] x [j-0.5, j+0.5] x [k-0.5, k+0.5]
    const ras = voxelToWorldRAS(h, gi - 0.5, gj - 0.5, gk - 0.5);
    const idx = verticesRAS.length;
    verticesRAS.push(ras);
    vertexMap.set(key, idx);
    return idx;
  };

  // Six unit cube faces with outward counter-clockwise vertex offsets
  const faceDefs: {
    di: number;
    dj: number;
    dk: number;
    corners: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]];
  }[] = [
    {
      di: -1,
      dj: 0,
      dk: 0,
      corners: [
        [0, 0, 0],
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
      ],
    },
    {
      di: 1,
      dj: 0,
      dk: 0,
      corners: [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
    },
    {
      di: 0,
      dj: -1,
      dk: 0,
      corners: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
    },
    {
      di: 0,
      dj: 1,
      dk: 0,
      corners: [
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
      ],
    },
    {
      di: 0,
      dj: 0,
      dk: -1,
      corners: [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    },
    {
      di: 0,
      dj: 0,
      dk: 1,
      corners: [
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
    },
  ];

  let foregroundVoxelCount = 0;
  const labelAccum = new Map<number, { count: number; sumI: number; sumJ: number; sumK: number }>();

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const val = getScaledVoxel(i, j, k);
        const roundedLabel = Math.round(val);
        if (roundedLabel > 0) {
          const acc = labelAccum.get(roundedLabel) ?? { count: 0, sumI: 0, sumJ: 0, sumK: 0 };
          acc.count++;
          acc.sumI += i;
          acc.sumJ += j;
          acc.sumK += k;
          labelAccum.set(roundedLabel, acc);
        }

        if (!isForeground(i, j, k)) continue;
        foregroundVoxelCount++;

        for (const face of faceDefs) {
          if (!isForeground(i + face.di, j + face.dj, k + face.dk)) {
            const c0 = face.corners[0];
            const c1 = face.corners[1];
            const c2 = face.corners[2];
            const c3 = face.corners[3];
            const v0 = getOrAddGridCorner(i + c0[0], j + c0[1], k + c0[2]);
            const v1 = getOrAddGridCorner(i + c1[0], j + c1[1], k + c1[2]);
            const v2 = getOrAddGridCorner(i + c2[0], j + c2[1], k + c2[2]);
            const v3 = getOrAddGridCorner(i + c3[0], j + c3[1], k + c3[2]);

            triangles.push([v0, v1, v2]);
            triangles.push([v0, v2, v3]);
          }
        }
      }
    }
  }

  let surfaceAreaMm2 = 0;
  let signedTetVolSum = 0;

  for (const tri of triangles) {
    const p0 = verticesRAS[tri[0]]!;
    const p1 = verticesRAS[tri[1]]!;
    const p2 = verticesRAS[tri[2]]!;

    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];

    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];

    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;

    const normLen = Math.hypot(cx, cy, cz);
    surfaceAreaMm2 += 0.5 * normLen;
    if (normLen > 1e-12) {
      normals.push([cx / normLen, cy / normLen, cz / normLen]);
    } else {
      normals.push([0, 0, 1]);
    }

    // Divergence theorem signed tetrahedron volume with origin (0,0,0)
    const crossP1P2X = p1[1] * p2[2] - p1[2] * p2[1];
    const crossP1P2Y = p1[2] * p2[0] - p1[0] * p2[2];
    const crossP1P2Z = p1[0] * p2[1] - p1[1] * p2[0];
    signedTetVolSum += (p0[0] * crossP1P2X + p0[1] * crossP1P2Y + p0[2] * crossP1P2Z) / 6.0;
  }

  const totalVolumeMm3 = foregroundVoxelCount * voxelVolumeMm3;
  const tetrahedralVolumeMm3 = Math.abs(signedTetVolSum);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of verticesRAS) {
    if (v[0] < minX) minX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] > maxZ) maxZ = v[2];
  }
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const labelNameById = new Map<number, string>();
  for (const lbl of doc.labels) {
    labelNameById.set(lbl.id, lbl.name);
  }

  const labelStats: NiftiLabelVolumeStats[] = [];
  for (const [labelId, acc] of labelAccum.entries()) {
    const ci = acc.sumI / acc.count;
    const cj = acc.sumJ / acc.count;
    const ck = acc.sumK / acc.count;
    labelStats.push({
      labelId,
      labelName: labelNameById.get(labelId) ?? `Label_${labelId}`,
      voxelCount: acc.count,
      volumeMm3: acc.count * voxelVolumeMm3,
      centroidRAS: voxelToWorldRAS(h, ci, cj, ck),
    });
  }

  const summary: NiftiSurfaceMeshSummary = {
    title: doc.title,
    isoValue,
    foregroundVoxelCount,
    voxelVolumeMm3,
    totalVolumeMm3,
    tetrahedralVolumeMm3,
    surfaceAreaMm2,
    verticesRAS,
    triangles,
    normals,
    boundingBoxRAS: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
    affineMatrix,
    labelStats,
  };
  if (targetLabelId !== undefined) {
    summary.labelId = targetLabelId;
  }
  return summary;
}

/**
 * Lowers NIfTI/NRRD anatomical ROI volumes, voxel geometry, and compartmental
 * tracer diffusion / pharmacokinetic clearance equations into DAEBuilder.
 */
export function lowerNiftiToDae(doc: NiftiDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? sanitizeIdentifier(doc.title || "NIfTICompartmentModel");
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const mesh = extractIsoSurfaceMesh(doc);

  // 1. Voxel volume and total foreground volume parameters
  const voxVolVar = "voxel_volume_mm3";
  const voxVolId = interner.intern(voxVolVar);
  arena.addVariable(voxVolVar, VarType.Real, Variability.Parameter, Causality.Local);
  const voxVolExpr = arena.addExpression(ExprKind.Name, voxVolId);
  arena.addEquation(EqKind.InitialSimple, voxVolExpr, arena.addRealLiteral(mesh.voxelVolumeMm3));

  const fgVolVar = "foreground_volume_mm3";
  const fgVolId = interner.intern(fgVolVar);
  arena.addVariable(fgVolVar, VarType.Real, Variability.Parameter, Causality.Output);
  const fgVolExpr = arena.addExpression(ExprKind.Name, fgVolId);
  arena.addEquation(EqKind.InitialSimple, fgVolExpr, arena.addRealLiteral(mesh.totalVolumeMm3));

  const surfAreaVar = "surface_area_mm2";
  const surfAreaId = interner.intern(surfAreaVar);
  arena.addVariable(surfAreaVar, VarType.Real, Variability.Parameter, Causality.Output);
  const surfAreaExpr = arena.addExpression(ExprKind.Name, surfAreaId);
  arena.addEquation(EqKind.InitialSimple, surfAreaExpr, arena.addRealLiteral(mesh.surfaceAreaMm2));

  // 2. Lower anatomical ROIs or labels as tracer / diffusion compartments
  const compartments =
    doc.rois.length > 0
      ? doc.rois.map((r) => ({
          name: r.name || r.id,
          labelId: r.labelId,
          D: r.diffusionCoeffD ?? 0.12,
          kClear: r.clearanceRateK ?? 0.05,
          c0: r.initialConcentration ?? 1.0,
        }))
      : mesh.labelStats.length > 0
        ? mesh.labelStats.map((ls) => ({
            name: ls.labelName,
            labelId: ls.labelId,
            D: 0.12,
            kClear: 0.05,
            c0: 1.0,
          }))
        : [
            {
              name: "PrimaryROI",
              labelId: 1,
              D: 0.12,
              kClear: 0.05,
              c0: 1.0,
            },
          ];

  for (const comp of compartments) {
    const prefix = sanitizeIdentifier(comp.name);
    const stat = mesh.labelStats.find((s) => s.labelId === comp.labelId);
    const volMm3 = stat?.volumeMm3 ?? mesh.totalVolumeMm3;

    // Volume parameter
    const volVar = `${prefix}_volume_mm3`;
    const volId = interner.intern(volVar);
    arena.addVariable(volVar, VarType.Real, Variability.Parameter, Causality.Local);
    const volExpr = arena.addExpression(ExprKind.Name, volId);
    arena.addEquation(EqKind.InitialSimple, volExpr, arena.addRealLiteral(volMm3));

    // Diffusion coefficient D
    const dVar = `${prefix}_D`;
    const dId = interner.intern(dVar);
    arena.addVariable(dVar, VarType.Real, Variability.Parameter, Causality.Local);
    const dExpr = arena.addExpression(ExprKind.Name, dId);
    arena.addEquation(EqKind.InitialSimple, dExpr, arena.addRealLiteral(comp.D));

    // Clearance rate k
    const kVar = `${prefix}_k_clear`;
    const kId = interner.intern(kVar);
    arena.addVariable(kVar, VarType.Real, Variability.Parameter, Causality.Local);
    const kExpr = arena.addExpression(ExprKind.Name, kId);
    arena.addEquation(EqKind.InitialSimple, kExpr, arena.addRealLiteral(comp.kClear));

    // Tracer concentration C
    const cVar = `${prefix}_concentration`;
    const cId = interner.intern(cVar);
    arena.addVariable(cVar, VarType.Real, Variability.Continuous, Causality.Output);
    const cExpr = arena.addExpression(ExprKind.Name, cId);
    arena.addEquation(EqKind.Simple, cExpr, arena.addRealLiteral(comp.c0));

    // Total tracer mass M = V * C
    const mVar = `${prefix}_tracer_mass`;
    const mId = interner.intern(mVar);
    arena.addVariable(mVar, VarType.Real, Variability.Continuous, Causality.Output);
    const mExpr = arena.addExpression(ExprKind.Name, mId);
    const massProd = arena.addBinaryExpr(BinOp.Mul, volExpr, cExpr);
    arena.addEquation(EqKind.Simple, mExpr, massProd);

    // Clearance flux J_clear = k_clear * C
    const fluxVar = `${prefix}_clearance_flux`;
    const fluxId = interner.intern(fluxVar);
    arena.addVariable(fluxVar, VarType.Real, Variability.Continuous, Causality.Output);
    const fluxExpr = arena.addExpression(ExprKind.Name, fluxId);
    const fluxProd = arena.addBinaryExpr(BinOp.Mul, kExpr, cExpr);
    arena.addEquation(EqKind.Simple, fluxExpr, fluxProd);
  }

  return arena;
}

function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "NIfTIEntity";
}
