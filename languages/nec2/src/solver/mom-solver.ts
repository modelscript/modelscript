// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Method-of-Moments (MoM) Thin-Wire Electric Field Integral Equation (EFIE) Solver
 * using 1D Rao-Wilton-Glisson (triangular rooftop) basis functions, analytical
 * thin-wire self-term singularity extraction, PEC image theory, and lumped `LD` loading.
 *
 * Solves Z * I = V at each frequency to compute:
 *   - Feedpoint impedance Z_in = R + jX (Ohms)
 *   - Reflection coefficient Gamma (S11), VSWR, return loss (dB)
 *   - Segment currents, input & radiated power, radiation efficiency
 *   - 3D far-field radiation pattern, peak directivity & gain (dBi)
 */

import { expandNec2Frequencies, expandNec2Geometry } from "../parser/deck-parser.js";
import type {
  Complex,
  Nec2Deck,
  Nec2EquivalentRlc,
  Nec2FarFieldPoint,
  Nec2FrequencyResult,
  Nec2SolveOptions,
  Nec2SolveResult,
} from "../types.js";

const C0 = 299792458.0;
const MU0 = 4.0e-7 * Math.PI;
const EPS0 = 1.0 / (MU0 * C0 * C0);
const ETA0 = MU0 * C0;
const INV_4PI = 1.0 / (4.0 * Math.PI);
const DEG_TO_RAD = Math.PI / 180.0;

// Gauss-Legendre quadrature nodes and weights on [0, 1]
const GL2_X = [0.5 - 0.5 / Math.sqrt(3), 0.5 + 0.5 / Math.sqrt(3)];
const GL2_W = [0.5, 0.5];

const GL3_X = [0.5 - 0.5 * Math.sqrt(3 / 5), 0.5, 0.5 + 0.5 * Math.sqrt(3 / 5)];
const GL3_W = [5 / 18, 8 / 18, 5 / 18];

const GL4_X = [
  0.5 * (1 - 0.8611363115940526),
  0.5 * (1 - 0.3399810435848563),
  0.5 * (1 + 0.3399810435848563),
  0.5 * (1 + 0.8611363115940526),
];
const GL4_W = [0.5 * 0.3478548451374538, 0.5 * 0.6521451548625461, 0.5 * 0.6521451548625461, 0.5 * 0.3478548451374538];

interface WireSegment {
  globalIdx: number;
  tag: number;
  localSeg: number; // 1-based within tag
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  length: number;
  radius: number;
  node0: number;
  node1: number;
}

interface BasisHalf {
  segIdx: number;
  /** +1 if basis vector points along +s of segment, -1 if along -s */
  dirSign: number;
  /** true if weight ramps 0->1 with u in [0,1] (node is at u=1), false if 1->0 (node is at u=0) */
  rampUp: boolean;
  /** Divergence value: +1/length or -1/length */
  divVal: number;
}

interface BasisFunction {
  id: number;
  nodeId: number;
  isGroundNode: boolean;
  halves: BasisHalf[];
}

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

function cDiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  if (denom === 0) return { re: 0, im: 0 };
  return { re: (a.re * b.re + a.im * b.im) / denom, im: (a.im * b.re - a.re * b.im) / denom };
}

function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

/**
 * Solves dense complex linear system A * x = b using Gaussian elimination with partial pivoting.
 */
function solveComplexLinearSystem(
  n: number,
  aRe: Float64Array,
  aIm: Float64Array,
  bRe: Float64Array,
  bIm: Float64Array,
): { xRe: Float64Array; xIm: Float64Array } {
  const mRe = new Float64Array(aRe);
  const mIm = new Float64Array(aIm);
  const rRe = new Float64Array(bRe);
  const rIm = new Float64Array(bIm);

  for (let col = 0; col < n; col++) {
    // Partial pivot search
    let pivotRow = col;
    let maxMag = 0;
    for (let row = col; row < n; row++) {
      const idx = row * n + col;
      const mag = mRe[idx]! * mRe[idx]! + mIm[idx]! * mIm[idx]!;
      if (mag > maxMag) {
        maxMag = mag;
        pivotRow = row;
      }
    }

    if (maxMag < 1e-30) continue;

    if (pivotRow !== col) {
      for (let k = col; k < n; k++) {
        const i1 = col * n + k;
        const i2 = pivotRow * n + k;
        const tr = mRe[i1]!;
        const ti = mIm[i1]!;
        mRe[i1] = mRe[i2]!;
        mIm[i1] = mIm[i2]!;
        mRe[i2] = tr;
        mIm[i2] = ti;
      }
      const br = rRe[col]!;
      const bi = rIm[col]!;
      rRe[col] = rRe[pivotRow]!;
      rIm[col] = rIm[pivotRow]!;
      rRe[pivotRow] = br;
      rIm[pivotRow] = bi;
    }

    const pIdx = col * n + col;
    const pRe = mRe[pIdx]!;
    const pIm = mIm[pIdx]!;
    const pDen = pRe * pRe + pIm * pIm;

    for (let row = col + 1; row < n; row++) {
      const eIdx = row * n + col;
      const eRe = mRe[eIdx]!;
      const eIm = mIm[eIdx]!;
      if (eRe === 0 && eIm === 0) continue;

      const fRe = (eRe * pRe + eIm * pIm) / pDen;
      const fIm = (eIm * pRe - eRe * pIm) / pDen;

      mRe[eIdx] = 0;
      mIm[eIdx] = 0;

      for (let k = col + 1; k < n; k++) {
        const uIdx = col * n + k;
        const tIdx = row * n + k;
        const uRe = mRe[uIdx]!;
        const uIm = mIm[uIdx]!;
        mRe[tIdx] = mRe[tIdx]! - (fRe * uRe - fIm * uIm);
        mIm[tIdx] = mIm[tIdx]! - (fRe * uIm + fIm * uRe);
      }

      rRe[row] = rRe[row]! - (fRe * rRe[col]! - fIm * rIm[col]!);
      rIm[row] = rIm[row]! - (fRe * rIm[col]! + fIm * rRe[col]!);
    }
  }

  // Back substitution
  const xRe = new Float64Array(n);
  const xIm = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sRe = rRe[row]!;
    let sIm = rIm[row]!;
    for (let k = row + 1; k < n; k++) {
      const idx = row * n + k;
      const aR = mRe[idx]!;
      const aI = mIm[idx]!;
      sRe -= aR * xRe[k]! - aI * xIm[k]!;
      sIm -= aR * xIm[k]! + aI * xRe[k]!;
    }
    const dIdx = row * n + row;
    const dRe = mRe[dIdx]!;
    const dIm = mIm[dIdx]!;
    const dDen = dRe * dRe + dIm * dIm;
    if (dDen > 1e-30) {
      xRe[row] = (sRe * dRe + sIm * dIm) / dDen;
      xIm[row] = (sIm * dRe - sRe * dIm) / dDen;
    }
  }

  return { xRe, xIm };
}

/**
 * Discretizes NEC-2 wires into segments, welds coincident endpoints into nodes,
 * and constructs 1D RWG triangular rooftop basis functions.
 */
function buildWireMesh(deck: Nec2Deck, hasGroundPlane: boolean): { segments: WireSegment[]; bases: BasisFunction[] } {
  const expanded = expandNec2Geometry(deck);
  const segments: WireSegment[] = [];
  const tagCounters = new Map<number, number>();

  for (const w of expanded) {
    const n = Math.max(1, w.segments);
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const dz = w.z2 - w.z1;
    const totalLen = Math.hypot(dx, dy, dz);
    if (totalLen <= 1e-12) continue;
    const segLen = totalLen / n;
    const sx = dx / totalLen;
    const sy = dy / totalLen;
    const sz = dz / totalLen;

    for (let k = 0; k < n; k++) {
      const f0 = k / n;
      const f1 = (k + 1) / n;
      const x0 = w.x1 + dx * f0;
      const y0 = w.y1 + dy * f0;
      const z0 = w.z1 + dz * f0;
      const x1 = w.x1 + dx * f1;
      const y1 = w.y1 + dy * f1;
      const z1 = w.z1 + dz * f1;
      const localSeg = (tagCounters.get(w.tag) ?? 0) + 1;
      tagCounters.set(w.tag, localSeg);

      segments.push({
        globalIdx: segments.length,
        tag: w.tag,
        localSeg,
        x0,
        y0,
        z0,
        x1,
        y1,
        z1,
        cx: 0.5 * (x0 + x1),
        cy: 0.5 * (y0 + y1),
        cz: 0.5 * (z0 + z1),
        sx,
        sy,
        sz,
        length: segLen,
        radius: Math.max(w.radius, 1e-6),
        node0: -1,
        node1: -1,
      });
    }
  }

  if (segments.length === 0) return { segments: [], bases: [] };

  const minSegLen = segments.reduce((m, s) => Math.min(m, s.length), Infinity);
  const weldTol = Math.min(1e-4, 0.1 * minSegLen);

  // Weld endpoints into unique nodes
  const nodes: Array<{ x: number; y: number; z: number; incident: Array<{ segIdx: number; end: 0 | 1 }> }> = [];

  function findOrAddNode(x: number, y: number, z: number, segIdx: number, end: 0 | 1): number {
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i]!;
      if (Math.hypot(nd.x - x, nd.y - y, nd.z - z) <= weldTol) {
        nd.incident.push({ segIdx, end });
        return i;
      }
    }
    const id = nodes.length;
    nodes.push({ x, y, z, incident: [{ segIdx, end }] });
    return id;
  }

  for (const s of segments) {
    s.node0 = findOrAddNode(s.x0, s.y0, s.z0, s.globalIdx, 0);
    s.node1 = findOrAddNode(s.x1, s.y1, s.z1, s.globalIdx, 1);
  }

  // Build 1D RWG triangular rooftop basis functions at interior & ground nodes
  const bases: BasisFunction[] = [];

  for (let nodeId = 0; nodeId < nodes.length; nodeId++) {
    const nd = nodes[nodeId]!;
    const isGround = hasGroundPlane && Math.abs(nd.z) <= weldTol;

    if (isGround) {
      // Each wire segment touching the PEC ground plane has a ground-connected rooftop basis
      // (whose other half is implicitly its PEC image below z = 0).
      for (const inc of nd.incident) {
        const seg = segments[inc.segIdx]!;
        if (inc.end === 0) {
          // Leaves ground along +s: f(u) = (1 - u) * (+s), div = -1/L
          bases.push({
            id: bases.length,
            nodeId,
            isGroundNode: true,
            halves: [{ segIdx: seg.globalIdx, dirSign: 1, rampUp: false, divVal: -1 / seg.length }],
          });
        } else {
          // Leaves ground along -s: f(u) = u * (-s), div = -1/L
          bases.push({
            id: bases.length,
            nodeId,
            isGroundNode: true,
            halves: [{ segIdx: seg.globalIdx, dirSign: -1, rampUp: true, divVal: -1 / seg.length }],
          });
        }
      }
    } else if (nd.incident.length >= 2) {
      // Interior node or junction: pick incident[0] as entering reference edge,
      // pair with each remaining incident edge as leaving edge.
      const refInc = nd.incident[0]!;
      const refSeg = segments[refInc.segIdx]!;
      const enteringHalf: BasisHalf =
        refInc.end === 1
          ? // Enters node at u=1 along +s: f(u) = u * (+s), div = +1/L
            { segIdx: refSeg.globalIdx, dirSign: 1, rampUp: true, divVal: 1 / refSeg.length }
          : // Enters node at u=0 along -s: f(u) = (1-u) * (-s), div = +1/L
            { segIdx: refSeg.globalIdx, dirSign: -1, rampUp: false, divVal: 1 / refSeg.length };

      for (let r = 1; r < nd.incident.length; r++) {
        const outInc = nd.incident[r]!;
        const outSeg = segments[outInc.segIdx]!;
        const leavingHalf: BasisHalf =
          outInc.end === 0
            ? // Leaves node at u=0 along +s: f(u) = (1-u) * (+s), div = -1/L
              { segIdx: outSeg.globalIdx, dirSign: 1, rampUp: false, divVal: -1 / outSeg.length }
            : // Leaves node at u=1 along -s: f(u) = u * (-s), div = -1/L
              { segIdx: outSeg.globalIdx, dirSign: -1, rampUp: true, divVal: -1 / outSeg.length };

        bases.push({
          id: bases.length,
          nodeId,
          isGroundNode: false,
          halves: [enteringHalf, leavingHalf],
        });
      }
    }
  }

  return { segments, bases };
}

/**
 * Computes the half-segment pair interaction integral:
 *   Z_pair = j*omega*mu0 * I_vec - (j / (omega*eps0)) * I_scal
 * where:
 *   I_vec  = \iint f_p(r) . f_q(r') G(R) ds ds'
 *   I_scal = \iint (div f_p)(div f_q) G(R) ds ds'
 */
function computeHalfPairImpedance(
  segP: WireSegment,
  halfP: BasisHalf,
  segQ: WireSegment,
  halfQ: BasisHalf,
  k0: number,
  omegaMu0: number,
  invOmegaEps0: number,
  isImageQ: boolean,
): Complex {
  const lp = segP.length;
  const lq = segQ.length;

  // Source geometry (mirrored across z=0 if PEC image)
  const qx0 = segQ.x0;
  const qy0 = segQ.y0;
  const qz0 = isImageQ ? -segQ.z0 : segQ.z0;
  const qdx = segQ.x1 - segQ.x0;
  const qdy = segQ.y1 - segQ.y0;
  const qdz = isImageQ ? -(segQ.z1 - segQ.z0) : segQ.z1 - segQ.z0;

  // Source basis vector direction (for PEC image: J_img = (-Jx, -Jy, +Jz))
  const fsx = (isImageQ ? -1 : 1) * halfQ.dirSign * segQ.sx;
  const fsy = (isImageQ ? -1 : 1) * halfQ.dirSign * segQ.sy;
  const fsz = halfQ.dirSign * segQ.sz;

  // Test basis vector direction
  const ftx = halfP.dirSign * segP.sx;
  const fty = halfP.dirSign * segP.sy;
  const ftz = halfP.dirSign * segP.sz;

  const dotDir = ftx * fsx + fty * fsy + ftz * fsz;
  const divProd = halfP.divVal * (isImageQ ? -halfQ.divVal : halfQ.divVal);
  const a2 = segQ.radius * segQ.radius;

  let vecRe = 0;
  let vecIm = 0;
  let scalRe = 0;
  let scalIm = 0;

  const isSelf = !isImageQ && segP.globalIdx === segQ.globalIdx;

  if (isSelf) {
    // Analytical singularity extraction for 1/(4*pi*R) + 4-pt GL for outer integral
    const alpha = segQ.radius / lp;
    const alpha2 = alpha * alpha;

    // 1. Singular part of vector integral: (lp / (4*pi)) * \int_0^1 w_p(u) [\int_0^1 w_q(v) / sqrt((v-u)^2 + alpha^2) dv] du
    let singVec = 0;
    for (let i = 0; i < 4; i++) {
      const u = GL4_X[i]!;
      const wu = GL4_W[i]!;
      const fp = halfP.rampUp ? u : 1 - u;

      const i0 = Math.asinh((1 - u) / alpha) - Math.asinh(-u / alpha);
      const i1 = Math.sqrt((1 - u) * (1 - u) + alpha2) - Math.sqrt(u * u + alpha2) + u * i0;
      const inner = halfQ.rampUp ? i1 : i0 - i1;
      singVec += wu * fp * inner;
    }
    vecRe += dotDir * lp * INV_4PI * singVec;

    // 2. Singular part of scalar integral (exact closed form):
    // \int_0^1 \int_0^1 1 / sqrt((u-v)^2 + alpha^2) du dv = 2 * [asinh(1/alpha) - (sqrt(1+alpha^2) - alpha)]
    const singScal = 2.0 * (Math.asinh(1.0 / alpha) - (Math.sqrt(1.0 + alpha2) - alpha));
    scalRe += divProd * lp * INV_4PI * singScal;

    // 3. Smooth remainder (exp(-jkR) - 1) / (4*pi*R) via 3-pt GL
    const len2 = lp * lp;
    for (let i = 0; i < 3; i++) {
      const u = GL3_X[i]!;
      const wu = GL3_W[i]!;
      const fp = halfP.rampUp ? u : 1 - u;
      for (let j = 0; j < 3; j++) {
        const v = GL3_X[j]!;
        const wv = GL3_W[j]!;
        const fq = halfQ.rampUp ? v : 1 - v;
        const R = Math.sqrt(len2 * (u - v) * (u - v) + a2);
        const kR = k0 * R;
        // (cos(kR) - 1 - j sin(kR)) / (4*pi*R)
        const gRe = ((Math.cos(kR) - 1.0) * INV_4PI) / R;
        const gIm = (-Math.sin(kR) * INV_4PI) / R;
        const w = wu * wv * len2;
        vecRe += w * dotDir * fp * fq * gRe;
        vecIm += w * dotDir * fp * fq * gIm;
        scalRe += w * divProd * gRe;
        scalIm += w * divProd * gIm;
      }
    }
  } else {
    const qcx = segQ.cx;
    const qcy = segQ.cy;
    const qcz = isImageQ ? -segQ.cz : segQ.cz;
    const centerDist = Math.hypot(segP.cx - qcx, segP.cy - qcy, segP.cz - qcz);
    const isAdjacent = centerDist < 1.5 * Math.max(lp, lq);
    const isNear = centerDist < 3.0 * Math.max(lp, lq);
    const qx = isAdjacent ? GL4_X : isNear ? GL3_X : GL2_X;
    const qw = isAdjacent ? GL4_W : isNear ? GL3_W : GL2_W;
    const nq = qx.length;

    const pdx = segP.x1 - segP.x0;
    const pdy = segP.y1 - segP.y0;
    const pdz = segP.z1 - segP.z0;
    const lplq = lp * lq;

    for (let i = 0; i < nq; i++) {
      const u = qx[i]!;
      const wu = qw[i]!;
      const px = segP.x0 + pdx * u;
      const py = segP.y0 + pdy * u;
      const pz = segP.z0 + pdz * u;
      const fp = halfP.rampUp ? u : 1 - u;

      for (let j = 0; j < nq; j++) {
        const v = qx[j]!;
        const wv = qw[j]!;
        const rx = px - (qx0 + qdx * v);
        const ry = py - (qy0 + qdy * v);
        const rz = pz - (qz0 + qdz * v);
        const R = Math.sqrt(rx * rx + ry * ry + rz * rz + a2);
        const kR = k0 * R;
        const inv4piR = INV_4PI / R;
        const gRe = Math.cos(kR) * inv4piR;
        const gIm = -Math.sin(kR) * inv4piR;

        const fq = halfQ.rampUp ? v : 1 - v;
        const w = wu * wv * lplq;
        vecRe += w * dotDir * fp * fq * gRe;
        vecIm += w * dotDir * fp * fq * gIm;
        scalRe += w * divProd * gRe;
        scalIm += w * divProd * gIm;
      }
    }
  }

  // Z = j * omega * mu0 * (vecRe + j vecIm) - (j / (omega * eps0)) * (scalRe + j scalIm)
  //   = (-omegaMu0 * vecIm + invOmegaEps0 * scalIm) + j * (omegaMu0 * vecRe - invOmegaEps0 * scalRe)
  return {
    re: -omegaMu0 * vecIm + invOmegaEps0 * scalIm,
    im: omegaMu0 * vecRe - invOmegaEps0 * scalRe,
  };
}

/**
 * Evaluates a NEC-2 `LD` load card impedance Z_L (Ohms) for a segment of given length and radius at angular frequency omega.
 */
function evaluateLoadImpedance(
  ldtyp: number,
  z1: number,
  z2: number,
  z3: number,
  omega: number,
  segLen: number,
  radius: number,
): Complex {
  switch (ldtyp) {
    case 0: {
      // Series RLC: R + j*(omega*L - 1/(omega*C))
      const xl = z2 > 0 ? omega * z2 : 0;
      const xc = z3 > 0 ? -1 / (omega * z3) : 0;
      return { re: z1, im: xl + xc };
    }
    case 1: {
      // Parallel RLC: 1 / (1/R + j*(omega*C - 1/(omega*L)))
      const g = z1 > 0 ? 1 / z1 : 0;
      const bc = z3 > 0 ? omega * z3 : 0;
      const bl = z2 > 0 ? -1 / (omega * z2) : 0;
      return cDiv({ re: 1, im: 0 }, { re: g, im: bc + bl });
    }
    case 2: {
      // Series RLC per unit length
      const xl = z2 > 0 ? omega * z2 : 0;
      const xc = z3 > 0 ? -1 / (omega * z3) : 0;
      return { re: z1 * segLen, im: (xl + xc) * segLen };
    }
    case 3: {
      // Parallel RLC per unit length
      const g = z1 > 0 ? 1 / (z1 * segLen) : 0;
      const bc = z3 > 0 ? omega * z3 * segLen : 0;
      const bl = z2 > 0 ? -1 / (omega * z2 * segLen) : 0;
      return cDiv({ re: 1, im: 0 }, { re: g, im: bc + bl });
    }
    case 4: {
      // Fixed impedance R + jX
      return { re: z1, im: z2 };
    }
    case 5: {
      // Wire conductivity sigma (S/m): skin-effect surface impedance Z_s * L / (2*pi*a)
      if (z1 <= 0) return { re: 0, im: 0 };
      const rs = Math.sqrt((omega * MU0) / (2.0 * z1));
      const coeff = (rs * segLen) / (2.0 * Math.PI * radius);
      return { re: coeff, im: coeff };
    }
    default:
      return { re: 0, im: 0 };
  }
}

/**
 * Solves a parsed NEC-2 deck across all `FR` frequency points using the 1D RWG EFIE MoM solver.
 */
export function solveNec2Deck(deck: Nec2Deck, options: Nec2SolveOptions = {}): Nec2SolveResult {
  const z0 = options.z0 ?? 50.0;
  const computeFarField = options.computeFarField ?? true;
  const thetaSamples = options.thetaSamples ?? 37;
  const phiSamples = options.phiSamples ?? 18;

  const hasGroundPlane =
    (deck.geometryEnd !== undefined && deck.geometryEnd.gpflag !== 0) ||
    deck.grounds.some((g) => g.iperf === 1 || g.iperf === 0 || g.iperf === 2);

  const { segments, bases } = buildWireMesh(deck, hasGroundPlane);
  const freqs = expandNec2Frequencies(deck);
  const effectiveFreqs = freqs.length > 0 ? freqs : [300.0];

  const m = bases.length;
  const points: Nec2FrequencyResult[] = [];

  if (m === 0 || segments.length === 0) {
    return {
      z0,
      hasGroundPlane,
      segmentCount: segments.length,
      basisCount: 0,
      points,
    };
  }

  // Locate primary voltage excitation segment
  const primaryEx = deck.excitations.find((e) => e.type === 0 || e.type === 5) ?? deck.excitations[0];
  let feedSegIdx = Math.floor(segments.length / 2);
  let vSource: Complex = { re: 1.0, im: 0.0 };

  if (primaryEx) {
    vSource = { re: primaryEx.vReal, im: primaryEx.vImag };
    if (primaryEx.tag > 0) {
      const found = segments.find((s) => s.tag === primaryEx.tag && s.localSeg === primaryEx.segment);
      if (found) feedSegIdx = found.globalIdx;
    } else if (primaryEx.segment >= 1 && primaryEx.segment <= segments.length) {
      feedSegIdx = primaryEx.segment - 1;
    }
  }

  // Pre-map each segment to its participating basis halves
  const segToBases: Array<Array<{ basisId: number; half: BasisHalf }>> = Array.from(
    { length: segments.length },
    () => [],
  );
  for (const b of bases) {
    for (const h of b.halves) {
      segToBases[h.segIdx]!.push({ basisId: b.id, half: h });
    }
  }

  for (const freqMhz of effectiveFreqs) {
    const freqHz = freqMhz * 1e6;
    const wavelengthM = C0 / freqHz;
    const omega = 2.0 * Math.PI * freqHz;
    const k0 = omega / C0;
    const omegaMu0 = omega * MU0;
    const invOmegaEps0 = 1.0 / (omega * EPS0);

    // 1. Assemble M x M complex MoM impedance matrix Z
    const zRe = new Float64Array(m * m);
    const zIm = new Float64Array(m * m);

    for (let i = 0; i < m; i++) {
      const bi = bases[i]!;
      for (let j = 0; j < m; j++) {
        const bj = bases[j]!;
        let sumRe = 0;
        let sumIm = 0;

        for (const hp of bi.halves) {
          const segP = segments[hp.segIdx]!;
          for (const hq of bj.halves) {
            const segQ = segments[hq.segIdx]!;
            const zReal = computeHalfPairImpedance(segP, hp, segQ, hq, k0, omegaMu0, invOmegaEps0, false);
            sumRe += zReal.re;
            sumIm += zReal.im;

            if (hasGroundPlane) {
              const zImg = computeHalfPairImpedance(segP, hp, segQ, hq, k0, omegaMu0, invOmegaEps0, true);
              sumRe += zImg.re;
              sumIm += zImg.im;
            }
          }
        }

        zRe[i * m + j] = sumRe;
        zIm[i * m + j] = sumIm;
      }
    }

    // 2. Apply LD lumped impedance loads to Z matrix
    for (const ld of deck.loads) {
      if (ld.ldtyp < 0) continue;
      for (const seg of segments) {
        if (ld.tag !== 0 && seg.tag !== ld.tag) continue;
        if (ld.segStart > 0 && seg.localSeg < ld.segStart) continue;
        if (ld.segEnd > 0 && seg.localSeg > ld.segEnd) continue;

        const zLoad = evaluateLoadImpedance(ld.ldtyp, ld.z1, ld.z2, ld.z3, omega, seg.length, seg.radius);
        const entries = segToBases[seg.globalIdx]!;
        for (const ep of entries) {
          for (const eq of entries) {
            // \int_0^1 w_p(u) w_q(u) du = 1/3 if same ramp, 1/6 if opposite
            const weight = ep.half.rampUp === eq.half.rampUp ? 1 / 3 : 1 / 6;
            const sign = ep.half.dirSign * eq.half.dirSign;
            const idx = ep.basisId * m + eq.basisId;
            zRe[idx] = zRe[idx]! + sign * weight * zLoad.re;
            zIm[idx] = zIm[idx]! + sign * weight * zLoad.im;
          }
        }
      }
    }

    // 3. Assemble excitation vector V
    const vRe = new Float64Array(m);
    const vIm = new Float64Array(m);

    // Check if feed segment touches a ground node (e.g., monopole base at z=0)
    const feedEntries = segToBases[feedSegIdx]!;
    const groundFeedBasis = feedEntries.find((e) => bases[e.basisId]!.isGroundNode);

    if (groundFeedBasis) {
      // Delta-gap voltage source directly at the ground-plane feedpoint
      vRe[groundFeedBasis.basisId] = groundFeedBasis.half.dirSign * vSource.re;
      vIm[groundFeedBasis.basisId] = groundFeedBasis.half.dirSign * vSource.im;
    } else if (feedEntries.length > 0) {
      // Uniform-field voltage source across the excited segment:
      // \int_0^L (V0 / L) * f_m(s) ds = 0.5 * V0 * dirSign
      for (const entry of feedEntries) {
        vRe[entry.basisId] = vRe[entry.basisId]! + 0.5 * entry.half.dirSign * vSource.re;
        vIm[entry.basisId] = vIm[entry.basisId]! + 0.5 * entry.half.dirSign * vSource.im;
      }
    }

    // 4. Solve Z * I = V
    const { xRe, xIm } = solveComplexLinearSystem(m, zRe, zIm, vRe, vIm);

    // 5. Reconstruct midpoint current on every wire segment
    const segmentCurrents: Complex[] = segments.map((_, segIdx) => {
      let iRe = 0;
      let iIm = 0;
      for (const entry of segToBases[segIdx]!) {
        // At segment midpoint u = 0.5, rooftop basis weight is 0.5
        iRe += 0.5 * entry.half.dirSign * xRe[entry.basisId]!;
        iIm += 0.5 * entry.half.dirSign * xIm[entry.basisId]!;
      }
      return { re: iRe, im: iIm };
    });

    // Feedpoint current and impedance
    const feedpointCurrent: Complex = groundFeedBasis
      ? {
          re: groundFeedBasis.half.dirSign * xRe[groundFeedBasis.basisId]!,
          im: groundFeedBasis.half.dirSign * xIm[groundFeedBasis.basisId]!,
        }
      : segmentCurrents[feedSegIdx]!;

    const feedpointImpedance = cDiv(vSource, feedpointCurrent);
    const feedpointAdmittance = cDiv(feedpointCurrent, vSource);

    // Reflection coefficient Gamma = (Zin - Z0) / (Zin + Z0)
    const z0C: Complex = { re: z0, im: 0 };
    const reflectionCoeff = cDiv(cSub(feedpointImpedance, z0C), cAdd(feedpointImpedance, z0C));
    const s11Mag = cAbs(reflectionCoeff);
    const s11PhaseDeg = (Math.atan2(reflectionCoeff.im, reflectionCoeff.re) * 180.0) / Math.PI;
    const vswr = s11Mag >= 0.999999 ? 1e6 : (1.0 + s11Mag) / (1.0 - s11Mag);
    const returnLossDb = s11Mag <= 1e-12 ? 120.0 : -20.0 * Math.log10(s11Mag);

    // Input power: P_in = 0.5 * Re(V * I*)
    const inputPowerW = Math.max(0, 0.5 * (vSource.re * feedpointCurrent.re + vSource.im * feedpointCurrent.im));

    // 6. Far-field radiation pattern, radiated power, and directivity
    let radiatedPowerW = inputPowerW;
    let peakDirectivityLinear = 1.0;
    let peakDirectivityDbi = 0.0;
    const farField: Nec2FarFieldPoint[] = [];

    if (computeFarField) {
      const thetaMaxDeg = hasGroundPlane ? 90.0 : 180.0;
      const nTh = Math.max(9, thetaSamples);
      const nPh = Math.max(8, phiSamples);
      const dThetaRad = (thetaMaxDeg * DEG_TO_RAD) / (nTh - 1);
      const dPhiRad = (2.0 * Math.PI) / nPh;

      const uGrid = new Float64Array(nTh * nPh);
      const eThReGrid = new Float64Array(nTh * nPh);
      const eThImGrid = new Float64Array(nTh * nPh);
      const ePhReGrid = new Float64Array(nTh * nPh);
      const ePhImGrid = new Float64Array(nTh * nPh);

      const ffScale = omegaMu0 * INV_4PI;
      let pRadSum = 0;
      let uMax = 0;

      for (let it = 0; it < nTh; it++) {
        const thetaRad = it * dThetaRad;
        const sinTh = Math.sin(thetaRad);
        const cosTh = Math.cos(thetaRad);
        const trapTh = it === 0 || it === nTh - 1 ? 0.5 : 1.0;

        for (let ip = 0; ip < nPh; ip++) {
          const phiRad = ip * dPhiRad;
          const sinPh = Math.sin(phiRad);
          const cosPh = Math.cos(phiRad);

          const rx = sinTh * cosPh;
          const ry = sinTh * sinPh;
          const rz = cosTh;

          const thx = cosTh * cosPh;
          const thy = cosTh * sinPh;
          const thz = -sinTh;

          const phx = -sinPh;
          const phy = cosPh;

          let nThRe = 0;
          let nThIm = 0;
          let nPhRe = 0;
          let nPhIm = 0;

          for (let sIdx = 0; sIdx < segments.length; sIdx++) {
            const seg = segments[sIdx]!;
            const curr = segmentCurrents[sIdx]!;
            const ilRe = curr.re * seg.length;
            const ilIm = curr.im * seg.length;

            // Real segment contribution
            const phase = k0 * (rx * seg.cx + ry * seg.cy + rz * seg.cz);
            const cp = Math.cos(phase);
            const sp = Math.sin(phase);
            const fRe = ilRe * cp - ilIm * sp;
            const fIm = ilRe * sp + ilIm * cp;

            const dotTh = seg.sx * thx + seg.sy * thy + seg.sz * thz;
            const dotPh = seg.sx * phx + seg.sy * phy;
            nThRe += fRe * dotTh;
            nThIm += fIm * dotTh;
            nPhRe += fRe * dotPh;
            nPhIm += fIm * dotPh;

            // PEC image segment contribution: J_img = (-Jx, -Jy, +Jz) at (cx, cy, -cz)
            if (hasGroundPlane) {
              const phaseImg = k0 * (rx * seg.cx + ry * seg.cy - rz * seg.cz);
              const cpi = Math.cos(phaseImg);
              const spi = Math.sin(phaseImg);
              const fiRe = ilRe * cpi - ilIm * spi;
              const fiIm = ilRe * spi + ilIm * cpi;

              const dotThImg = -seg.sx * thx - seg.sy * thy + seg.sz * thz;
              const dotPhImg = -seg.sx * phx - seg.sy * phy;
              nThRe += fiRe * dotThImg;
              nThIm += fiIm * dotThImg;
              nPhRe += fiRe * dotPhImg;
              nPhIm += fiIm * dotPhImg;
            }
          }

          // E = -j * (omega*mu0 / 4pi) * N => Re(E) = ffScale * Im(N), Im(E) = -ffScale * Re(N)
          const eThRe = ffScale * nThIm;
          const eThIm = -ffScale * nThRe;
          const ePhRe = ffScale * nPhIm;
          const ePhIm = -ffScale * nPhRe;

          const uVal = (eThRe * eThRe + eThIm * eThIm + ePhRe * ePhRe + ePhIm * ePhIm) / (2.0 * ETA0);
          const idx = it * nPh + ip;
          uGrid[idx] = uVal;
          eThReGrid[idx] = eThRe;
          eThImGrid[idx] = eThIm;
          ePhReGrid[idx] = ePhRe;
          ePhImGrid[idx] = ePhIm;

          if (uVal > uMax) uMax = uVal;
          pRadSum += uVal * sinTh * trapTh * dThetaRad * dPhiRad;
        }
      }

      radiatedPowerW = pRadSum;
      if (pRadSum > 1e-30 && uMax > 0) {
        peakDirectivityLinear = (4.0 * Math.PI * uMax) / pRadSum;
        peakDirectivityDbi = 10.0 * Math.log10(peakDirectivityLinear);
      }

      // Emit elevation cut (phi = 0) far-field points
      for (let it = 0; it < nTh; it++) {
        const idx = it * nPh;
        const uVal = uGrid[idx]!;
        const dLin = pRadSum > 1e-30 ? (4.0 * Math.PI * uVal) / pRadSum : 0;
        const gDbi = dLin > 1e-12 ? 10.0 * Math.log10(dLin) : -120.0;
        farField.push({
          thetaDeg: (it * dThetaRad) / DEG_TO_RAD,
          phiDeg: 0,
          eTheta: { re: eThReGrid[idx]!, im: eThImGrid[idx]! },
          ePhi: { re: ePhReGrid[idx]!, im: ePhImGrid[idx]! },
          gainDbi: gDbi,
          directivityLinear: dLin,
        });
      }
    }

    const efficiency = inputPowerW > 1e-30 ? Math.min(1.0, Math.max(0.0, radiatedPowerW / inputPowerW)) : 1.0;
    const peakGainDbi =
      efficiency > 1e-12 ? peakDirectivityDbi + 10.0 * Math.log10(efficiency) : peakDirectivityDbi - 120.0;

    points.push({
      frequencyMhz: freqMhz,
      wavelengthM,
      feedpointImpedance,
      feedpointAdmittance,
      feedpointCurrent,
      reflectionCoeff,
      s11Mag,
      s11PhaseDeg,
      vswr,
      returnLossDb,
      inputPowerW,
      radiatedPowerW,
      efficiency,
      peakDirectivityLinear,
      peakDirectivityDbi,
      peakGainDbi,
      segmentCurrents,
      farField,
    });
  }

  return {
    z0,
    hasGroundPlane,
    segmentCount: segments.length,
    basisCount: m,
    points,
  };
}

/**
 * Extracts an equivalent series RLC resonant antenna circuit `(R_rad, R_loss, L_ant, C_ant)`
 * matching the MoM feedpoint impedance `Z_in(f0)` and reactance slope `dX/domega` around `f0`.
 */
export function extractEquivalentRlc(deck: Nec2Deck, z0Ohm: number = 50.0): Nec2EquivalentRlc {
  const freqs = expandNec2Frequencies(deck);
  const f0Mhz = freqs.length > 0 ? freqs[Math.floor(freqs.length / 2)]! : 300.0;
  const dfMhz = Math.max(0.5, f0Mhz * 0.01);

  // Solve at f0 - df, f0, f0 + df to estimate dX/domega
  const probeDeck: Nec2Deck = {
    ...deck,
    frequencies: [
      {
        ifrq: 0,
        nfrq: 3,
        fmhz: Math.max(0.01, f0Mhz - dfMhz),
        delFreq: dfMhz,
        line: 1,
        column: 1,
        startOffset: 0,
        endOffset: 0,
      },
    ],
  };

  const res = solveNec2Deck(probeDeck, { z0: z0Ohm, computeFarField: false });
  const pLow = res.points[0];
  const pMid = res.points[1] ?? pLow;
  const pHigh = res.points[2] ?? pMid;

  const omega0 = 2.0 * Math.PI * f0Mhz * 1e6;
  const rTotal = Math.max(1e-3, pMid?.feedpointImpedance.re ?? 73.1);
  const x0 = pMid?.feedpointImpedance.im ?? 42.5;
  const eff = pMid?.efficiency ?? 1.0;

  const rRadOhm = Math.max(1e-3, rTotal * eff);
  const rLossOhm = Math.max(0, rTotal - rRadOhm);

  // Series RLC: X(w) = w*L - 1/(w*C), dX/dw = L + 1/(w^2 * C)
  // Solving for L and C:
  //   L = 0.5 * (dX/dw + X0 / w0)
  //   1 / (w0^2 * C) = 0.5 * (dX/dw - X0 / w0)
  let dXdW = (2.0 * Math.max(Math.abs(x0), 50.0)) / omega0;
  if (pLow && pHigh && pHigh.frequencyMhz > pLow.frequencyMhz) {
    const dw = 2.0 * Math.PI * (pHigh.frequencyMhz - pLow.frequencyMhz) * 1e6;
    const rawSlope = (pHigh.feedpointImpedance.im - pLow.feedpointImpedance.im) / dw;
    if (Number.isFinite(rawSlope) && rawSlope > Math.abs(x0) / omega0) {
      dXdW = rawSlope;
    }
  }

  const lAntH = Math.max(1e-11, 0.5 * (dXdW + x0 / omega0));
  const invW2C = Math.max(1e-11, 0.5 * (dXdW - x0 / omega0));
  const cAntF = 1.0 / (omega0 * omega0 * invW2C);
  const qFactor = (omega0 * lAntH) / rTotal;

  return {
    frequencyMhz: f0Mhz,
    rRadOhm,
    rLossOhm,
    lAntH,
    cAntF,
    z0Ohm,
    xAntOhm: x0,
    qFactor,
  };
}
