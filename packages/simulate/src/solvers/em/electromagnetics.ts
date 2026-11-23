// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Electromagnetics (1D Yee FDTD) & Optical ABCD Ray/Gaussian Beam Solver.
 *
 * Serves `optical`, `fiber`, `touchstone`, and `ran` languages.
 */

export interface Fdtd1DConfig {
  readonly numCells: number;
  readonly numSteps: number;
  readonly dx: number;
  readonly sourceCell: number;
  readonly sourceFn: (step: number, dt: number) => number;
  /** Optional relative permittivity profile epsilon_r[i] (defaults to vacuum 1.0). */
  readonly epsR?: Float64Array | undefined;
}

export interface Fdtd1DResult {
  readonly Ez: Float64Array;
  readonly Hy: Float64Array;
  readonly dt: number;
  readonly probeHistory: Float64Array;
}

const C0 = 299_792_458.0;
const IMP0 = 376.730313668;

/**
 * 1D Yee-grid Finite-Difference Time-Domain (FDTD) Maxwell solver with 1st-order Mur ABC.
 */
export function runFdtd1D(cfg: Fdtd1DConfig, probeCell?: number): Fdtd1DResult {
  const N = cfg.numCells;
  const dt = (0.99 * cfg.dx) / C0; // Courant-stable time step
  const Ez = new Float64Array(N);
  const Hy = new Float64Array(N);
  const epsR = cfg.epsR ?? new Float64Array(N).fill(1.0);
  const probeIdx = probeCell ?? Math.floor(N * 0.75);
  const probeHistory = new Float64Array(cfg.numSteps);

  const Sc = (C0 * dt) / cfg.dx;
  const murCoeff = (Sc - 1.0) / (Sc + 1.0);
  let ezLeftPrev = 0;
  let ezRightPrev = 0;

  for (let n = 0; n < cfg.numSteps; n++) {
    // Update magnetic field Hy
    for (let i = 0; i < N - 1; i++) {
      Hy[i] = Hy[i]! + (Sc / IMP0) * (Ez[i + 1]! - Ez[i]!);
    }

    const ezLeftOld = Ez[1]!;
    const ezRightOld = Ez[N - 2]!;

    // Update electric field Ez
    for (let i = 1; i < N - 1; i++) {
      Ez[i] = Ez[i]! + ((Sc * IMP0) / epsR[i]!) * (Hy[i]! - Hy[i - 1]!);
    }

    // Soft additive source
    Ez[cfg.sourceCell] = Ez[cfg.sourceCell]! + cfg.sourceFn(n, dt);

    // 1st-order Mur Absorbing Boundary Conditions
    Ez[0] = ezLeftPrev + murCoeff * (Ez[1]! - Ez[0]!);
    Ez[N - 1] = ezRightPrev + murCoeff * (Ez[N - 2]! - Ez[N - 1]!);
    ezLeftPrev = ezLeftOld;
    ezRightPrev = ezRightOld;

    probeHistory[n] = Ez[probeIdx]!;
  }

  return { Ez, Hy, dt, probeHistory };
}

export type OpticalElement =
  | { readonly kind: "freespace"; readonly distance: number }
  | { readonly kind: "thin-lens"; readonly focalLength: number }
  | { readonly kind: "interface"; readonly n1: number; readonly n2: number; readonly radius?: number | undefined }
  | { readonly kind: "curved-mirror"; readonly radius: number };

export interface AbcdMatrix {
  readonly A: number;
  readonly B: number;
  readonly C: number;
  readonly D: number;
}

/** Computes the composite 2x2 paraxial ABCD ray-transfer matrix for an optical bench. */
export function computeAbcdSystem(elements: readonly OpticalElement[]): AbcdMatrix {
  let A = 1;
  let B = 0;
  let C = 0;
  let D = 1;

  for (const el of elements) {
    let eA = 1;
    let eB = 0;
    let eC = 0;
    let eD = 1;
    if (el.kind === "freespace") {
      eB = el.distance;
    } else if (el.kind === "thin-lens") {
      eC = -1.0 / el.focalLength;
    } else if (el.kind === "curved-mirror") {
      eC = -2.0 / el.radius;
    } else {
      const R = el.radius ?? Infinity;
      eC = Number.isFinite(R) ? (el.n1 - el.n2) / (el.n2 * R) : 0;
      eD = el.n1 / el.n2;
    }
    const nA = eA * A + eB * C;
    const nB = eA * B + eB * D;
    const nC = eC * A + eD * C;
    const nD = eC * B + eD * D;
    A = nA;
    B = nB;
    C = nC;
    D = nD;
  }

  return { A, B, C, D };
}

/** Propagates a paraxial ray (height y, angle theta) through an optical bench. */
export function traceParaxialRay(
  y0: number,
  theta0: number,
  elements: readonly OpticalElement[],
): { y: number; theta: number; abcd: AbcdMatrix } {
  const abcd = computeAbcdSystem(elements);
  return {
    y: abcd.A * y0 + abcd.B * theta0,
    theta: abcd.C * y0 + abcd.D * theta0,
    abcd,
  };
}
