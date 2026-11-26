// SPDX-License-Identifier: AGPL-3.0-or-later

import { CompressibleFieldArena, MIN_DENSITY, MIN_PRESSURE } from "./compressible-arena.js";

export type RiemannFluxType = "hllc" | "roe";
export type SlopeLimiterType = "minmod" | "venkatakrishnan" | "none";
export type BoundaryConditionType = "extrapolation" | "periodic" | "reflective";
export type TurbulenceModelType = "none" | "spalart-allmaras" | "ddes";

export interface CompressibleFvmOptions {
  /** Approximate Riemann solver (default "hllc"). */
  flux?: RiemannFluxType | undefined;
  /** MUSCL slope limiter (default "minmod"). */
  limiter?: SlopeLimiterType | undefined;
  /** Spatial reconstruction order: 1 (piecewise constant) or 2 (MUSCL) (default 2). */
  reconstructionOrder?: 1 | 2 | undefined;
  /** Boundary condition along X (default "extrapolation"). */
  bcX?: BoundaryConditionType | undefined;
  /** Boundary condition along Y (default "extrapolation"). */
  bcY?: BoundaryConditionType | undefined;
  /** Boundary condition along Z (default "extrapolation"). */
  bcZ?: BoundaryConditionType | undefined;
  /** CFL number for explicit SSP-RK3 timestepping (default 0.45). */
  cfl?: number | undefined;
  /** Enable viscous Navier-Stokes fluxes with Sutherland viscosity (default false). */
  viscous?: boolean | undefined;
  /** Laminar Prandtl number (default 0.72). */
  prandtl?: number | undefined;
  /** Turbulent Prandtl number (default 0.9). */
  prandtlTurb?: number | undefined;
  /** Sutherland reference viscosity mu_ref [Pa*s] (default 1.716e-5). */
  sutherlandMuRef?: number | undefined;
  /** Sutherland reference temperature T_ref [K] (default 273.15). */
  sutherlandTRef?: number | undefined;
  /** Sutherland constant S [K] (default 110.4). */
  sutherlandS?: number | undefined;
  /** Turbulence / hybrid RANS-LES model (default "none"). */
  turbulence?: TurbulenceModelType | undefined;
  /** Optional wall distance field [m] of length totalCells for SA / DDES. */
  wallDistance?: Float64Array | undefined;
  /** Harten entropy fix parameter delta as fraction of Roe sound speed (default 0.1). */
  entropyFixDelta?: number | undefined;
  /** Venkatakrishnan limiter constant K (default 1.0). */
  venkatK?: number | undefined;
}

export interface GmresOptions {
  /** Maximum total iterations (default 200). */
  maxIter?: number | undefined;
  /** Krylov subspace restart size m (default 30). */
  restart?: number | undefined;
  /** Relative residual convergence tolerance (default 1e-10). */
  tol?: number | undefined;
  /** Absolute residual convergence tolerance (default 1e-14). */
  absTol?: number | undefined;
  /** Optional right preconditioner M^{-1} v -> out. */
  preconditioner?: ((v: Float64Array, out: Float64Array) => void) | undefined;
}

export interface GmresResult {
  x: Float64Array;
  iterations: number;
  residualNorm: number;
  relativeResidual: number;
  converged: boolean;
}

// Spalart-Allmaras standard constants
const SA_CB1 = 0.1355;
const SA_CB2 = 0.622;
const SA_SIGMA = 2.0 / 3.0;
const SA_KAPPA = 0.41;
const SA_CW1 = SA_CB1 / (SA_KAPPA * SA_KAPPA) + (1.0 + SA_CB2) / SA_SIGMA;
const SA_CW2 = 0.3;
const SA_CW3 = 2.0;
const SA_CV1 = 7.1;
const SA_CDES = 0.65;

/**
 * Sutherland's dynamic viscosity law for ideal gases:
 * mu(T) = muRef * (T / TRef)^(3/2) * (TRef + S) / (T + S).
 */
export function sutherlandViscosity(
  T: number,
  muRef: number = 1.716e-5,
  TRef: number = 273.15,
  S: number = 110.4,
): number {
  const Ts = Math.max(T, 1.0);
  const ratio = Ts / TRef;
  return muRef * ratio * Math.sqrt(ratio) * ((TRef + S) / (Ts + S));
}

/** Minmod slope limiter. */
export function minmod(a: number, b: number): number {
  if (a * b <= 0.0) return 0.0;
  return Math.abs(a) < Math.abs(b) ? a : b;
}

/**
 * Venkatakrishnan smooth slope limiter returning the limited slope factor phi in [0, 1].
 * Given undivided differences deltaPlus (u_{i+1} - u_i) and deltaMinus (u_i - u_{i-1}),
 * returns limited increment suitable for MUSCL reconstruction.
 */
export function venkatakrishnanLimiter(deltaPlus: number, deltaMinus: number, epsSq: number = 1e-6): number {
  if (deltaPlus * deltaMinus <= 0.0) return 0.0;
  const dp2 = deltaPlus * deltaPlus;
  const dm2 = deltaMinus * deltaMinus;
  const num = (dp2 + epsSq) * deltaMinus + 2.0 * dm2 * deltaPlus;
  const den = dp2 + 2.0 * dm2 + deltaPlus * deltaMinus + epsSq;
  if (Math.abs(den) < 1e-30) return 0.0;
  return num / den;
}

/**
 * Compute 3D HLLC (Harten-Lax-van Leer-Contact) approximate Riemann flux
 * along unit face normal `(nx, ny, nz)`.
 *
 * `uL` and `uR` are conserved state vectors `[rho, rhoU, rhoV, rhoW, rhoE (, rhoNuTilde)]`.
 * Writes flux into `out`.
 */
export function computeHllcFlux(
  uL: Float64Array,
  uR: Float64Array,
  nx: number,
  ny: number,
  nz: number,
  gamma: number,
  out: Float64Array,
): void {
  const gm1 = gamma - 1.0;

  const rhoL = Math.max(uL[0] ?? MIN_DENSITY, MIN_DENSITY);
  const uLx = (uL[1] ?? 0) / rhoL;
  const uLy = (uL[2] ?? 0) / rhoL;
  const uLz = (uL[3] ?? 0) / rhoL;
  const rEL = uL[4] ?? 0;
  const keL = 0.5 * rhoL * (uLx * uLx + uLy * uLy + uLz * uLz);
  const pL = Math.max(gm1 * (rEL - keL), MIN_PRESSURE);
  const cL = Math.sqrt((gamma * pL) / rhoL);
  const qnL = uLx * nx + uLy * ny + uLz * nz;
  const HL = (rEL + pL) / rhoL;

  const rhoR = Math.max(uR[0] ?? MIN_DENSITY, MIN_DENSITY);
  const uRx = (uR[1] ?? 0) / rhoR;
  const uRy = (uR[2] ?? 0) / rhoR;
  const uRz = (uR[3] ?? 0) / rhoR;
  const rER = uR[4] ?? 0;
  const keR = 0.5 * rhoR * (uRx * uRx + uRy * uRy + uRz * uRz);
  const pR = Math.max(gm1 * (rER - keR), MIN_PRESSURE);
  const cR = Math.sqrt((gamma * pR) / rhoR);
  const qnR = uRx * nx + uRy * ny + uRz * nz;
  const HR = (rER + pR) / rhoR;

  // Roe-averaged wave speed bounds (Einfeldt / Davis)
  const srL = Math.sqrt(rhoL);
  const srR = Math.sqrt(rhoR);
  const invSr = 1.0 / (srL + srR);
  const uT = (srL * uLx + srR * uRx) * invSr;
  const vT = (srL * uLy + srR * uRy) * invSr;
  const wT = (srL * uLz + srR * uRz) * invSr;
  const HT = (srL * HL + srR * HR) * invSr;
  const q2T = uT * uT + vT * vT + wT * wT;
  const cT = Math.sqrt(Math.max(gm1 * (HT - 0.5 * q2T), 1e-12));
  const qnT = uT * nx + vT * ny + wT * nz;

  const sL = Math.min(qnL - cL, qnT - cT);
  const sR = Math.max(qnR + cR, qnT + cT);

  const hasSa = out.length >= 6 && uL.length >= 6 && uR.length >= 6;

  if (sL >= 0.0) {
    out[0] = rhoL * qnL;
    out[1] = rhoL * uLx * qnL + pL * nx;
    out[2] = rhoL * uLy * qnL + pL * ny;
    out[3] = rhoL * uLz * qnL + pL * nz;
    out[4] = (rEL + pL) * qnL;
    if (hasSa) out[5] = (uL[5] ?? 0) * qnL;
    return;
  }

  if (sR <= 0.0) {
    out[0] = rhoR * qnR;
    out[1] = rhoR * uRx * qnR + pR * nx;
    out[2] = rhoR * uRy * qnR + pR * ny;
    out[3] = rhoR * uRz * qnR + pR * nz;
    out[4] = (rER + pR) * qnR;
    if (hasSa) out[5] = (uR[5] ?? 0) * qnR;
    return;
  }

  const denom = rhoL * (sL - qnL) - rhoR * (sR - qnR);
  const sStar =
    Math.abs(denom) > 1e-30 ? (pR - pL + rhoL * qnL * (sL - qnL) - rhoR * qnR * (sR - qnR)) / denom : 0.5 * (qnL + qnR);

  if (sStar >= 0.0) {
    const fL0 = rhoL * qnL;
    const fL1 = rhoL * uLx * qnL + pL * nx;
    const fL2 = rhoL * uLy * qnL + pL * ny;
    const fL3 = rhoL * uLz * qnL + pL * nz;
    const fL4 = (rEL + pL) * qnL;

    const factor = (rhoL * (sL - qnL)) / (sL - sStar);
    const uStar0 = factor;
    const uStar1 = factor * (uLx + (sStar - qnL) * nx);
    const uStar2 = factor * (uLy + (sStar - qnL) * ny);
    const uStar3 = factor * (uLz + (sStar - qnL) * nz);
    const uStar4 = factor * (rEL / rhoL + (sStar - qnL) * (sStar + pL / (rhoL * (sL - qnL))));

    out[0] = fL0 + sL * (uStar0 - rhoL);
    out[1] = fL1 + sL * (uStar1 - rhoL * uLx);
    out[2] = fL2 + sL * (uStar2 - rhoL * uLy);
    out[3] = fL3 + sL * (uStar3 - rhoL * uLz);
    out[4] = fL4 + sL * (uStar4 - rEL);
    if (hasSa) {
      const nuL = (uL[5] ?? 0) / rhoL;
      out[5] = factor * nuL * sStar;
    }
  } else {
    const fR0 = rhoR * qnR;
    const fR1 = rhoR * uRx * qnR + pR * nx;
    const fR2 = rhoR * uRy * qnR + pR * ny;
    const fR3 = rhoR * uRz * qnR + pR * nz;
    const fR4 = (rER + pR) * qnR;

    const factor = (rhoR * (sR - qnR)) / (sR - sStar);
    const uStar0 = factor;
    const uStar1 = factor * (uRx + (sStar - qnR) * nx);
    const uStar2 = factor * (uRy + (sStar - qnR) * ny);
    const uStar3 = factor * (uRz + (sStar - qnR) * nz);
    const uStar4 = factor * (rER / rhoR + (sStar - qnR) * (sStar + pR / (rhoR * (sR - qnR))));

    out[0] = fR0 + sR * (uStar0 - rhoR);
    out[1] = fR1 + sR * (uStar1 - rhoR * uRx);
    out[2] = fR2 + sR * (uStar2 - rhoR * uRy);
    out[3] = fR3 + sR * (uStar3 - rhoR * uRz);
    out[4] = fR4 + sR * (uStar4 - rER);
    if (hasSa) {
      const nuR = (uR[5] ?? 0) / rhoR;
      out[5] = factor * nuR * sStar;
    }
  }
}

/**
 * Compute 3D Roe approximate Riemann flux with Harten's entropy fix
 * along unit face normal `(nx, ny, nz)`.
 */
export function computeRoeFlux(
  uL: Float64Array,
  uR: Float64Array,
  nx: number,
  ny: number,
  nz: number,
  gamma: number,
  out: Float64Array,
  entropyFixDelta: number = 0.1,
): void {
  const gm1 = gamma - 1.0;

  const rhoL = Math.max(uL[0] ?? MIN_DENSITY, MIN_DENSITY);
  const uLx = (uL[1] ?? 0) / rhoL;
  const uLy = (uL[2] ?? 0) / rhoL;
  const uLz = (uL[3] ?? 0) / rhoL;
  const rEL = uL[4] ?? 0;
  const pL = Math.max(gm1 * (rEL - 0.5 * rhoL * (uLx * uLx + uLy * uLy + uLz * uLz)), MIN_PRESSURE);
  const qnL = uLx * nx + uLy * ny + uLz * nz;
  const HL = (rEL + pL) / rhoL;

  const rhoR = Math.max(uR[0] ?? MIN_DENSITY, MIN_DENSITY);
  const uRx = (uR[1] ?? 0) / rhoR;
  const uRy = (uR[2] ?? 0) / rhoR;
  const uRz = (uR[3] ?? 0) / rhoR;
  const rER = uR[4] ?? 0;
  const pR = Math.max(gm1 * (rER - 0.5 * rhoR * (uRx * uRx + uRy * uRy + uRz * uRz)), MIN_PRESSURE);
  const qnR = uRx * nx + uRy * ny + uRz * nz;
  const HR = (rER + pR) / rhoR;

  // Physical fluxes
  const fL0 = rhoL * qnL;
  const fL1 = rhoL * uLx * qnL + pL * nx;
  const fL2 = rhoL * uLy * qnL + pL * ny;
  const fL3 = rhoL * uLz * qnL + pL * nz;
  const fL4 = (rEL + pL) * qnL;

  const fR0 = rhoR * qnR;
  const fR1 = rhoR * uRx * qnR + pR * nx;
  const fR2 = rhoR * uRy * qnR + pR * ny;
  const fR3 = rhoR * uRz * qnR + pR * nz;
  const fR4 = (rER + pR) * qnR;

  // Roe averages
  const srL = Math.sqrt(rhoL);
  const srR = Math.sqrt(rhoR);
  const invSr = 1.0 / (srL + srR);
  const rhoT = srL * srR;
  const uT = (srL * uLx + srR * uRx) * invSr;
  const vT = (srL * uLy + srR * uRy) * invSr;
  const wT = (srL * uLz + srR * uRz) * invSr;
  const HT = (srL * HL + srR * HR) * invSr;
  const q2T = uT * uT + vT * vT + wT * wT;
  const c2T = Math.max(gm1 * (HT - 0.5 * q2T), 1e-12);
  const cT = Math.sqrt(c2T);
  const qnT = uT * nx + vT * ny + wT * nz;

  // Harten entropy fix on eigenvalues
  const delta = entropyFixDelta * cT;
  const harten = (lam: number): number => {
    const a = Math.abs(lam);
    return a < delta && delta > 0.0 ? (a * a + delta * delta) / (2.0 * delta) : a;
  };

  const lam1 = harten(qnT - cT);
  const lam2 = harten(qnT);
  const lam5 = harten(qnT + cT);

  // Wave jumps
  const dRho = rhoR - rhoL;
  const dP = pR - pL;
  const dU = uRx - uLx;
  const dV = uRy - uLy;
  const dW = uRz - uLz;
  const dQn = qnR - qnL;

  const alpha1 = (dP - rhoT * cT * dQn) / (2.0 * c2T);
  const alpha5 = (dP + rhoT * cT * dQn) / (2.0 * c2T);
  const alpha2 = dRho - dP / c2T;

  const c1 = lam1 * alpha1;
  const c2 = lam2 * alpha2;
  const c5 = lam5 * alpha5;
  const cs = lam2 * rhoT;

  const diss0 = c1 + c2 + c5;
  const diss1 = c1 * (uT - cT * nx) + c2 * uT + c5 * (uT + cT * nx) + cs * (dU - dQn * nx);
  const diss2 = c1 * (vT - cT * ny) + c2 * vT + c5 * (vT + cT * ny) + cs * (dV - dQn * ny);
  const diss3 = c1 * (wT - cT * nz) + c2 * wT + c5 * (wT + cT * nz) + cs * (dW - dQn * nz);
  const diss4 =
    c1 * (HT - cT * qnT) + c2 * (0.5 * q2T) + c5 * (HT + cT * qnT) + cs * (uT * dU + vT * dV + wT * dW - qnT * dQn);

  out[0] = 0.5 * (fL0 + fR0 - diss0);
  out[1] = 0.5 * (fL1 + fR1 - diss1);
  out[2] = 0.5 * (fL2 + fR2 - diss2);
  out[3] = 0.5 * (fL3 + fR3 - diss3);
  out[4] = 0.5 * (fL4 + fR4 - diss4);

  if (out.length >= 6 && uL.length >= 6 && uR.length >= 6) {
    const sL = uL[5] ?? 0;
    const sR = uR[5] ?? 0;
    out[5] = qnT >= 0.0 ? sL * qnT : sR * qnT;
  }
}

/**
 * Restarted Matrix-Free GMRES(m) solver for linear systems `A x = b`
 * using Modified Gram-Schmidt orthogonalization and Givens rotations.
 */
export function solveMatrixFreeGmres(
  matvec: (v: Float64Array, out: Float64Array) => void,
  b: Float64Array,
  x0?: Float64Array | undefined,
  options: GmresOptions = {},
): GmresResult {
  const n = b.length;
  const maxIter = options.maxIter ?? Math.min(200, Math.max(n * 2, 50));
  const restart = Math.max(1, Math.min(options.restart ?? 30, n, maxIter));
  const tol = options.tol ?? 1e-10;
  const absTol = options.absTol ?? 1e-14;
  const precond = options.preconditioner;

  const x = new Float64Array(n);
  if (x0) {
    x.set(x0);
  }

  let bNorm = 0.0;
  for (let i = 0; i < n; i++) {
    const bi = b[i] ?? 0;
    bNorm += bi * bi;
  }
  bNorm = Math.sqrt(bNorm);
  if (bNorm === 0.0) {
    return { x, iterations: 0, residualNorm: 0.0, relativeResidual: 0.0, converged: true };
  }

  const r = new Float64Array(n);
  const w = new Float64Array(n);
  const z = new Float64Array(n);
  const V: Float64Array[] = Array.from({ length: restart + 1 }, () => new Float64Array(n));
  const Z: Float64Array[] | undefined = precond
    ? Array.from({ length: restart }, () => new Float64Array(n))
    : undefined;
  const H = new Float64Array((restart + 1) * restart);
  const cs = new Float64Array(restart);
  const sn = new Float64Array(restart);
  const g = new Float64Array(restart + 1);
  const y = new Float64Array(restart);

  let totalIter = 0;
  let resNorm = bNorm;
  let converged = false;

  while (totalIter < maxIter) {
    // r = b - A * x
    matvec(x, w);
    let beta2 = 0.0;
    for (let i = 0; i < n; i++) {
      const ri = (b[i] ?? 0) - (w[i] ?? 0);
      r[i] = ri;
      beta2 += ri * ri;
    }
    const beta = Math.sqrt(beta2);
    resNorm = beta;
    if (resNorm <= Math.max(tol * bNorm, absTol)) {
      converged = true;
      break;
    }

    const v0 = V[0]!;
    const invBeta = 1.0 / beta;
    for (let i = 0; i < n; i++) {
      v0[i] = (r[i] ?? 0) * invBeta;
    }
    g.fill(0.0);
    g[0] = beta;
    H.fill(0.0);

    let kSteps = 0;
    for (let j = 0; j < restart && totalIter < maxIter; j++) {
      const vj = V[j]!;
      if (precond && Z) {
        const zj = Z[j]!;
        precond(vj, zj);
        matvec(zj, w);
      } else {
        matvec(vj, w);
      }

      // Modified Gram-Schmidt with reorthogonalization for numerical stability
      for (let i = 0; i <= j; i++) {
        const vi = V[i]!;
        let hij = 0.0;
        for (let idx = 0; idx < n; idx++) {
          hij += (w[idx] ?? 0) * (vi[idx] ?? 0);
        }
        H[i * restart + j] = hij;
        for (let idx = 0; idx < n; idx++) {
          w[idx] = (w[idx] ?? 0) - hij * (vi[idx] ?? 0);
        }
      }

      let hNext2 = 0.0;
      for (let idx = 0; idx < n; idx++) {
        const wi = w[idx] ?? 0;
        hNext2 += wi * wi;
      }
      const hNext = Math.sqrt(hNext2);
      H[(j + 1) * restart + j] = hNext;

      if (hNext > 1e-30) {
        const vNext = V[j + 1]!;
        const invH = 1.0 / hNext;
        for (let idx = 0; idx < n; idx++) {
          vNext[idx] = (w[idx] ?? 0) * invH;
        }
      }

      // Apply previous Givens rotations to column j of H
      for (let i = 0; i < j; i++) {
        const csi = cs[i] ?? 1.0;
        const sni = sn[i] ?? 0.0;
        const hi = H[i * restart + j] ?? 0.0;
        const hi1 = H[(i + 1) * restart + j] ?? 0.0;
        H[i * restart + j] = csi * hi + sni * hi1;
        H[(i + 1) * restart + j] = -sni * hi + csi * hi1;
      }

      // Compute new Givens rotation for (j, j+1)
      const hjj = H[j * restart + j] ?? 0.0;
      const hj1j = H[(j + 1) * restart + j] ?? 0.0;
      const denom = Math.hypot(hjj, hj1j);
      if (denom > 1e-30) {
        cs[j] = hjj / denom;
        sn[j] = hj1j / denom;
      } else {
        cs[j] = 1.0;
        sn[j] = 0.0;
      }
      H[j * restart + j] = (cs[j] ?? 1.0) * hjj + (sn[j] ?? 0.0) * hj1j;
      H[(j + 1) * restart + j] = 0.0;

      const gj = g[j] ?? 0.0;
      g[j] = (cs[j] ?? 1.0) * gj;
      g[j + 1] = -(sn[j] ?? 0.0) * gj;

      totalIter++;
      kSteps = j + 1;
      resNorm = Math.abs(g[j + 1] ?? 0.0);

      if (resNorm <= Math.max(tol * bNorm, absTol) || hNext <= 1e-30) {
        converged = resNorm <= Math.max(tol * bNorm, absTol);
        break;
      }
    }

    // Back-substitution for upper triangular H(0..kSteps-1, 0..kSteps-1)
    y.fill(0.0);
    for (let i = kSteps - 1; i >= 0; i--) {
      let sum = g[i] ?? 0.0;
      for (let j = i + 1; j < kSteps; j++) {
        sum -= (H[i * restart + j] ?? 0.0) * (y[j] ?? 0.0);
      }
      const diag = H[i * restart + i] ?? 0.0;
      y[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0.0;
    }

    // Update solution x += V_k * y (or Z_k * y when right-preconditioned)
    for (let j = 0; j < kSteps; j++) {
      const basis = Z ? Z[j]! : V[j]!;
      const yj = y[j] ?? 0.0;
      for (let idx = 0; idx < n; idx++) {
        x[idx] = (x[idx] ?? 0.0) + yj * (basis[idx] ?? 0.0);
      }
    }

    if (converged) {
      break;
    }
  }

  // Final true residual check
  matvec(x, z);
  let trueRes2 = 0.0;
  for (let i = 0; i < n; i++) {
    const diff = (b[i] ?? 0.0) - (z[i] ?? 0.0);
    trueRes2 += diff * diff;
  }
  const trueRes = Math.sqrt(trueRes2);
  const relRes = trueRes / bNorm;
  return {
    x,
    iterations: totalIter,
    residualNorm: trueRes,
    relativeResidual: relRes,
    converged: trueRes <= Math.max(tol * bNorm, absTol),
  };
}

/**
 * 3D Structured Cartesian Compressible Navier-Stokes Finite-Volume Solver.
 *
 * Features:
 * - Roe (with Harten entropy fix) and HLLC approximate Riemann solvers
 * - 2nd-order MUSCL reconstruction with minmod / Venkatakrishnan slope limiters
 * - Viscous stress tensor & Fourier heat conduction with Sutherland viscosity law
 * - Optional Spalart-Allmaras / DDES turbulence transport & shielding
 * - Explicit SSP-RK3 time integration & Matrix-Free GMRES implicit pseudo-timestepper
 */
export class CompressibleFvmSolver {
  public readonly arena: CompressibleFieldArena;
  public readonly fluxType: RiemannFluxType;
  public readonly limiterType: SlopeLimiterType;
  public readonly reconstructionOrder: 1 | 2;
  public readonly bcX: BoundaryConditionType;
  public readonly bcY: BoundaryConditionType;
  public readonly bcZ: BoundaryConditionType;
  public readonly cfl: number;
  public readonly viscous: boolean;
  public readonly prandtl: number;
  public readonly prandtlTurb: number;
  public readonly sutherlandMuRef: number;
  public readonly sutherlandTRef: number;
  public readonly sutherlandS: number;
  public readonly turbulence: TurbulenceModelType;
  public readonly wallDistance: Float64Array | undefined;
  public readonly entropyFixDelta: number;
  public readonly venkatK: number;

  private readonly u0: Float64Array;
  private readonly u1: Float64Array;
  private readonly rhs: Float64Array;
  private readonly primLL: Float64Array;
  private readonly primL: Float64Array;
  private readonly primR: Float64Array;
  private readonly primRR: Float64Array;
  private readonly consL: Float64Array;
  private readonly consR: Float64Array;
  private readonly faceFlux: Float64Array;

  constructor(arena: CompressibleFieldArena, options: CompressibleFvmOptions = {}) {
    this.arena = arena;
    this.fluxType = options.flux ?? "hllc";
    this.limiterType = options.limiter ?? "minmod";
    this.reconstructionOrder = options.reconstructionOrder ?? 2;
    this.bcX = options.bcX ?? "extrapolation";
    this.bcY = options.bcY ?? "extrapolation";
    this.bcZ = options.bcZ ?? "extrapolation";
    this.cfl = options.cfl ?? 0.45;
    this.viscous = options.viscous ?? false;
    this.prandtl = options.prandtl ?? 0.72;
    this.prandtlTurb = options.prandtlTurb ?? 0.9;
    this.sutherlandMuRef = options.sutherlandMuRef ?? 1.716e-5;
    this.sutherlandTRef = options.sutherlandTRef ?? 273.15;
    this.sutherlandS = options.sutherlandS ?? 110.4;
    this.turbulence = options.turbulence ?? "none";
    this.wallDistance = options.wallDistance;
    this.entropyFixDelta = options.entropyFixDelta ?? 0.1;
    this.venkatK = options.venkatK ?? 1.0;

    const totalLen = arena.nVars * arena.totalCells;
    this.u0 = new Float64Array(totalLen);
    this.u1 = new Float64Array(totalLen);
    this.rhs = new Float64Array(totalLen);

    const nv = arena.nVars;
    this.primLL = new Float64Array(nv);
    this.primL = new Float64Array(nv);
    this.primR = new Float64Array(nv);
    this.primRR = new Float64Array(nv);
    this.consL = new Float64Array(nv);
    this.consR = new Float64Array(nv);
    this.faceFlux = new Float64Array(nv);
  }

  /** Compute stable CFL timestep from maximum acoustic + convective wave speeds (and viscous diffusion). */
  public computeCflTimestep(state: Float64Array = this.arena.stateBuffer): number {
    const { nx, ny, nz, dx, dy, dz, totalCells, gamma, gasConstantR } = this.arena;
    const gm1 = gamma - 1.0;
    const invDx = nx > 1 ? 1.0 / dx : 0.0;
    const invDy = ny > 1 ? 1.0 / dy : 0.0;
    const invDz = nz > 1 ? 1.0 / dz : 0.0;
    const invDx2 = nx > 1 ? 1.0 / (dx * dx) : 0.0;
    const invDy2 = ny > 1 ? 1.0 / (dy * dy) : 0.0;
    const invDz2 = nz > 1 ? 1.0 / (dz * dz) : 0.0;

    let maxRate = 1e-12;
    for (let idx = 0; idx < totalCells; idx++) {
      const rho = Math.max(state[idx] ?? MIN_DENSITY, MIN_DENSITY);
      const u = (state[totalCells + idx] ?? 0) / rho;
      const v = (state[2 * totalCells + idx] ?? 0) / rho;
      const w = (state[3 * totalCells + idx] ?? 0) / rho;
      const rE = state[4 * totalCells + idx] ?? 0;
      const p = Math.max(gm1 * (rE - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);
      const c = Math.sqrt((gamma * p) / rho);

      let rate = (Math.abs(u) + c) * invDx + (Math.abs(v) + c) * invDy + (Math.abs(w) + c) * invDz;

      if (this.viscous) {
        const T = p / (rho * gasConstantR);
        const mu = sutherlandViscosity(T, this.sutherlandMuRef, this.sutherlandTRef, this.sutherlandS);
        const nuEff = (mu / rho) * (gamma / this.prandtl);
        rate += 2.0 * nuEff * (invDx2 + invDy2 + invDz2);
      }

      if (rate > maxRate) maxRate = rate;
    }

    return this.cfl / maxRate;
  }

  /** Fetch primitive state `[rho, u, v, w, p (, nuTilde)]` with boundary condition handling. */
  private loadPrimitiveWithBc(state: Float64Array, i: number, j: number, k: number, out: Float64Array): void {
    const { nx, ny, nz, totalCells, gamma, nVars } = this.arena;
    const gm1 = gamma - 1.0;

    let ci = i;
    let cj = j;
    let ck = k;
    let flipU = 1.0;
    let flipV = 1.0;
    let flipW = 1.0;

    if (ci < 0 || ci >= nx) {
      if (this.bcX === "periodic") {
        ci = ((ci % nx) + nx) % nx;
      } else {
        if (this.bcX === "reflective") flipU = -1.0;
        ci = ci < 0 ? 0 : nx - 1;
      }
    }
    if (cj < 0 || cj >= ny) {
      if (this.bcY === "periodic") {
        cj = ((cj % ny) + ny) % ny;
      } else {
        if (this.bcY === "reflective") flipV = -1.0;
        cj = cj < 0 ? 0 : ny - 1;
      }
    }
    if (ck < 0 || ck >= nz) {
      if (this.bcZ === "periodic") {
        ck = ((ck % nz) + nz) % nz;
      } else {
        if (this.bcZ === "reflective") flipW = -1.0;
        ck = ck < 0 ? 0 : nz - 1;
      }
    }

    const idx = (ck * ny + cj) * nx + ci;
    const rho = Math.max(state[idx] ?? MIN_DENSITY, MIN_DENSITY);
    const invRho = 1.0 / rho;
    const u = (state[totalCells + idx] ?? 0) * invRho;
    const v = (state[2 * totalCells + idx] ?? 0) * invRho;
    const w = (state[3 * totalCells + idx] ?? 0) * invRho;
    const rE = state[4 * totalCells + idx] ?? 0;
    const p = Math.max(gm1 * (rE - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);

    out[0] = rho;
    out[1] = u * flipU;
    out[2] = v * flipV;
    out[3] = w * flipW;
    out[4] = p;
    if (nVars >= 6) {
      out[5] = Math.max((state[5 * totalCells + idx] ?? 0) * invRho, 0.0);
    }
  }

  /** Reconstruct left/right conserved face states from 4-point primitive stencil. */
  private reconstructFaceStates(h: number): void {
    const { nVars, gamma } = this.arena;
    const invGm1 = 1.0 / (gamma - 1.0);
    const epsSq = Math.pow(this.venkatK * h, 3.0);

    let rhoL = this.primL[0]!;
    let uL = this.primL[1]!;
    let vL = this.primL[2]!;
    let wL = this.primL[3]!;
    let pL = this.primL[4]!;
    let nuL = nVars >= 6 ? this.primL[5]! : 0.0;

    let rhoR = this.primR[0]!;
    let uR = this.primR[1]!;
    let vR = this.primR[2]!;
    let wR = this.primR[3]!;
    let pR = this.primR[4]!;
    let nuR = nVars >= 6 ? this.primR[5]! : 0.0;

    if (this.reconstructionOrder === 2 && this.limiterType !== "none") {
      const limit = (dp: number, dm: number): number =>
        this.limiterType === "venkatakrishnan" ? venkatakrishnanLimiter(dp, dm, epsSq) : minmod(dp, dm);

      const recL = (m: number): number =>
        this.primL[m]! + 0.5 * limit(this.primR[m]! - this.primL[m]!, this.primL[m]! - this.primLL[m]!);
      const recR = (m: number): number =>
        this.primR[m]! - 0.5 * limit(this.primRR[m]! - this.primR[m]!, this.primR[m]! - this.primL[m]!);

      rhoL = Math.max(recL(0), MIN_DENSITY);
      uL = recL(1);
      vL = recL(2);
      wL = recL(3);
      pL = Math.max(recL(4), MIN_PRESSURE);
      if (nVars >= 6) nuL = Math.max(recL(5), 0.0);

      rhoR = Math.max(recR(0), MIN_DENSITY);
      uR = recR(1);
      vR = recR(2);
      wR = recR(3);
      pR = Math.max(recR(4), MIN_PRESSURE);
      if (nVars >= 6) nuR = Math.max(recR(5), 0.0);
    }

    this.consL[0] = rhoL;
    this.consL[1] = rhoL * uL;
    this.consL[2] = rhoL * vL;
    this.consL[3] = rhoL * wL;
    this.consL[4] = pL * invGm1 + 0.5 * rhoL * (uL * uL + vL * vL + wL * wL);
    if (nVars >= 6) this.consL[5] = rhoL * nuL;

    this.consR[0] = rhoR;
    this.consR[1] = rhoR * uR;
    this.consR[2] = rhoR * vR;
    this.consR[3] = rhoR * wR;
    this.consR[4] = pR * invGm1 + 0.5 * rhoR * (uR * uR + vR * vR + wR * wR);
    if (nVars >= 6) this.consR[5] = rhoR * nuR;
  }

  /** Add viscous Navier-Stokes flux (stress tensor + heat flux + SA diffusion) to `this.faceFlux`. */
  private addViscousFaceFlux(nxDir: number, nyDir: number, nzDir: number, h: number): void {
    const { gamma, gasConstantR, nVars } = this.arena;
    const invH = 1.0 / h;

    const rhoL = this.primL[0]!;
    const uL = this.primL[1]!;
    const vL = this.primL[2]!;
    const wL = this.primL[3]!;
    const pL = this.primL[4]!;

    const rhoR = this.primR[0]!;
    const uR = this.primR[1]!;
    const vR = this.primR[2]!;
    const wR = this.primR[3]!;
    const pR = this.primR[4]!;

    const rhoF = 0.5 * (rhoL + rhoR);
    const uF = 0.5 * (uL + uR);
    const vF = 0.5 * (vL + vR);
    const wF = 0.5 * (wL + wR);

    const TL = pL / (rhoL * gasConstantR);
    const TR = pR / (rhoR * gasConstantR);
    const TF = 0.5 * (TL + TR);

    const muLam = sutherlandViscosity(TF, this.sutherlandMuRef, this.sutherlandTRef, this.sutherlandS);

    let muTurb = 0.0;
    let nuTildeF = 0.0;
    if (this.turbulence !== "none" && nVars >= 6) {
      nuTildeF = 0.5 * ((this.primL[5] ?? 0) + (this.primR[5] ?? 0));
      const nuLam = muLam / Math.max(rhoF, MIN_DENSITY);
      const chi = nuTildeF / Math.max(nuLam, 1e-16);
      const chi3 = chi * chi * chi;
      const fv1 = chi3 / (chi3 + SA_CV1 * SA_CV1 * SA_CV1);
      muTurb = rhoF * nuTildeF * fv1;
    }

    const muEff = muLam + muTurb;
    const cp = (gamma * gasConstantR) / (gamma - 1.0);
    const kEff = cp * (muLam / this.prandtl + muTurb / this.prandtlTurb);

    // Normal directional derivatives across the face
    const dUn = (uR - uL) * invH;
    const dVn = (vR - vL) * invH;
    const dWn = (wR - wL) * invH;
    const dTn = (TR - TL) * invH;

    // Stress tensor components projected onto face normal (thin-layer / orthogonal form)
    const divN = dUn * nxDir + dVn * nyDir + dWn * nzDir;
    const tauX = muEff * (dUn + (1.0 / 3.0) * divN * nxDir);
    const tauY = muEff * (dVn + (1.0 / 3.0) * divN * nyDir);
    const tauZ = muEff * (dWn + (1.0 / 3.0) * divN * nzDir);
    const qHeat = -kEff * dTn;

    // Subtract viscous flux from total convective flux F_total = F_inv - F_visc
    this.faceFlux[1] = (this.faceFlux[1] ?? 0) - tauX;
    this.faceFlux[2] = (this.faceFlux[2] ?? 0) - tauY;
    this.faceFlux[3] = (this.faceFlux[3] ?? 0) - tauZ;
    this.faceFlux[4] = (this.faceFlux[4] ?? 0) - (uF * tauX + vF * tauY + wF * tauZ - qHeat);

    if (this.turbulence !== "none" && nVars >= 6) {
      const dNuN = ((this.primR[5] ?? 0) - (this.primL[5] ?? 0)) * invH;
      const nuLam = muLam / Math.max(rhoF, MIN_DENSITY);
      const diffSa = ((rhoF * (nuLam + nuTildeF)) / SA_SIGMA) * dNuN;
      this.faceFlux[5] = (this.faceFlux[5] ?? 0) - diffSa;
    }
  }

  /** Add Spalart-Allmaras / DDES turbulence production and destruction source terms. */
  private addSpalartAllmarasSources(state: Float64Array, rhs: Float64Array): void {
    const { nx, ny, nz, dx, dy, dz, totalCells, gamma, gasConstantR, nVars } = this.arena;
    if (this.turbulence === "none" || nVars < 6) return;

    const gm1 = gamma - 1.0;
    const deltaMax = Math.max(dx, ny > 1 ? dy : dx, nz > 1 ? dz : dx);

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = (k * ny + j) * nx + i;
          const rho = Math.max(state[idx] ?? MIN_DENSITY, MIN_DENSITY);
          const u = (state[totalCells + idx] ?? 0) / rho;
          const v = (state[2 * totalCells + idx] ?? 0) / rho;
          const w = (state[3 * totalCells + idx] ?? 0) / rho;
          const rE = state[4 * totalCells + idx] ?? 0;
          const p = Math.max(gm1 * (rE - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);
          const T = p / (rho * gasConstantR);
          const muLam = sutherlandViscosity(T, this.sutherlandMuRef, this.sutherlandTRef, this.sutherlandS);
          const nuLam = muLam / rho;
          const nuTilde = Math.max((state[5 * totalCells + idx] ?? 0) / rho, 1e-12);

          // Approximate velocity gradient magnitude for vorticity/strain
          const iL = Math.max(i - 1, 0);
          const iR = Math.min(i + 1, nx - 1);
          const idxL = (k * ny + j) * nx + iL;
          const idxR = (k * ny + j) * nx + iR;
          const spanX = Math.max(iR - iL, 1) * dx;
          const duDx =
            ((state[totalCells + idxR] ?? 0) / Math.max(state[idxR] ?? MIN_DENSITY, MIN_DENSITY) -
              (state[totalCells + idxL] ?? 0) / Math.max(state[idxL] ?? MIN_DENSITY, MIN_DENSITY)) /
            spanX;
          const dvDx =
            ((state[2 * totalCells + idxR] ?? 0) / Math.max(state[idxR] ?? MIN_DENSITY, MIN_DENSITY) -
              (state[2 * totalCells + idxL] ?? 0) / Math.max(state[idxL] ?? MIN_DENSITY, MIN_DENSITY)) /
            spanX;

          let duDy = 0.0;
          if (ny > 1) {
            const jL = Math.max(j - 1, 0);
            const jR = Math.min(j + 1, ny - 1);
            const idxJL = (k * ny + jL) * nx + i;
            const idxJR = (k * ny + jR) * nx + i;
            const spanY = Math.max(jR - jL, 1) * dy;
            duDy =
              ((state[totalCells + idxJR] ?? 0) / Math.max(state[idxJR] ?? MIN_DENSITY, MIN_DENSITY) -
                (state[totalCells + idxJL] ?? 0) / Math.max(state[idxJL] ?? MIN_DENSITY, MIN_DENSITY)) /
              spanY;
          }

          const omegaMag = Math.abs(dvDx - duDy);
          const gradU = Math.hypot(duDx, duDy, dvDx);
          const dWall = Math.max(this.wallDistance?.[idx] ?? (j + 0.5) * dy, 1e-6);

          let dTilde = dWall;
          if (this.turbulence === "ddes") {
            const nuEff = nuLam + nuTilde;
            const rd = nuEff / Math.max(gradU * SA_KAPPA * SA_KAPPA * dWall * dWall, 1e-12);
            const x8 = 8.0 * rd;
            const fd = 1.0 - Math.tanh(x8 * x8 * x8);
            dTilde = Math.max(dWall - fd * Math.max(0.0, dWall - SA_CDES * deltaMax), 1e-6);
          }

          const chi = nuTilde / Math.max(nuLam, 1e-16);
          const chi3 = chi * chi * chi;
          const fv1 = chi3 / (chi3 + SA_CV1 * SA_CV1 * SA_CV1);
          const fv2 = 1.0 - chi / (1.0 + chi * fv1);
          const sTilde = Math.max(
            omegaMag + (nuTilde / (SA_KAPPA * SA_KAPPA * dTilde * dTilde)) * fv2,
            0.3 * omegaMag + 1e-12,
          );

          const rLim = Math.min(nuTilde / Math.max(sTilde * SA_KAPPA * SA_KAPPA * dTilde * dTilde, 1e-16), 10.0);
          const gVal = rLim + SA_CW2 * (Math.pow(rLim, 6.0) - rLim);
          const cw3Pow6 = Math.pow(SA_CW3, 6.0);
          const fw = gVal * Math.pow((1.0 + cw3Pow6) / (Math.pow(gVal, 6.0) + cw3Pow6), 1.0 / 6.0);

          const production = SA_CB1 * sTilde * nuTilde;
          const destruction = SA_CW1 * fw * (nuTilde / dTilde) * (nuTilde / dTilde);
          rhs[5 * totalCells + idx] = (rhs[5 * totalCells + idx] ?? 0) + rho * (production - destruction);
        }
      }
    }
  }

  /** Compute spatial semi-discrete residual `dU/dt = R(U)` into `rhs`. */
  public computeResidual(state: Float64Array, rhs: Float64Array): void {
    const { nx, ny, nz, dx, dy, dz, totalCells, nVars, gamma } = this.arena;
    rhs.fill(0.0);

    const evalFlux = (dirX: number, dirY: number, dirZ: number): void => {
      if (this.fluxType === "roe") {
        computeRoeFlux(this.consL, this.consR, dirX, dirY, dirZ, gamma, this.faceFlux, this.entropyFixDelta);
      } else {
        computeHllcFlux(this.consL, this.consR, dirX, dirY, dirZ, gamma, this.faceFlux);
      }
    };

    // X-direction faces
    if (nx > 1) {
      const invDx = 1.0 / dx;
      const fEnd = this.bcX === "periodic" ? nx : nx + 1;
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
          for (let f = 0; f < fEnd; f++) {
            this.loadPrimitiveWithBc(state, f - 2, j, k, this.primLL);
            this.loadPrimitiveWithBc(state, f - 1, j, k, this.primL);
            this.loadPrimitiveWithBc(state, f, j, k, this.primR);
            this.loadPrimitiveWithBc(state, f + 1, j, k, this.primRR);
            this.reconstructFaceStates(dx);
            evalFlux(1.0, 0.0, 0.0);
            if (this.viscous) this.addViscousFaceFlux(1.0, 0.0, 0.0, dx);

            const iL = f - 1;
            const iR = f;
            const leftCell =
              iL >= 0 ? (k * ny + j) * nx + iL : this.bcX === "periodic" ? (k * ny + j) * nx + (nx - 1) : -1;
            const rightCell = iR < nx ? (k * ny + j) * nx + iR : -1;

            for (let m = 0; m < nVars; m++) {
              const df = (this.faceFlux[m] ?? 0) * invDx;
              const base = m * totalCells;
              if (leftCell >= 0) rhs[base + leftCell] = (rhs[base + leftCell] ?? 0) - df;
              if (rightCell >= 0) rhs[base + rightCell] = (rhs[base + rightCell] ?? 0) + df;
            }
          }
        }
      }
    }

    // Y-direction faces
    if (ny > 1) {
      const invDy = 1.0 / dy;
      const fEnd = this.bcY === "periodic" ? ny : ny + 1;
      for (let k = 0; k < nz; k++) {
        for (let f = 0; f < fEnd; f++) {
          for (let i = 0; i < nx; i++) {
            this.loadPrimitiveWithBc(state, i, f - 2, k, this.primLL);
            this.loadPrimitiveWithBc(state, i, f - 1, k, this.primL);
            this.loadPrimitiveWithBc(state, i, f, k, this.primR);
            this.loadPrimitiveWithBc(state, i, f + 1, k, this.primRR);
            this.reconstructFaceStates(dy);
            evalFlux(0.0, 1.0, 0.0);
            if (this.viscous) this.addViscousFaceFlux(0.0, 1.0, 0.0, dy);

            const jL = f - 1;
            const jR = f;
            const leftCell =
              jL >= 0 ? (k * ny + jL) * nx + i : this.bcY === "periodic" ? (k * ny + (ny - 1)) * nx + i : -1;
            const rightCell = jR < ny ? (k * ny + jR) * nx + i : -1;

            for (let m = 0; m < nVars; m++) {
              const df = (this.faceFlux[m] ?? 0) * invDy;
              const base = m * totalCells;
              if (leftCell >= 0) rhs[base + leftCell] = (rhs[base + leftCell] ?? 0) - df;
              if (rightCell >= 0) rhs[base + rightCell] = (rhs[base + rightCell] ?? 0) + df;
            }
          }
        }
      }
    }

    // Z-direction faces
    if (nz > 1) {
      const invDz = 1.0 / dz;
      const fEnd = this.bcZ === "periodic" ? nz : nz + 1;
      for (let f = 0; f < fEnd; f++) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            this.loadPrimitiveWithBc(state, i, j, f - 2, this.primLL);
            this.loadPrimitiveWithBc(state, i, j, f - 1, this.primL);
            this.loadPrimitiveWithBc(state, i, j, f, this.primR);
            this.loadPrimitiveWithBc(state, i, j, f + 1, this.primRR);
            this.reconstructFaceStates(dz);
            evalFlux(0.0, 0.0, 1.0);
            if (this.viscous) this.addViscousFaceFlux(0.0, 0.0, 1.0, dz);

            const kL = f - 1;
            const kR = f;
            const leftCell =
              kL >= 0 ? (kL * ny + j) * nx + i : this.bcZ === "periodic" ? ((nz - 1) * ny + j) * nx + i : -1;
            const rightCell = kR < nz ? (kR * ny + j) * nx + i : -1;

            for (let m = 0; m < nVars; m++) {
              const df = (this.faceFlux[m] ?? 0) * invDz;
              const base = m * totalCells;
              if (leftCell >= 0) rhs[base + leftCell] = (rhs[base + leftCell] ?? 0) - df;
              if (rightCell >= 0) rhs[base + rightCell] = (rhs[base + rightCell] ?? 0) + df;
            }
          }
        }
      }
    }

    if (this.turbulence !== "none") {
      this.addSpalartAllmarasSources(state, rhs);
    }
  }

  /** Enforce density, internal energy, and SA positivity on a state buffer. */
  private enforcePositivity(state: Float64Array): void {
    const { totalCells, gamma, nVars } = this.arena;
    const invGm1 = 1.0 / (gamma - 1.0);
    for (let idx = 0; idx < totalCells; idx++) {
      let rho = state[idx] ?? MIN_DENSITY;
      if (rho < MIN_DENSITY) {
        rho = MIN_DENSITY;
        state[idx] = rho;
      }
      const ru = state[totalCells + idx] ?? 0;
      const rv = state[2 * totalCells + idx] ?? 0;
      const rw = state[3 * totalCells + idx] ?? 0;
      const ke = (0.5 * (ru * ru + rv * rv + rw * rw)) / rho;
      const minE = ke + MIN_PRESSURE * invGm1;
      if ((state[4 * totalCells + idx] ?? 0) < minE) {
        state[4 * totalCells + idx] = minE;
      }
      if (nVars >= 6 && (state[5 * totalCells + idx] ?? 0) < 0.0) {
        state[5 * totalCells + idx] = 0.0;
      }
    }
  }

  /** Advance one explicit 3-stage Strong-Stability-Preserving Runge-Kutta (SSP-RK3) step. */
  public stepSspRk3(dtOverride?: number | undefined): number {
    const state = this.arena.stateBuffer;
    const n = state.length;
    const dt = dtOverride ?? this.computeCflTimestep(state);

    this.u0.set(state);

    // Stage 1: u1 = u0 + dt * R(u0)
    this.computeResidual(this.u0, this.rhs);
    for (let i = 0; i < n; i++) {
      this.u1[i] = (this.u0[i] ?? 0) + dt * (this.rhs[i] ?? 0);
    }
    this.enforcePositivity(this.u1);

    // Stage 2: state = 3/4 u0 + 1/4 u1 + 1/4 dt * R(u1)
    this.computeResidual(this.u1, this.rhs);
    for (let i = 0; i < n; i++) {
      state[i] = 0.75 * (this.u0[i] ?? 0) + 0.25 * (this.u1[i] ?? 0) + 0.25 * dt * (this.rhs[i] ?? 0);
    }
    this.enforcePositivity(state);

    // Stage 3: state = 1/3 u0 + 2/3 state + 2/3 dt * R(state)
    this.computeResidual(state, this.rhs);
    for (let i = 0; i < n; i++) {
      state[i] =
        (1.0 / 3.0) * (this.u0[i] ?? 0) + (2.0 / 3.0) * (state[i] ?? 0) + (2.0 / 3.0) * dt * (this.rhs[i] ?? 0);
    }
    this.enforcePositivity(state);

    return dt;
  }

  /**
   * Perform one matrix-free implicit Euler pseudo-timestep:
   * solves `(I / dtPseudo - dR/dU) * dU = R(U^n)` via `solveMatrixFreeGmres`
   * using directional finite-difference Jacobian-vector products.
   */
  public stepImplicitPseudoTime(dtPseudo: number, gmresOptions: GmresOptions = {}): GmresResult {
    const state = this.arena.stateBuffer;
    const n = state.length;
    const invDt = 1.0 / Math.max(dtPseudo, 1e-15);

    const rBase = new Float64Array(n);
    const uPert = new Float64Array(n);
    const rPlus = new Float64Array(n);
    const rMinus = new Float64Array(n);

    this.computeResidual(state, rBase);

    let uNorm = 0.0;
    for (let i = 0; i < n; i++) {
      const ui = state[i] ?? 0;
      uNorm += ui * ui;
    }
    uNorm = Math.sqrt(uNorm);

    const matvec = (v: Float64Array, out: Float64Array): void => {
      let vNorm = 0.0;
      for (let i = 0; i < n; i++) {
        const vi = v[i] ?? 0;
        vNorm += vi * vi;
      }
      vNorm = Math.sqrt(vNorm);
      if (vNorm < 1e-30) {
        out.fill(0.0);
        return;
      }
      const eps = (1e-6 * (1.0 + uNorm)) / vNorm;
      for (let i = 0; i < n; i++) {
        uPert[i] = (state[i] ?? 0) + eps * (v[i] ?? 0);
      }
      this.computeResidual(uPert, rPlus);
      for (let i = 0; i < n; i++) {
        uPert[i] = (state[i] ?? 0) - eps * (v[i] ?? 0);
      }
      this.computeResidual(uPert, rMinus);
      const inv2Eps = 0.5 / eps;
      for (let i = 0; i < n; i++) {
        const jv = ((rPlus[i] ?? 0) - (rMinus[i] ?? 0)) * inv2Eps;
        out[i] = invDt * (v[i] ?? 0) - jv;
      }
    };

    const result = solveMatrixFreeGmres(matvec, rBase, undefined, gmresOptions);
    for (let i = 0; i < n; i++) {
      state[i] = (state[i] ?? 0) + (result.x[i] ?? 0);
    }
    this.enforcePositivity(state);
    return result;
  }

  /** Advance solution explicitly using SSP-RK3 until physical time `tEnd`. */
  public advanceToTime(tEnd: number, maxSteps: number = 100000): { time: number; steps: number } {
    let time = 0.0;
    let steps = 0;
    while (time < tEnd - 1e-14 && steps < maxSteps) {
      let dt = this.computeCflTimestep();
      if (time + dt > tEnd) dt = tEnd - time;
      this.stepSspRk3(dt);
      time += dt;
      steps++;
    }
    return { time, steps };
  }
}
