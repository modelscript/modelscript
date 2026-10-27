// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Procedural two-spool high-bypass turbofan used by the landing-page hero.
// The engine axis is world +X (intake at -X, exhaust at +X). All bodies of
// revolution are described as closed (x, r) profiles so the same data drives
// the solid lathe mesh, the CAD-style feature-line wireframe and the
// analytic section cap.

import * as THREE from "three";

/** Closed polygon in the meridional plane: [axial x, radius r]. */
export type Profile = readonly (readonly [number, number])[];

export type Spool = "n1" | "n2" | null;

export type BodyMaterial = "nacelle" | "spinner" | "cowl" | "drum" | "liner";
export type BladeMaterial = "fanBlade" | "compressorBlade" | "turbineBlade";

export interface BodySpec {
  key: string;
  profile: Profile;
  material: BodyMaterial;
  spool: Spool;
  segments: number;
  meridians: number;
}

export interface RowSpec {
  key: string;
  x: number;
  count: number;
  spool: Spool;
  material: BladeMaterial;
  chordHub: number;
  chordTip: number;
  staggerHub: number;
  staggerTip: number;
  camber: number;
  thickness: number;
  /** Override hub / tip radii (otherwise read from flow-path walls). */
  hub?: number;
  tip?: number;
  /** Spanwise / chordwise resolution. */
  nS: number;
  nC: number;
  /** Draw the outline of every n-th blade in the wireframe. */
  wireStride: number;
}

const DEG = Math.PI / 180;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth01(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ── Bodies of revolution ────────────────────────────────────────────────

const NACELLE: Profile = [
  [-2.96, 1.45],
  [-2.92, 1.52],
  [-2.8, 1.575],
  [-2.5, 1.605],
  [-1.6, 1.61],
  [-0.6, 1.57],
  [0.1, 1.5],
  [0.55, 1.41],
  [0.55, 1.385],
  [0.2, 1.375],
  [-0.8, 1.385],
  [-2.3, 1.39],
  [-2.75, 1.38],
  [-2.9, 1.405],
];

const SPINNER: Profile = [
  [-2.62, 0.0],
  [-2.56, 0.12],
  [-2.44, 0.23],
  [-2.26, 0.32],
  [-2.06, 0.385],
  [-1.86, 0.415],
  [-1.6, 0.425],
  [-1.6, 0.0],
];

/** Core cowl: outer bypass surface + inner core flow-path wall. */
const CORE_COWL: Profile = [
  [-1.4, 0.615],
  [-1.25, 0.69],
  [-0.9, 0.765],
  [-0.3, 0.83],
  [0.6, 0.86],
  [1.5, 0.83],
  [2.1, 0.76],
  [2.6, 0.69],
  [2.6, 0.675],
  [2.15, 0.665],
  [1.5, 0.57],
  [1.4, 0.555],
  [1.1, 0.56],
  [1.06, 0.6],
  [0.42, 0.6],
  [0.36, 0.475],
  [-0.55, 0.565],
  [-0.72, 0.6],
  [-1.28, 0.605],
];

/** Rotor drum, inner flow-path wall and tail cone, closed down to the axis. */
const DRUM: Profile = [
  [-1.6, 0.0],
  [-1.6, 0.415],
  [-1.3, 0.405],
  [-0.75, 0.4],
  [-0.55, 0.325],
  [0.36, 0.4],
  [0.44, 0.38],
  [1.06, 0.38],
  [1.12, 0.4],
  [1.4, 0.4],
  [1.5, 0.38],
  [2.15, 0.375],
  [2.6, 0.31],
  [3.0, 0.16],
  [3.18, 0.05],
  [3.2, 0.0],
];

/** Annular combustor liner between HPC exit and HP turbine nozzle. */
const COMBUSTOR: Profile = [
  [0.46, 0.47],
  [0.54, 0.43],
  [0.94, 0.415],
  [1.04, 0.45],
  [1.04, 0.54],
  [0.94, 0.575],
  [0.54, 0.575],
  [0.46, 0.53],
];

export const BODIES: readonly BodySpec[] = [
  { key: "nacelle", profile: NACELLE, material: "nacelle", spool: null, segments: 160, meridians: 28 },
  { key: "spinner", profile: SPINNER, material: "spinner", spool: "n1", segments: 96, meridians: 12 },
  { key: "cowl", profile: CORE_COWL, material: "cowl", spool: null, segments: 128, meridians: 24 },
  { key: "drum", profile: DRUM, material: "drum", spool: null, segments: 96, meridians: 16 },
  { key: "combustor", profile: COMBUSTOR, material: "liner", spool: null, segments: 96, meridians: 16 },
];

// ── Flow-path walls used to size blade rows ─────────────────────────────

const HUB_LINE: Profile = DRUM.slice(1, 12);
const CORE_TIP_LINE: Profile = CORE_COWL.slice(9).reverse();

function interp(line: Profile, x: number): number {
  const first = line[0]!;
  const last = line[line.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, r0] = line[i]!;
    const [x1, r1] = line[i + 1]!;
    if (x >= x0 && x <= x1) return x1 === x0 ? r1 : r0 + ((x - x0) / (x1 - x0)) * (r1 - r0);
  }
  return last[1];
}

// ── Blade rows ──────────────────────────────────────────────────────────

function stageRows(
  prefix: string,
  stages: number,
  x0: number,
  x1: number,
  rotor: Omit<RowSpec, "key" | "x" | "spool"> & { spool: Spool },
  stator: Omit<RowSpec, "key" | "x" | "spool">,
  statorFirst = false,
): RowSpec[] {
  const rows: RowSpec[] = [];
  const pitch = stages > 1 ? (x1 - x0) / (stages - 1) : 0;
  const gap = pitch > 0 ? pitch * 0.48 : 0.06;
  for (let i = 0; i < stages; i++) {
    const xr = x0 + i * pitch;
    const xs = statorFirst ? xr - gap : xr + gap;
    rows.push({ ...rotor, key: `${prefix}-r${i + 1}`, x: xr });
    rows.push({ ...stator, key: `${prefix}-s${i + 1}`, x: xs, spool: null });
  }
  return rows;
}

const SMALL = { nS: 3, nC: 6, wireStride: 3 } as const;

export const ROWS: readonly RowSpec[] = [
  {
    key: "fan",
    x: -1.92,
    count: 22,
    spool: "n1",
    material: "fanBlade",
    chordHub: 0.36,
    chordTip: 0.5,
    staggerHub: 18 * DEG,
    staggerTip: 64 * DEG,
    camber: 0.07,
    thickness: 0.09,
    hub: 0.4,
    tip: 1.365,
    nS: 14,
    nC: 14,
    wireStride: 1,
  },
  {
    key: "ogv",
    x: -0.95,
    count: 32,
    spool: null,
    material: "compressorBlade",
    chordHub: 0.2,
    chordTip: 0.22,
    staggerHub: -8 * DEG,
    staggerTip: -6 * DEG,
    camber: 0.05,
    thickness: 0.07,
    hub: 0.76,
    tip: 1.39,
    nS: 6,
    nC: 6,
    wireStride: 2,
  },
  // Low-pressure (booster) compressor: 2 stages on the N1 spool.
  ...stageRows(
    "lpc",
    2,
    -1.18,
    -0.9,
    {
      count: 40,
      spool: "n1",
      material: "compressorBlade",
      chordHub: 0.11,
      chordTip: 0.09,
      staggerHub: 38 * DEG,
      staggerTip: 52 * DEG,
      camber: 0.06,
      thickness: 0.08,
      ...SMALL,
    },
    {
      count: 48,
      material: "compressorBlade",
      chordHub: 0.09,
      chordTip: 0.08,
      staggerHub: -28 * DEG,
      staggerTip: -32 * DEG,
      camber: 0.05,
      thickness: 0.08,
      ...SMALL,
    },
  ),
  // High-pressure compressor: 7 stages on the N2 spool.
  ...stageRows(
    "hpc",
    7,
    -0.48,
    0.26,
    {
      count: 44,
      spool: "n2",
      material: "compressorBlade",
      chordHub: 0.06,
      chordTip: 0.05,
      staggerHub: 40 * DEG,
      staggerTip: 54 * DEG,
      camber: 0.05,
      thickness: 0.08,
      ...SMALL,
    },
    {
      count: 56,
      material: "compressorBlade",
      chordHub: 0.05,
      chordTip: 0.045,
      staggerHub: -30 * DEG,
      staggerTip: -34 * DEG,
      camber: 0.05,
      thickness: 0.08,
      ...SMALL,
    },
  ),
  // High-pressure turbine: 2 stages on the N2 spool (nozzle precedes rotor).
  ...stageRows(
    "hpt",
    2,
    1.2,
    1.36,
    {
      count: 48,
      spool: "n2",
      material: "turbineBlade",
      chordHub: 0.055,
      chordTip: 0.05,
      staggerHub: -50 * DEG,
      staggerTip: -58 * DEG,
      camber: 0.09,
      thickness: 0.14,
      ...SMALL,
    },
    {
      count: 36,
      material: "turbineBlade",
      chordHub: 0.06,
      chordTip: 0.06,
      staggerHub: 48 * DEG,
      staggerTip: 50 * DEG,
      camber: 0.09,
      thickness: 0.14,
      ...SMALL,
    },
    true,
  ),
  // Low-pressure turbine: 4 stages on the N1 spool.
  ...stageRows(
    "lpt",
    4,
    1.62,
    2.08,
    {
      count: 52,
      spool: "n1",
      material: "turbineBlade",
      chordHub: 0.075,
      chordTip: 0.07,
      staggerHub: -46 * DEG,
      staggerTip: -56 * DEG,
      camber: 0.08,
      thickness: 0.12,
      ...SMALL,
    },
    {
      count: 60,
      material: "turbineBlade",
      chordHub: 0.07,
      chordTip: 0.07,
      staggerHub: 42 * DEG,
      staggerTip: 46 * DEG,
      camber: 0.08,
      thickness: 0.12,
      ...SMALL,
    },
    true,
  ),
];

function rowRadii(row: RowSpec): [number, number] {
  const hub = row.hub ?? interp(HUB_LINE, row.x);
  const tip = row.tip ?? interp(CORE_TIP_LINE, row.x) - 0.006;
  return [hub - 0.006, tip];
}

// ── Lathe geometry & feature lines ──────────────────────────────────────

/**
 * Refines a closed polygonal profile using Lane-Riesenfeld cubic B-spline
 * subdivision while keeping axis endpoints and aft step corners sharp.
 */
function smoothProfile(profile: Profile, iterations = 3): [number, number][] {
  let area2 = 0;
  for (let i = 0; i < profile.length; i++) {
    const [x0, r0] = profile[i]!;
    const [x1, r1] = profile[(i + 1) % profile.length]!;
    area2 += x0 * r1 - x1 * r0;
  }
  // Normalize to clockwise winding in (x, r) so (-dr, dx) always points outward
  const ordered = area2 > 0 ? [...profile].reverse() : profile;
  let pts: [number, number][] = ordered.map(([x, r]) => [x, Math.max(r, 0)]);

  const isCornerPinned = (prev: [number, number], curr: [number, number], nxt: [number, number]): boolean => {
    if (curr[1] < 1e-3) return true;
    if (curr[0] <= 0.2) return false;
    const dx0 = curr[0] - prev[0];
    const dr0 = curr[1] - prev[1];
    const dx1 = nxt[0] - curr[0];
    const dr1 = nxt[1] - curr[1];
    const l0 = Math.hypot(dx0, dr0);
    const l1 = Math.hypot(dx1, dr1);
    const cosAngle = l0 > 1e-6 && l1 > 1e-6 ? (dx0 * dx1 + dr0 * dr1) / (l0 * l1) : -1;
    return cosAngle < Math.cos(65 * DEG);
  };

  for (let iter = 0; iter < iterations; iter++) {
    const n = pts.length;
    const split: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const curr = pts[i]!;
      const nxt = pts[(i + 1) % n]!;
      split.push([curr[0], curr[1]]);
      if (!(curr[1] < 1e-3 && nxt[1] < 1e-3)) {
        split.push([0.5 * (curr[0] + nxt[0]), 0.5 * (curr[1] + nxt[1])]);
      }
    }
    let cur = split;
    for (let pass = 0; pass < 2; pass++) {
      const m = cur.length;
      const smoothed: [number, number][] = [];
      for (let i = 0; i < m; i++) {
        const prev = cur[(i - 1 + m) % m]!;
        const curr = cur[i]!;
        const nxt = cur[(i + 1) % m]!;
        if (isCornerPinned(prev, curr, nxt)) {
          smoothed.push([curr[0], curr[1]]);
        } else {
          smoothed.push([
            0.25 * prev[0] + 0.5 * curr[0] + 0.25 * nxt[0],
            Math.max(0, 0.25 * prev[1] + 0.5 * curr[1] + 0.25 * nxt[1]),
          ]);
        }
      }
      cur = smoothed;
    }
    pts = cur;
  }
  return pts;
}

interface RingVertex {
  x: number;
  r: number;
  nx: number;
  nr: number;
  arc: number;
  connectNext: boolean;
}

export function latheGeometry(
  profile: Profile,
  segments: number,
  material: BodyMaterial = "nacelle",
): THREE.BufferGeometry {
  const pts = smoothProfile(profile, material === "nacelle" || material === "spinner" ? 3 : 2);
  const m = pts.length;

  const segNx = new Float64Array(m);
  const segNr = new Float64Array(m);
  const segLen = new Float64Array(m);
  const segAxis = new Uint8Array(m);

  for (let i = 0; i < m; i++) {
    const [x0, r0] = pts[i]!;
    const [x1, r1] = pts[(i + 1) % m]!;
    const dx = x1 - x0;
    const dr = r1 - r0;
    const len = Math.hypot(dx, dr);
    segLen[i] = len;
    if ((r0 < 1e-3 && r1 < 1e-3) || len < 1e-8) {
      segAxis[i] = 1;
    } else {
      segNx[i] = -dr / len;
      segNr[i] = dx / len;
    }
  }

  const isCrease = new Uint8Array(m);
  const creaseCos = Math.cos(60 * DEG);
  for (let i = 0; i < m; i++) {
    const prev = (i - 1 + m) % m;
    if (segAxis[prev] || segAxis[i] || pts[i]![1] < 1e-3) {
      isCrease[i] = 1;
    } else {
      const dot = segNx[prev]! * segNx[i]! + segNr[prev]! * segNr[i]!;
      if (dot <= creaseCos) isCrease[i] = 1;
    }
  }

  const arcAt = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    arcAt[i + 1] = arcAt[i]! + segLen[i]!;
  }

  // Initial vertex normals at non-creased vertices, plus cyclic C2 normal relaxation
  const vNx = new Float64Array(m);
  const vNr = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    if (isCrease[i]) continue;
    const prev = (i - 1 + m) % m;
    const lPrev = segLen[prev]! || 1;
    const lNext = segLen[i]! || 1;
    // Weight by inverse segment length so short intake-lip segments blend smoothly with long barrel segments
    const sx = segNx[prev]! / lPrev + segNx[i]! / lNext;
    const sr = segNr[prev]! / lPrev + segNr[i]! / lNext;
    const l = Math.hypot(sx, sr) || 1;
    vNx[i] = sx / l;
    vNr[i] = sr / l;
  }

  for (let pass = 0; pass < 10; pass++) {
    const nextNx = new Float64Array(m);
    const nextNr = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      if (isCrease[i]) continue;
      const prev = (i - 1 + m) % m;
      const nxt = (i + 1) % m;
      const px = isCrease[prev] ? segNx[prev]! : vNx[prev]!;
      const pr = isCrease[prev] ? segNr[prev]! : vNr[prev]!;
      const qx = isCrease[nxt] ? segNx[i]! : vNx[nxt]!;
      const qr = isCrease[nxt] ? segNr[i]! : vNr[nxt]!;
      const sx = 0.25 * px + 0.5 * vNx[i]! + 0.25 * qx;
      const sr = 0.25 * pr + 0.5 * vNr[i]! + 0.25 * qr;
      const l = Math.hypot(sx, sr) || 1;
      nextNx[i] = sx / l;
      nextNr[i] = sr / l;
    }
    for (let i = 0; i < m; i++) {
      if (!isCrease[i]) {
        vNx[i] = nextNx[i]!;
        vNr[i] = nextNr[i]!;
      }
    }
  }

  const rings: RingVertex[] = [];
  for (let i = 0; i < m; i++) {
    if (segAxis[i]) continue;
    const nxt = (i + 1) % m;
    const nx0 = isCrease[i] ? segNx[i]! : vNx[i]!;
    const nr0 = isCrease[i] ? segNr[i]! : vNr[i]!;
    const nx1 = isCrease[nxt] ? segNx[i]! : vNx[nxt]!;
    const nr1 = isCrease[nxt] ? segNr[i]! : vNr[nxt]!;

    if (rings.length === 0 || isCrease[i]) {
      rings.push({
        x: pts[i]![0],
        r: pts[i]![1],
        nx: nx0,
        nr: nr0,
        arc: arcAt[i]!,
        connectNext: true,
      });
    } else {
      rings[rings.length - 1]!.connectNext = true;
    }

    rings.push({
      x: pts[nxt]![0],
      r: pts[nxt]![1],
      nx: nx1,
      nr: nr1,
      arc: arcAt[i + 1]!,
      connectNext: false,
    });
  }

  const nRings = rings.length;

  const cols = segments + 1;
  const count = nRings * cols;
  const pos = new Float32Array(count * 3);
  const norm = new Float32Array(count * 3);
  const tangents = new Float32Array(count * 4);
  const uv = new Float32Array(count * 2);
  const uv1 = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const indices: number[] = [];

  for (let i = 0; i < nRings; i++) {
    const rv = rings[i]!;
    const { x, r, nx, nr, arc } = rv;
    const radialN = nr;

    for (let j = 0; j <= segments; j++) {
      const u = j / segments;
      // Place j=0 seam at back (-Z) away from camera: y = -r*sin(theta), z = -r*cos(theta)
      const phi = u * Math.PI * 2;
      const sinP = j === 0 || j === segments ? 0 : Math.sin(phi);
      const cosP = j === 0 || j === segments ? 1 : Math.cos(phi);

      const y = -r * sinP;
      const z = -r * cosP;
      const ny = -nr * sinP;
      const nz = -nr * cosP;
      // Circumferential unit tangent dP/dphi: (0, -cos(phi), sin(phi))
      const ty = -cosP;
      const tz = sinP;
      const theta = Math.atan2(z, y);

      const vIdx = i * cols + j;
      pos[vIdx * 3] = x;
      pos[vIdx * 3 + 1] = y;
      pos[vIdx * 3 + 2] = z;

      norm[vIdx * 3] = nx;
      norm[vIdx * 3 + 1] = ny;
      norm[vIdx * 3 + 2] = nz;

      tangents[vIdx * 4] = 0;
      tangents[vIdx * 4 + 1] = ty;
      tangents[vIdx * 4 + 2] = tz;
      tangents[vIdx * 4 + 3] = -1;

      uv[vIdx * 2] = u * 12;
      uv[vIdx * 2 + 1] = arc * 6.0;

      let ao = 1.0;
      let cr = 1.0;
      let cg = 1.0;
      let cb = 1.0;

      if (material === "nacelle") {
        // Polished leading-edge nose rim flowing seamlessly into the brushed titanium fan cowl
        const lip = 1 - smooth01(-2.88, -2.55, x);
        const lipSeam = Math.exp(-Math.pow((x + 2.66) / 0.012, 2));
        const aftNozzle = smooth01(0.18, 0.42, x);
        // Inner bypass wall is occluded inside the intake cavity behind the rounded lip crest
        const innerWall = smooth01(0.15, -0.3, radialN);
        const innerDepth = smooth01(-2.93, -2.35, x);
        const inner = innerWall * innerDepth;

        // Crisp micro-machined structural panel seams along the outer fan cowl
        const seam =
          lipSeam * 0.9 +
          Math.exp(-Math.pow((x + 1.85) / 0.012, 2)) +
          Math.exp(-Math.pow((x + 1.0) / 0.012, 2)) +
          Math.exp(-Math.pow((x + 0.18) / 0.012, 2));
        const panelMod = 1 - 0.12 * clamp01(seam) * (1 - innerWall * 0.8);

        ao = (1 - inner) * (0.88 + 0.12 * clamp01(radialN)) + inner * (0.14 + 0.24 * (1 - innerDepth));

        const barrelR = (0.94 - 0.14 * aftNozzle) * panelMod;
        const barrelG = (0.96 - 0.14 * aftNozzle) * panelMod;
        const barrelB = (0.99 - 0.12 * aftNozzle) * panelMod;
        const lipR = 1.14 * panelMod;
        const lipG = 1.16 * panelMod;
        const lipB = 1.19 * panelMod;
        const innerR = 0.34;
        const innerG = 0.37;
        const innerB = 0.42;

        const extR = barrelR + (lipR - barrelR) * lip;
        const extG = barrelG + (lipG - barrelG) * lip;
        const extB = barrelB + (lipB - barrelB) * lip;
        cr = extR + (innerR - extR) * inner;
        cg = extG + (innerG - extG) * inner;
        cb = extB + (innerB - extB) * inner;
      } else if (material === "spinner") {
        // Polished titanium nose cap + deep anodized carbon-gunmetal cone + precision spiral stripe.
        const tip = 1 - smooth01(-2.46, -2.32, x);
        const spiralPhase = theta + (x + 2.35) * 7.5;
        const spiralMask = smooth01(-2.32, -2.22, x) * (1 - smooth01(-1.78, -1.65, x));
        const spiral = spiralMask * smooth01(0.76, 0.92, Math.cos(spiralPhase));
        ao = 0.72 + 0.28 * (1 - smooth01(-2.1, -1.6, x));
        const baseR = 0.36 + 0.82 * tip;
        const baseG = 0.38 + 0.82 * tip;
        const baseB = 0.42 + 0.84 * tip;
        cr = baseR + (1.22 - baseR) * spiral * 0.75;
        cg = baseG + (1.24 - baseG) * spiral * 0.75;
        cb = baseB + (1.28 - baseB) * spiral * 0.75;
      } else if (material === "cowl") {
        // Core cowl: inner flowpath wall is occluded; axial thermal tint from Ti-6Al-4V to heat-cycled Inconel.
        const inner = smooth01(0.64, 0.59, r);
        const ringSeam =
          Math.exp(-Math.pow((x - 0.85) / 0.015, 2)) +
          Math.exp(-Math.pow((x - 1.55) / 0.015, 2)) +
          Math.exp(-Math.pow((x - 2.15) / 0.015, 2));
        const mod = 1 - 0.14 * clamp01(ringSeam);
        ao = inner ? 0.45 + 0.18 * clamp01(-radialN) : 0.84 + 0.16 * clamp01(radialN);
        const hot = smooth01(0.2, 1.5, x);
        const nozzle = smooth01(2.0, 2.5, x);
        cr = (0.92 + 0.1 * hot - 0.16 * nozzle) * mod;
        cg = (0.91 - 0.05 * hot - 0.15 * nozzle) * mod;
        cb = (0.9 - 0.14 * hot - 0.12 * nozzle) * mod;
      } else if (material === "drum") {
        // Rotor drum & exhaust tail cone: occluded in blade passages, heat-tempered Inconel exhaust plug aft of x = 2.15.
        const tail = smooth01(2.05, 2.5, x);
        const tipBlue = smooth01(2.45, 3.05, x);
        const bladePassageRipples = 0.86 + 0.14 * Math.cos(x * 22);
        ao = 0.5 * bladePassageRipples * (1 - tail) + 0.94 * tail;
        const warm = smooth01(-0.3, 1.6, x);
        cr = 0.92 + 0.1 * warm - 0.2 * tipBlue;
        cg = 0.91 - 0.05 * warm - 0.16 * tipBlue;
        cb = 0.9 - 0.14 * warm + 0.05 * tipBlue;
      } else {
        // Annular combustor liner: glowing copper-bronze-gold thermal oxidation at mid-chord.
        const coreGlow = Math.sin(clamp01((x - 0.46) / 0.58) * Math.PI);
        ao = 0.68 + 0.32 * coreGlow;
        cr = 0.98 + 0.26 * coreGlow;
        cg = 0.74 + 0.14 * coreGlow;
        cb = 0.52 + 0.04 * coreGlow;
      }

      uv1[vIdx * 2] = clamp01(ao);
      uv1[vIdx * 2 + 1] = 0.5;
      colors[vIdx * 3] = cr;
      colors[vIdx * 3 + 1] = cg;
      colors[vIdx * 3 + 2] = cb;
    }

    if (rv.connectNext && i + 1 < nRings) {
      const rowA = i * cols;
      const rowB = (i + 1) * cols;
      for (let j = 0; j < segments; j++) {
        const a = rowA + j;
        const b = rowB + j;
        const c = rowA + j + 1;
        const d = rowB + j + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
  g.setAttribute("tangent", new THREE.BufferAttribute(tangents, 4));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}

/** Meridian polylines plus circumferential rings at every profile vertex. */
export function latheWire(profile: Profile, meridians: number, ringSegments = 128): Float32Array {
  const out: number[] = [];
  const n = profile.length;
  for (let k = 0; k < meridians; k++) {
    const a = (k / meridians) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let i = 0; i < n; i++) {
      const [x0, r0] = profile[i]!;
      const [x1, r1] = profile[(i + 1) % n]!;
      if (r0 < 1e-3 && r1 < 1e-3) continue;
      out.push(x0, r0 * c, r0 * s, x1, r1 * c, r1 * s);
    }
  }
  const seen = new Set<string>();
  for (const [x, r] of profile) {
    const id = `${x.toFixed(3)}:${r.toFixed(3)}`;
    if (r < 0.02 || seen.has(id)) continue;
    seen.add(id);
    for (let j = 0; j < ringSegments; j++) {
      const a0 = (j / ringSegments) * Math.PI * 2;
      const a1 = ((j + 1) / ringSegments) * Math.PI * 2;
      out.push(x, r * Math.cos(a0), r * Math.sin(a0), x, r * Math.cos(a1), r * Math.sin(a1));
    }
  }
  return new Float32Array(out);
}

// ── Parametric blades ───────────────────────────────────────────────────

function bladePoint(
  row: RowSpec,
  hub: number,
  tip: number,
  u: number,
  v: number,
  side: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const r = hub + (tip - hub) * u;
  const chord = row.chordHub + (row.chordTip - row.chordHub) * u;
  const beta = row.staggerHub + (row.staggerTip - row.staggerHub) * u;
  const a = (v - 0.5) * chord;
  const camber = row.camber * chord * 4 * v * (1 - v);
  const half = 0.5 * row.thickness * chord * (1 - 0.6 * u) * 2.6 * Math.sqrt(v) * (1 - v);
  const b = camber + side * half;
  const axial = a * Math.cos(beta) - b * Math.sin(beta);
  const circ = a * Math.sin(beta) + b * Math.cos(beta);
  const theta = circ / r;
  return out.set(row.x + axial, r * Math.cos(theta), r * Math.sin(theta));
}

export function bladeGeometry(row: RowSpec): THREE.BufferGeometry {
  const [hub, tip] = rowRadii(row);
  const { nS, nC } = row;
  const stride = nC + 1;
  const perSide = (nS + 1) * stride;
  const totalVerts = perSide * 2;
  const pos = new Float32Array(totalVerts * 3);
  const tangents = new Float32Array(totalVerts * 4);
  const uv = new Float32Array(totalVerts * 2);
  const uv1 = new Float32Array(totalVerts * 2);
  const colors = new Float32Array(totalVerts * 3);
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const pU0 = new THREE.Vector3();
  const pU1 = new THREE.Vector3();

  const isFan = row.material === "fanBlade";
  const isTurbine = row.material === "turbineBlade";
  const baseRootAo = isFan ? 0.45 : 0.34;

  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1;
    for (let i = 0; i <= nS; i++) {
      const u = i / nS; // 0 = hub root, 1 = blade tip
      const u0 = Math.max(0, u - 0.02);
      const u1 = Math.min(1, u + 0.02);
      const spanAo = baseRootAo + (1 - baseRootAo) * smooth01(0.0, 0.45, u) - 0.1 * smooth01(0.88, 1.0, u);
      for (let j = 0; j <= nC; j++) {
        const v = j / nC; // 0 = leading edge, 1 = trailing edge
        const vIdx = side * perSide + i * stride + j;
        bladePoint(row, hub, tip, u, v, sgn, p);
        p.toArray(pos, vIdx * 3);

        bladePoint(row, hub, tip, u0, v, sgn, pU0);
        bladePoint(row, hub, tip, u1, v, sgn, pU1);
        pU1.sub(pU0).normalize();
        tangents[vIdx * 4] = pU1.x;
        tangents[vIdx * 4 + 1] = pU1.y;
        tangents[vIdx * 4 + 2] = pU1.z;
        tangents[vIdx * 4 + 3] = sgn;

        uv[vIdx * 2] = u * 6;
        uv[vIdx * 2 + 1] = v * 6;

        // Leading and trailing edges receive more open light than the mid-chord passage
        const edgeExpose = 1 - 0.18 * Math.sin(v * Math.PI);
        uv1[vIdx * 2] = clamp01(spanAo * edgeExpose);
        uv1[vIdx * 2 + 1] = v;

        const leSheath = 1 - smooth01(0.05, 0.18, v);
        const teEdge = smooth01(0.88, 1.0, v) * 0.35;
        const tipCap = smooth01(0.92, 0.99, u);
        const polish = Math.max(leSheath, tipCap * 0.75, teEdge);
        const rootFillet = 1 - 0.22 * (1 - smooth01(0.0, 0.14, u));

        let cr = 1.0;
        let cg = 1.0;
        let cb = 1.0;
        if (isFan) {
          // Dark sculpted carbon-titanium airfoil body with gleaming polished titanium leading-edge sheath
          cr = (0.36 + 0.96 * polish) * rootFillet;
          cg = (0.4 + 0.96 * polish) * rootFillet;
          cb = (0.46 + 0.96 * polish) * rootFillet;
        } else if (isTurbine) {
          // Single-crystal nickel superalloy (CMSX-4) with warm HPT->LPT thermal gradient
          const hptHeat = 1 - smooth01(1.3, 1.85, row.x);
          cr = (0.94 + 0.16 * hptHeat + 0.22 * polish) * rootFillet;
          cg = (0.82 - 0.04 * hptHeat + 0.2 * polish) * rootFillet;
          cb = (0.7 - 0.1 * hptHeat + 0.18 * polish) * rootFillet;
        } else {
          // Titanium / Inconel 718 compressor blades
          const stageWarmth = smooth01(-1.0, 0.25, row.x);
          cr = (0.84 + 0.06 * stageWarmth + 0.28 * polish) * rootFillet;
          cg = (0.88 + 0.02 * stageWarmth + 0.26 * polish) * rootFillet;
          cb = (0.93 - 0.05 * stageWarmth + 0.24 * polish) * rootFillet;
        }

        colors[vIdx * 3] = cr;
        colors[vIdx * 3 + 1] = cg;
        colors[vIdx * 3 + 2] = cb;
      }
    }
    const o = side * perSide;
    for (let i = 0; i < nS; i++) {
      for (let j = 0; j < nC; j++) {
        const a = o + i * stride + j;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        if (side === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  // Close the blade tip.
  for (let j = 0; j < nC; j++) {
    const a = nS * stride + j;
    const b = perSide + nS * stride + j;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("tangent", new THREE.BufferAttribute(tangents, 4));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Camber-line outline of every `wireStride`-th blade, merged into one buffer. */
export function bladeWire(row: RowSpec): Float32Array {
  const [hub, tip] = rowRadii(row);
  const loop: THREE.Vector3[] = [];
  const steps = Math.max(row.nS, 4);
  const cSteps = Math.max(row.nC, 4);
  for (let i = 0; i <= steps; i++) loop.push(bladePoint(row, hub, tip, i / steps, 0, 0, new THREE.Vector3()));
  for (let j = 1; j <= cSteps; j++) loop.push(bladePoint(row, hub, tip, 1, j / cSteps, 0, new THREE.Vector3()));
  for (let i = steps - 1; i >= 0; i--) loop.push(bladePoint(row, hub, tip, i / steps, 1, 0, new THREE.Vector3()));
  for (let j = cSteps - 1; j >= 0; j--) loop.push(bladePoint(row, hub, tip, 0, j / cSteps, 0, new THREE.Vector3()));

  const out: number[] = [];
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let k = 0; k < row.count; k += row.wireStride) {
    q.setFromAxisAngle(axis, (k / row.count) * Math.PI * 2);
    for (let i = 0; i < loop.length - 1; i++) {
      a.copy(loop[i]!).applyQuaternion(q);
      b.copy(loop[i + 1]!).applyQuaternion(q);
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  return new Float32Array(out);
}

export function bladeMatrices(row: RowSpec): THREE.Matrix4[] {
  const m: THREE.Matrix4[] = [];
  for (let k = 0; k < row.count; k++) m.push(new THREE.Matrix4().makeRotationX((k / row.count) * Math.PI * 2));
  return m;
}

// ── Section slicing ─────────────────────────────────────────────────────

/**
 * Intersect every closed profile with the transverse plane x = s and write
 * the solid radial intervals [r0, r1] into `out` (flat array). Returns the
 * number of intervals written.
 */
export function sliceBodies(s: number, out: Float32Array, maxIntervals: number): number {
  let count = 0;
  const radii: number[] = [];
  for (const body of BODIES) {
    radii.length = 0;
    const p = body.profile;
    for (let i = 0; i < p.length; i++) {
      const [x0, r0] = p[i]!;
      const [x1, r1] = p[(i + 1) % p.length]!;
      if (x0 <= s !== x1 <= s) radii.push(r0 + ((s - x0) / (x1 - x0)) * (r1 - r0));
    }
    radii.sort((a, b) => a - b);
    for (let i = 0; i + 1 < radii.length && count < maxIntervals; i += 2) {
      out[count * 2] = Math.max(radii[i]!, 0);
      out[count * 2 + 1] = radii[i + 1]!;
      count++;
    }
  }
  return count;
}

/** True structural facts only — these strings are rendered as callouts. */
export const CALLOUTS = [
  { key: "fan", title: "Fan", detail: "22 blades", anchor: [-1.92, 0.95, 0.35], x: -1.92, side: -1 },
  { key: "hpc", title: "HP compressor", detail: "7 stages", anchor: [-0.3, 0.52, 0.0], x: -0.3, side: 1 },
  { key: "combustor", title: "Combustor", detail: "annular", anchor: [0.75, 0.575, 0.0], x: 0.75, side: -1 },
  { key: "turbine", title: "Turbine", detail: "2 HP + 4 LP stages", anchor: [1.95, 0.64, 0.0], x: 1.62, side: 1 },
] as const;

export const ENGINE_BOUNDS = { xMin: -2.96, xMax: 3.2, rMax: 1.61 } as const;
