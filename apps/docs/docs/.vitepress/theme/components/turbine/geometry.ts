// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Procedural two-spool high-bypass turbofan used by the landing-page hero.
// The engine axis is world +X (intake at -X, exhaust at +X). All bodies of
// revolution are described as closed (x, r) profiles so the same data drives
// the solid lathe mesh, the CAD-style feature-line wireframe and the
// analytic section cap.

import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Closed polygon in the meridional plane: [axial x, radius r]. */
export type Profile = readonly (readonly [number, number])[];

export type Spool = "n1" | "n2" | null;

export interface BodySpec {
  key: string;
  profile: Profile;
  material: "casing" | "hub" | "liner";
  spool: Spool;
  segments: number;
  meridians: number;
}

export interface RowSpec {
  key: string;
  x: number;
  count: number;
  spool: Spool;
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
  { key: "nacelle", profile: NACELLE, material: "casing", spool: null, segments: 160, meridians: 28 },
  { key: "spinner", profile: SPINNER, material: "hub", spool: "n1", segments: 96, meridians: 12 },
  { key: "cowl", profile: CORE_COWL, material: "casing", spool: null, segments: 128, meridians: 24 },
  { key: "drum", profile: DRUM, material: "hub", spool: null, segments: 96, meridians: 16 },
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

const SMALL = { nS: 2, nC: 5, wireStride: 3 } as const;

export const ROWS: readonly RowSpec[] = [
  {
    key: "fan",
    x: -1.92,
    count: 22,
    spool: "n1",
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

export function latheGeometry(profile: Profile, segments: number): THREE.BufferGeometry {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0), x));
  pts.push(pts[0]!.clone());
  const lathe = new THREE.LatheGeometry(pts, segments);
  // Lathe axis is +Y; rotate so it becomes the engine's +X axis.
  lathe.rotateZ(-Math.PI / 2);
  const creased = toCreasedNormals(lathe, 32 * DEG);
  lathe.dispose();
  return creased;
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
  const pos = new Float32Array(perSide * 2 * 3);
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i <= nS; i++) {
      for (let j = 0; j <= nC; j++) {
        bladePoint(row, hub, tip, i / nS, j / nC, side === 0 ? 1 : -1, p);
        p.toArray(pos, (side * perSide + i * stride + j) * 3);
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
