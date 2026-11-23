// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Triclinic-to-Cubic Crystallography Geometry Engine:
 * - Direct & reciprocal metric tensors (G, G*)
 * - Unit-cell volume V = sqrt(det(G))
 * - Fractional <-> Cartesian orthogonalization matrices (M, M^-1)
 * - Affine `_symmetry_equiv_pos_as_xyz` parser & Wyckoff site expansion
 * - Periodic-boundary minimum-image bond & nearest-neighbor distance calculator
 * - Theoretical crystallographic density (g/cm³)
 */

import type {
  CrystalBond,
  CrystalStructure,
  CrystalSystem,
  ExpandedAtom,
  Mat3,
  MetricTensorResult,
  UnitCellParams,
  Vec3,
} from "../types.js";
import { lookupElement } from "./elements.js";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const AVOGADRO = 6.02214076e23;

export interface AffineSymOp {
  raw: string;
  R: Mat3;
  t: Vec3;
}

function mat3Det(A: Mat3): number {
  const [a, b, c] = A[0];
  const [d, e, f] = A[1];
  const [g, h, i] = A[2];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function mat3Inv(A: Mat3): Mat3 {
  const [a, b, c] = A[0];
  const [d, e, f] = A[1];
  const [g, h, i] = A[2];
  const det = mat3Det(A);
  if (Math.abs(det) < 1e-15) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

export function mat3MulVec(A: Mat3, v: Vec3): Vec3 {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
}

export function classifyCrystalSystem(cell: UnitCellParams): CrystalSystem {
  const eq = (x: number, y: number, tol = 1e-3) => Math.abs(x - y) <= tol;
  const is90 = (ang: number) => Math.abs(ang - 90) <= 0.05;
  const is120 = (ang: number) => Math.abs(ang - 120) <= 0.05;

  if (is90(cell.alpha) && is90(cell.beta) && is90(cell.gamma)) {
    if (eq(cell.a, cell.b) && eq(cell.b, cell.c)) return "cubic";
    if (eq(cell.a, cell.b) || eq(cell.b, cell.c) || eq(cell.a, cell.c)) return "tetragonal";
    return "orthorhombic";
  }
  if (is90(cell.alpha) && is90(cell.beta) && is120(cell.gamma) && eq(cell.a, cell.b)) {
    return "hexagonal";
  }
  if (eq(cell.a, cell.b) && eq(cell.b, cell.c) && eq(cell.alpha, cell.beta, 0.05) && eq(cell.beta, cell.gamma, 0.05)) {
    return "trigonal";
  }
  if (
    (is90(cell.alpha) && is90(cell.gamma)) ||
    (is90(cell.alpha) && is90(cell.beta)) ||
    (is90(cell.beta) && is90(cell.gamma))
  ) {
    return "monoclinic";
  }
  return "triclinic";
}

/**
 * Computes direct metric tensor G, det(G), unit-cell volume V = sqrt(det(G)),
 * reciprocal metric tensor G* = G^-1, and fractional <-> Cartesian orthogonalization matrices.
 */
export function computeMetricTensor(cell: UnitCellParams): MetricTensorResult {
  const { a, b, c, alpha, beta, gamma } = cell;
  const cosA = Math.cos(alpha * DEG2RAD);
  const cosB = Math.cos(beta * DEG2RAD);
  const cosG = Math.cos(gamma * DEG2RAD);
  const sinG = Math.sin(gamma * DEG2RAD);

  const G: Mat3 = [
    [a * a, a * b * cosG, a * c * cosB],
    [a * b * cosG, b * b, b * c * cosA],
    [a * c * cosB, b * c * cosA, c * c],
  ];

  const detG = mat3Det(G);
  const volume = detG > 0 ? Math.sqrt(detG) : 0;
  const GStar = mat3Inv(G);

  const m22 = Math.abs(sinG) > 1e-12 ? (c * (cosA - cosB * cosG)) / sinG : 0;
  const m23 = Math.abs(a * b * sinG) > 1e-12 ? volume / (a * b * sinG) : 0;

  const M: Mat3 = [
    [a, b * cosG, c * cosB],
    [0, b * sinG, m22],
    [0, 0, m23],
  ];
  const MInv = mat3Inv(M);

  const aStar = Math.sqrt(Math.max(0, GStar[0][0]));
  const bStar = Math.sqrt(Math.max(0, GStar[1][1]));
  const cStar = Math.sqrt(Math.max(0, GStar[2][2]));
  const clampCos = (v: number) => Math.max(-1, Math.min(1, v));
  const alphaStar = bStar * cStar > 1e-12 ? Math.acos(clampCos(GStar[1][2] / (bStar * cStar))) * RAD2DEG : 90;
  const betaStar = aStar * cStar > 1e-12 ? Math.acos(clampCos(GStar[0][2] / (aStar * cStar))) * RAD2DEG : 90;
  const gammaStar = aStar * bStar > 1e-12 ? Math.acos(clampCos(GStar[0][1] / (aStar * bStar))) * RAD2DEG : 90;

  return {
    G,
    detG,
    volume,
    GStar,
    M,
    MInv,
    reciprocalCell: {
      a: aStar,
      b: bStar,
      c: cStar,
      alpha: alphaStar,
      beta: betaStar,
      gamma: gammaStar,
    },
    crystalSystem: classifyCrystalSystem(cell),
  };
}

export function fractionalToCartesian(cellOrMetric: UnitCellParams | MetricTensorResult, fract: Vec3): Vec3 {
  const M = "M" in cellOrMetric ? cellOrMetric.M : computeMetricTensor(cellOrMetric).M;
  return mat3MulVec(M, fract);
}

export function cartesianToFractional(cellOrMetric: UnitCellParams | MetricTensorResult, cart: Vec3): Vec3 {
  const MInv = "MInv" in cellOrMetric ? cellOrMetric.MInv : computeMetricTensor(cellOrMetric).MInv;
  return mat3MulVec(MInv, cart);
}

/**
 * Parses a single coordinate expression (e.g. `"-x+1/2"`, `"1/4-y"`, `"y-x+2/3"`) into `[rx, ry, rz, t]`.
 */
function parseSymComponent(comp: string): [number, number, number, number] | null {
  const s = comp.replace(/\s+/g, "").toLowerCase();
  if (!s) return null;

  let rx = 0;
  let ry = 0;
  let rz = 0;
  let t = 0;

  // Tokenize signed terms
  const termRegex = /([+-]?)([^+-]+)/g;
  let matchedLen = 0;
  let match: RegExpExecArray | null;
  while ((match = termRegex.exec(s)) !== null) {
    matchedLen += match[0].length;
    const sign = match[1] === "-" ? -1 : 1;
    const body = match[2]!;

    if (body === "x") {
      rx += sign;
    } else if (body === "y") {
      ry += sign;
    } else if (body === "z") {
      rz += sign;
    } else if (/^\d+\*?[xyz]$/.test(body)) {
      const coeff = Number.parseInt(body.slice(0, -1).replace("*", ""), 10);
      const axis = body[body.length - 1]!;
      if (axis === "x") rx += sign * coeff;
      else if (axis === "y") ry += sign * coeff;
      else rz += sign * coeff;
    } else if (body.includes("/")) {
      const parts = body.split("/");
      if (parts.length !== 2) return null;
      const num = Number(parts[0]);
      const den = Number(parts[1]);
      if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
      t += sign * (num / den);
    } else {
      const val = Number(body);
      if (!Number.isFinite(val)) return null;
      t += sign * val;
    }
  }

  if (matchedLen !== s.length) return null;
  return [rx, ry, rz, t];
}

/**
 * Parses a CIF `_symmetry_equiv_pos_as_xyz` string (e.g. `"-x+1/2, y+1/2, -z"`) into an affine matrix + translation.
 */
export function parseSymmetryOp(expr: string): AffineSymOp | null {
  const parts = expr.split(",");
  if (parts.length !== 3) return null;
  const r0 = parseSymComponent(parts[0]!);
  const r1 = parseSymComponent(parts[1]!);
  const r2 = parseSymComponent(parts[2]!);
  if (!r0 || !r1 || !r2) return null;

  return {
    raw: expr.trim(),
    R: [
      [r0[0], r0[1], r0[2]],
      [r1[0], r1[1], r1[2]],
      [r2[0], r2[1], r2[2]],
    ],
    t: [r0[3], r1[3], r2[3]],
  };
}

function wrapUnit(v: number): number {
  let w = v - Math.floor(v);
  if (w >= 1 - 1e-9 || w < 1e-9) w = 0;
  return w;
}

export function applySymmetryOp(op: AffineSymOp, fract: Vec3): Vec3 {
  const rv = mat3MulVec(op.R, fract);
  return [wrapUnit(rv[0] + op.t[0]), wrapUnit(rv[1] + op.t[1]), wrapUnit(rv[2] + op.t[2])];
}

/**
 * Built-in symmetry operation generators for common canonical space groups
 * when a CIF omits explicit `_symmetry_equiv_pos_as_xyz` loop rows.
 */
function defaultSymOpsForSpaceGroup(sgName?: string, sgNumber?: number): string[] {
  const norm = (sgName ?? "").replace(/\s+/g, "").toLowerCase();

  // Fm-3m (225) — FCC lattice + Oh point group (rock salt / FCC Cu)
  if (sgNumber === 225 || norm === "fm-3m" || norm === "fm3m") {
    const fccTranslations: Vec3[] = [
      [0, 0, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [0.5, 0.5, 0],
    ];
    const perms: Array<[string, string, string]> = [
      ["x", "y", "z"],
      ["y", "z", "x"],
      ["z", "x", "y"],
      ["y", "x", "z"],
      ["x", "z", "y"],
      ["z", "y", "x"],
    ];
    const signs = [1, -1];
    const ops: string[] = [];
    for (const [tx, ty, tz] of fccTranslations) {
      for (const [p0, p1, p2] of perms) {
        for (const s0 of signs) {
          for (const s1 of signs) {
            for (const s2 of signs) {
              const fmt = (s: number, v: string, tr: number) => `${s < 0 ? "-" : ""}${v}${tr !== 0 ? `+${tr}` : ""}`;
              ops.push(`${fmt(s0, p0, tx)}, ${fmt(s1, p1, ty)}, ${fmt(s2, p2, tz)}`);
            }
          }
        }
      }
    }
    return ops;
  }

  // Fd-3m (227, origin choice 1: diamond cubic Si at 0,0,0 -> 8 atoms in cell)
  if (sgNumber === 227 || norm === "fd-3m" || norm === "fd3m") {
    return [
      "x, y, z",
      "x+1/2, y+1/2, z",
      "x+1/2, y, z+1/2",
      "x, y+1/2, z+1/2",
      "x+1/4, y+1/4, z+1/4",
      "x+3/4, y+3/4, z+1/4",
      "x+3/4, y+1/4, z+3/4",
      "x+1/4, y+3/4, z+3/4",
    ];
  }

  // P3_1 2 1 (152) — alpha-Quartz (origin on 2-fold along [100])
  if (sgNumber === 152 || norm === "p3121" || norm === "p3_121") {
    return ["x, y, z", "-y, x-y, z+1/3", "-x+y, -x, z+2/3", "x-y, -y, -z", "-x, -x+y, -z+2/3", "y, x, -z+1/3"];
  }

  return ["x, y, z"];
}

/**
 * Computes periodic minimum-image distance (Å) between two fractional coordinates using metric tensor G.
 */
export function periodicDistance(G: Mat3, uA: Vec3, uB: Vec3): { distance: number; imageShift: Vec3 } {
  let bestD2 = Number.POSITIVE_INFINITY;
  let bestShift: Vec3 = [0, 0, 0];

  for (let dx = -1; dx <= 1; dx++) {
    const du0 = uB[0] + dx - uA[0];
    for (let dy = -1; dy <= 1; dy++) {
      const du1 = uB[1] + dy - uA[1];
      for (let dz = -1; dz <= 1; dz++) {
        const du2 = uB[2] + dz - uA[2];
        const d2 =
          G[0][0] * du0 * du0 +
          G[1][1] * du1 * du1 +
          G[2][2] * du2 * du2 +
          2 * (G[0][1] * du0 * du1 + G[0][2] * du0 * du2 + G[1][2] * du1 * du2);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestShift = [dx, dy, dz];
        }
      }
    }
  }

  return { distance: Math.sqrt(Math.max(0, bestD2)), imageShift: bestShift };
}

/**
 * Expands asymmetric-unit atom sites via `_symmetry_equiv_pos_as_xyz` (or space-group fallback),
 * deduplicating equivalent positions modulo 1 under the metric tensor.
 */
export function expandSymmetrySites(
  structure: CrystalStructure,
  metric?: MetricTensorResult,
  dedupTolAngstrom = 0.05,
): ExpandedAtom[] {
  const m = metric ?? computeMetricTensor(structure.cell);
  const opStrings =
    structure.symmetryOps.length > 0
      ? structure.symmetryOps
      : defaultSymOpsForSpaceGroup(structure.spaceGroupName, structure.spaceGroupNumber);

  const parsedOps: AffineSymOp[] = [];
  for (const s of opStrings) {
    const op = parseSymmetryOp(s);
    if (op) parsedOps.push(op);
  }
  if (parsedOps.length === 0) {
    parsedOps.push({
      raw: "x, y, z",
      R: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      t: [0, 0, 0],
    });
  }

  const expanded: ExpandedAtom[] = [];

  for (let asymIdx = 0; asymIdx < structure.asymmetricAtoms.length; asymIdx++) {
    const atom = structure.asymmetricAtoms[asymIdx]!;
    const baseFract: Vec3 = [atom.fractX, atom.fractY, atom.fractZ];

    for (let opIdx = 0; opIdx < parsedOps.length; opIdx++) {
      const f = applySymmetryOp(parsedOps[opIdx]!, baseFract);

      // Deduplicate against already-expanded positions from the SAME asymmetric site
      let isDuplicate = false;
      for (const existing of expanded) {
        if (existing.asymmetricIndex !== asymIdx) continue;
        const { distance } = periodicDistance(m.G, existing.fract, f);
        if (distance < dedupTolAngstrom) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;

      const cart = fractionalToCartesian(m, f);
      expanded.push({
        index: expanded.length,
        label: atom.label,
        symbol: atom.symbol,
        fract: f,
        cart,
        occupancy: atom.occupancy,
        bIso: atom.bIso ?? 0.5,
        symOpIndex: opIdx,
        asymmetricIndex: asymIdx,
      });
    }
  }

  return expanded;
}

/**
 * Finds covalent / coordination bonds across periodic boundary conditions using covalent radii.
 */
export function findPeriodicBonds(
  metric: MetricTensorResult,
  atoms: ExpandedAtom[],
  scaleFactor = 1.25,
  minDist = 0.4,
): CrystalBond[] {
  const bonds: CrystalBond[] = [];
  const n = atoms.length;

  for (let i = 0; i < n; i++) {
    const a = atoms[i]!;
    const rA = lookupElement(a.symbol)?.covalentRadius ?? 1.2;

    for (let j = i + 1; j < n; j++) {
      const b = atoms[j]!;
      const rB = lookupElement(b.symbol)?.covalentRadius ?? 1.2;
      const maxBond = (rA + rB) * scaleFactor;

      // Check all 27 periodic images so multi-image coordination (e.g. Si tetrahedral) is captured
      for (let dx = -1; dx <= 1; dx++) {
        const du0 = b.fract[0] + dx - a.fract[0];
        for (let dy = -1; dy <= 1; dy++) {
          const du1 = b.fract[1] + dy - a.fract[1];
          for (let dz = -1; dz <= 1; dz++) {
            const du2 = b.fract[2] + dz - a.fract[2];
            const d2 =
              metric.G[0][0] * du0 * du0 +
              metric.G[1][1] * du1 * du1 +
              metric.G[2][2] * du2 * du2 +
              2 * (metric.G[0][1] * du0 * du1 + metric.G[0][2] * du0 * du2 + metric.G[1][2] * du1 * du2);
            const dist = Math.sqrt(Math.max(0, d2));
            if (dist >= minDist && dist <= maxBond) {
              bonds.push({
                atomA: i,
                atomB: j,
                labelA: a.label,
                labelB: b.label,
                symbolA: a.symbol,
                symbolB: b.symbol,
                distance: dist,
                imageShift: [dx, dy, dz],
              });
            }
          }
        }
      }
    }
  }

  bonds.sort((x, y) => x.distance - y.distance);
  return bonds;
}

/**
 * Computes the shortest interatomic distance (nearest-neighbor bond length, Å) under periodic boundaries.
 */
export function findNearestNeighborDistance(metric: MetricTensorResult, atoms: ExpandedAtom[]): number {
  let minD = Number.POSITIVE_INFINITY;
  const n = atoms.length;

  for (let i = 0; i < n; i++) {
    const a = atoms[i]!;
    // Also check periodic images of atom i with itself (for 1-atom primitive cells)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const d2 =
            metric.G[0][0] * dx * dx +
            metric.G[1][1] * dy * dy +
            metric.G[2][2] * dz * dz +
            2 * (metric.G[0][1] * dx * dy + metric.G[0][2] * dx * dz + metric.G[1][2] * dy * dz);
          const d = Math.sqrt(Math.max(0, d2));
          if (d > 1e-6 && d < minD) minD = d;
        }
      }
    }

    for (let j = i + 1; j < n; j++) {
      const { distance } = periodicDistance(metric.G, a.fract, atoms[j]!.fract);
      if (distance > 1e-6 && distance < minD) minD = distance;
    }
  }

  return Number.isFinite(minD) ? minD : 0;
}

/**
 * Computes theoretical crystallographic density ρ (g/cm³) from expanded unit-cell atoms and volume (Å³).
 */
export function computeTheoreticalDensity(
  atoms: ExpandedAtom[],
  volumeAngstrom3: number,
): { densityGCm3: number; unitCellMassGPerMol: number } {
  let totalMass = 0;
  for (const atom of atoms) {
    const mass = lookupElement(atom.symbol)?.mass ?? 12.011;
    totalMass += atom.occupancy * mass;
  }
  if (volumeAngstrom3 <= 0) {
    return { densityGCm3: 0, unitCellMassGPerMol: totalMass };
  }
  // 1 Å³ = 1e-24 cm³
  const densityGCm3 = totalMass / (AVOGADRO * volumeAngstrom3 * 1e-24);
  return { densityGCm3, unitCellMassGPerMol: totalMass };
}
