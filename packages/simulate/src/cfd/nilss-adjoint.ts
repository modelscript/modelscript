// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-Intrusive Least-Squares Shadowing (NILSS) for Chaotic Unsteady Adjoint Sensitivity Analysis.
 *
 * Implements the NILSS algorithm (Ni & Wang, J. Comput. Phys. 347, 2017) for computing bounded,
 * accurate long-time-averaged sensitivities d<J>/ds of chaotic dynamical systems and turbulent
 * CFD wakes where conventional tangent/adjoint methods blow up exponentially due to positive
 * Lyapunov exponents.
 *
 * Key properties:
 * - Non-intrusive: requires only a discrete step map `step(state, param) -> nextState` and
 *   objective `J(state, param) -> number` (optional analytic tangent/gradient hooks supported).
 * - Integrates K time segments with M homogeneous tangent vectors + 1 inhomogeneous tangent vector.
 * - Modified Gram-Schmidt QR renormalization at every segment boundary prevents Lyapunov blowup.
 * - Solves the small (K-1)*M block-tridiagonal Schur complement KKT system in O(K * M^3) time.
 * - Returns d<J>/ds, time-averaged <J>, shadowing weights a_i, and leading Lyapunov exponents.
 */

export type StateVector = Float64Array | number[];

export interface NilssProblem {
  /** Discrete time-stepper: advances state by one time step dt under scalar parameter s. */
  step: (state: Float64Array, param: number) => Float64Array;
  /** Instantaneous objective functional J(state, param). */
  objective: (state: Float64Array, param: number) => number;
  /**
   * Optional exact directional derivative of `step` w.r.t. state: (D_u Phi)(state, param) * v.
   * When omitted, computed non-intrusively via 2nd-order central finite differences.
   */
  tangentStep?: (state: Float64Array, param: number, v: Float64Array) => Float64Array;
  /**
   * Optional exact partial derivative of `step` w.r.t. param: (D_s Phi)(state, param).
   * When omitted, computed non-intrusively via 2nd-order central finite differences.
   */
  paramTangentStep?: (state: Float64Array, param: number) => Float64Array;
  /**
   * Optional exact gradient of objective w.r.t. state: grad_u J(state, param).
   * When omitted, directional derivatives dJ/du . v are computed via central finite differences.
   */
  objectiveGradState?: (state: Float64Array, param: number) => Float64Array;
  /**
   * Optional exact partial derivative of objective w.r.t. param: dJ/ds(state, param).
   * When omitted, computed via central finite differences.
   */
  objectiveGradParam?: (state: Float64Array, param: number) => number;
  /**
   * Optional continuous-time RHS f(state, param) = du/dt for orthogonal flow projection.
   * When omitted and `projectOrthogonalToFlow` is true, estimated via (step(u, s) - u) / dt.
   */
  flowDirection?: (state: Float64Array, param: number) => Float64Array;
}

export interface NilssConfig {
  /** Number of time segments K (default: 40). */
  numSegments?: number;
  /** Number of discrete steps per segment L (default: 50). */
  stepsPerSegment?: number;
  /** Time step size dt per discrete step (default: 1.0). */
  dt?: number;
  /**
   * Number of homogeneous tangent vectors M (must be >= number of positive Lyapunov exponents;
   * default: 2).
   */
  numHomogeneous?: number;
  /** Spin-up steps before recording segments to settle onto the attractor (default: 0). */
  spinupSteps?: number;
  /** Finite-difference perturbation epsilon for state/tangent derivatives (default: 1e-6). */
  fdEpsilonState?: number;
  /** Finite-difference perturbation epsilon for parameter derivatives (default: 1e-6). */
  fdEpsilonParam?: number;
  /**
   * Project shadowing tangent orthogonal to the flow direction f(u) = du/dt and apply the
   * NILSS time-dilation boundary correction (recommended for continuous-time ODEs/PDEs;
   * default: true).
   */
  projectOrthogonalToFlow?: boolean;
  /** Small Tikhonov regularization added to segment covariance matrices C_i (default: 1e-12). */
  regularization?: number;
  /** Deterministic PRNG seed for initial orthonormal tangent basis (default: 42). */
  seed?: number;
}

export interface NilssResult {
  /** Shadowed time-averaged objective sensitivity d<J>/ds. */
  sensitivity: number;
  /** Time-averaged objective <J> over the K segments. */
  meanObjective: number;
  /** Estimated leading M Lyapunov exponents (sorted descending, in units of 1/time). */
  lyapunovExponents: number[];
  /** Bounded shadowing weights a_i (K vectors of length M). */
  shadowingWeights: Float64Array[];
  /** Maximum Euclidean norm of shadowing weights max_i ||a_i||_2. */
  maxWeightNorm: number;
  /** Maximum segment-boundary continuity residual max_i ||R_{i+1} a_i + b_{i+1} - a_{i+1}||_2. */
  continuityResidual: number;
  /** Total integration time T = K * stepsPerSegment * dt. */
  totalTime: number;
  /** Final state at the end of the K segments. */
  finalState: Float64Array;
}

export interface UnshadowedTangentResult {
  /** Unshadowed tangent sensitivity d<J>/ds (explodes exponentially for chaotic systems). */
  sensitivity: number;
  /** Time-averaged objective <J>. */
  meanObjective: number;
  /** Maximum tangent norm max_n ||v_n||_2 encountered during integration. */
  maxTangentNorm: number;
  /** Final tangent norm ||v_N||_2. */
  finalTangentNorm: number;
}

// ============================================================================
// Internal linear algebra helpers (dense Float64Array, zero external deps)
// ============================================================================

function toFloat64(v: StateVector): Float64Array {
  return v instanceof Float64Array ? new Float64Array(v) : Float64Array.from(v);
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm2(a: Float64Array): number {
  return Math.sqrt(dot(a, a));
}

function projectOrthogonal(v: Float64Array, dir: Float64Array, dirNormSq: number): Float64Array {
  const out = new Float64Array(v.length);
  if (dirNormSq <= 1e-30) {
    out.set(v);
    return out;
  }
  const alpha = dot(v, dir) / dirNormSq;
  for (let i = 0; i < v.length; i++) {
    out[i] = v[i]! - alpha * dir[i]!;
  }
  return out;
}

/** Deterministic Mulberry32 PRNG for reproducible initial tangent bases. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Modified Gram-Schmidt QR decomposition of an N x M matrix stored as M column vectors.
 * Returns orthonormal columns Q (N x M) and upper-triangular R (M x M row-major).
 */
export function modifiedGramSchmidtQR(columns: Float64Array[]): { Q: Float64Array[]; R: Float64Array } {
  const m = columns.length;
  const n = m > 0 ? columns[0]!.length : 0;
  const Q: Float64Array[] = new Array(m);
  const R = new Float64Array(m * m);

  for (let j = 0; j < m; j++) {
    const v = new Float64Array(columns[j]!);
    for (let i = 0; i < j; i++) {
      const qi = Q[i]!;
      const rij = dot(qi, v);
      R[i * m + j] = rij;
      for (let k = 0; k < n; k++) {
        v[k] = v[k]! - rij * qi[k]!;
      }
    }
    // Second re-orthogonalization pass for numerical stability (classical Kahan-Parlett)
    for (let i = 0; i < j; i++) {
      const qi = Q[i]!;
      const corr = dot(qi, v);
      R[i * m + j] = R[i * m + j]! + corr;
      for (let k = 0; k < n; k++) {
        v[k] = v[k]! - corr * qi[k]!;
      }
    }
    const rjj = norm2(v);
    R[j * m + j] = rjj;
    const qj = new Float64Array(n);
    if (rjj > 1e-15) {
      const inv = 1 / rjj;
      for (let k = 0; k < n; k++) qj[k] = v[k]! * inv;
    } else if (j < n) {
      qj[j] = 1;
    }
    Q[j] = qj;
  }

  return { Q, R };
}

/** Solve A * x = b for small dense M x M matrix A using Gaussian elimination with partial pivoting. */
function solveDenseLinear(A: Float64Array, b: Float64Array, m: number): Float64Array {
  const M = new Float64Array(A);
  const rhs = new Float64Array(b);

  for (let k = 0; k < m; k++) {
    let pivotRow = k;
    let maxVal = Math.abs(M[k * m + k]!);
    for (let i = k + 1; i < m; i++) {
      const v = Math.abs(M[i * m + k]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = i;
      }
    }
    if (pivotRow !== k) {
      for (let j = k; j < m; j++) {
        const tmp = M[k * m + j]!;
        M[k * m + j] = M[pivotRow * m + j]!;
        M[pivotRow * m + j] = tmp;
      }
      const tmpR = rhs[k]!;
      rhs[k] = rhs[pivotRow]!;
      rhs[pivotRow] = tmpR;
    }
    const diag = M[k * m + k]!;
    if (Math.abs(diag) < 1e-30) continue;
    for (let i = k + 1; i < m; i++) {
      const factor = M[i * m + k]! / diag;
      M[i * m + k] = 0;
      for (let j = k + 1; j < m; j++) {
        M[i * m + j] = M[i * m + j]! - factor * M[k * m + j]!;
      }
      rhs[i] = rhs[i]! - factor * rhs[k]!;
    }
  }

  const x = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) {
    let s = rhs[i]!;
    for (let j = i + 1; j < m; j++) {
      s -= M[i * m + j]! * x[j]!;
    }
    const diag = M[i * m + i]!;
    x[i] = Math.abs(diag) > 1e-30 ? s / diag : 0;
  }
  return x;
}

/** Invert a small dense M x M matrix via column-wise partial-pivoting LU/Gauss elimination. */
function invertSmallMatrix(A: Float64Array, m: number): Float64Array {
  const inv = new Float64Array(m * m);
  const e = new Float64Array(m);
  for (let col = 0; col < m; col++) {
    e.fill(0);
    e[col] = 1;
    const x = solveDenseLinear(A, e, m);
    for (let row = 0; row < m; row++) {
      inv[row * m + col] = x[row]!;
    }
  }
  return inv;
}

function matMul(A: Float64Array, B: Float64Array, m: number): Float64Array {
  const C = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < m; k++) {
      const aik = A[i * m + k]!;
      if (aik === 0) continue;
      for (let j = 0; j < m; j++) {
        C[i * m + j] = C[i * m + j]! + aik * B[k * m + j]!;
      }
    }
  }
  return C;
}

function matMulTransB(A: Float64Array, B: Float64Array, m: number): Float64Array {
  const C = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) {
        s += A[i * m + k]! * B[j * m + k]!;
      }
      C[i * m + j] = s;
    }
  }
  return C;
}

function matVec(A: Float64Array, x: Float64Array, m: number): Float64Array {
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += A[i * m + j]! * x[j]!;
    y[i] = s;
  }
  return y;
}

function matTransVec(A: Float64Array, x: Float64Array, m: number): Float64Array {
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += A[j * m + i]! * x[j]!;
    y[i] = s;
  }
  return y;
}

/**
 * Solve a block-tridiagonal linear system with nBlocks blocks of size m x m:
 *   L[i] * x[i-1] + D[i] * x[i] + U[i] * x[i+1] = rhs[i],  i = 0 .. nBlocks - 1.
 */
function solveBlockTridiagonal(
  L: (Float64Array | null)[],
  D: Float64Array[],
  U: (Float64Array | null)[],
  rhs: Float64Array[],
  m: number,
): Float64Array[] {
  const n = D.length;
  if (n === 0) return [];

  const uPrime: (Float64Array | null)[] = new Array(n).fill(null);
  const yPrime: Float64Array[] = new Array(n);

  // Forward sweep
  const d0Inv = invertSmallMatrix(D[0]!, m);
  if (n > 1 && U[0]) {
    uPrime[0] = matMul(d0Inv, U[0]!, m);
  }
  yPrime[0] = matVec(d0Inv, rhs[0]!, m);

  for (let i = 1; i < n; i++) {
    // D_mod = D[i] - L[i] * uPrime[i-1]
    const dMod = new Float64Array(D[i]!);
    if (L[i] && uPrime[i - 1]) {
      const lu = matMul(L[i]!, uPrime[i - 1]!, m);
      for (let k = 0; k < m * m; k++) dMod[k] = dMod[k]! - lu[k]!;
    }
    const dModInv = invertSmallMatrix(dMod, m);

    if (i < n - 1 && U[i]) {
      uPrime[i] = matMul(dModInv, U[i]!, m);
    }

    // rhs_mod = rhs[i] - L[i] * yPrime[i-1]
    const rhsMod = new Float64Array(rhs[i]!);
    if (L[i]) {
      const ly = matVec(L[i]!, yPrime[i - 1]!, m);
      for (let k = 0; k < m; k++) rhsMod[k] = rhsMod[k]! - ly[k]!;
    }
    yPrime[i] = matVec(dModInv, rhsMod, m);
  }

  // Backward substitution
  const x: Float64Array[] = new Array(n);
  x[n - 1] = new Float64Array(yPrime[n - 1]!);
  for (let i = n - 2; i >= 0; i--) {
    const xi = new Float64Array(yPrime[i]!);
    if (uPrime[i]) {
      const ux = matVec(uPrime[i]!, x[i + 1]!, m);
      for (let k = 0; k < m; k++) xi[k] = xi[k]! - ux[k]!;
    }
    x[i] = xi;
  }

  return x;
}

// ============================================================================
// NILSS Adjoint Solver
// ============================================================================

export class NilssAdjointSolver {
  private readonly problem: NilssProblem;
  private readonly numSegments: number;
  private readonly stepsPerSegment: number;
  private readonly dt: number;
  private readonly numHomogeneous: number;
  private readonly spinupSteps: number;
  private readonly fdEpsState: number;
  private readonly fdEpsParam: number;
  private readonly projectOrthogonalToFlow: boolean;
  private readonly regularization: number;
  private readonly seed: number;

  constructor(problem: NilssProblem, config: NilssConfig = {}) {
    this.problem = problem;
    this.numSegments = config.numSegments ?? 40;
    this.stepsPerSegment = config.stepsPerSegment ?? 50;
    this.dt = config.dt ?? 1.0;
    this.numHomogeneous = config.numHomogeneous ?? 2;
    this.spinupSteps = config.spinupSteps ?? 0;
    this.fdEpsState = config.fdEpsilonState ?? 1e-6;
    this.fdEpsParam = config.fdEpsilonParam ?? 1e-6;
    this.projectOrthogonalToFlow = config.projectOrthogonalToFlow ?? true;
    this.regularization = config.regularization ?? 1e-12;
    this.seed = config.seed ?? 42;

    if (this.numSegments < 1) {
      throw new Error(`NilssAdjointSolver: numSegments must be >= 1 (got ${this.numSegments})`);
    }
    if (this.stepsPerSegment < 1) {
      throw new Error(`NilssAdjointSolver: stepsPerSegment must be >= 1 (got ${this.stepsPerSegment})`);
    }
    if (this.numHomogeneous < 1) {
      throw new Error(`NilssAdjointSolver: numHomogeneous must be >= 1 (got ${this.numHomogeneous})`);
    }
  }

  /** Compute (D_u Phi)(u, s) * v using exact hook or scaled central finite differences. */
  private applyStateTangent(u: Float64Array, s: number, v: Float64Array): Float64Array {
    if (this.problem.tangentStep) {
      return this.problem.tangentStep(u, s, v);
    }
    const vNorm = norm2(v);
    if (vNorm <= 1e-30) return new Float64Array(u.length);

    const n = u.length;
    const h = this.fdEpsState;
    const scale = h / vNorm;
    const uPlus = new Float64Array(n);
    const uMinus = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const dv = scale * v[i]!;
      uPlus[i] = u[i]! + dv;
      uMinus[i] = u[i]! - dv;
    }
    const pPlus = this.problem.step(uPlus, s);
    const pMinus = this.problem.step(uMinus, s);
    const inv = vNorm / (2 * h);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = (pPlus[i]! - pMinus[i]!) * inv;
    }
    return out;
  }

  /** Compute (D_s Phi)(u, s) using exact hook or central finite differences. */
  private applyParamTangent(u: Float64Array, s: number): Float64Array {
    if (this.problem.paramTangentStep) {
      return this.problem.paramTangentStep(u, s);
    }
    const h = this.fdEpsParam;
    const pPlus = this.problem.step(u, s + h);
    const pMinus = this.problem.step(u, s - h);
    const inv = 1 / (2 * h);
    const out = new Float64Array(u.length);
    for (let i = 0; i < u.length; i++) {
      out[i] = (pPlus[i]! - pMinus[i]!) * inv;
    }
    return out;
  }

  /** Compute directional derivative dJ/du(u, s) . v. */
  private objectiveDirectionalDeriv(u: Float64Array, s: number, v: Float64Array, cachedGrad?: Float64Array): number {
    if (cachedGrad) return dot(cachedGrad, v);
    const vNorm = norm2(v);
    if (vNorm <= 1e-30) return 0;
    const h = this.fdEpsState;
    const scale = h / vNorm;
    const n = u.length;
    const uPlus = new Float64Array(n);
    const uMinus = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const dv = scale * v[i]!;
      uPlus[i] = u[i]! + dv;
      uMinus[i] = u[i]! - dv;
    }
    return ((this.problem.objective(uPlus, s) - this.problem.objective(uMinus, s)) * vNorm) / (2 * h);
  }

  /** Compute partial derivative dJ/ds(u, s). */
  private objectiveParamDeriv(u: Float64Array, s: number): number {
    if (this.problem.objectiveGradParam) {
      return this.problem.objectiveGradParam(u, s);
    }
    const h = this.fdEpsParam;
    return (this.problem.objective(u, s + h) - this.problem.objective(u, s - h)) / (2 * h);
  }

  /** Compute local flow direction f(u, s) = du/dt. */
  private computeFlowDir(u: Float64Array, s: number, uNext: Float64Array): Float64Array {
    if (this.problem.flowDirection) {
      return this.problem.flowDirection(u, s);
    }
    const invDt = 1 / this.dt;
    const f = new Float64Array(u.length);
    for (let i = 0; i < u.length; i++) {
      f[i] = (uNext[i]! - u[i]!) * invDt;
    }
    return f;
  }

  /**
   * Solve the NILSS shadowing sensitivity problem starting from `initialState` at parameter `param`.
   */
  public solve(initialState: StateVector, param: number): NilssResult {
    let u = toFloat64(initialState);
    const n = u.length;
    const K = this.numSegments;
    const L = this.stepsPerSegment;
    const dt = this.dt;
    const M = Math.min(this.numHomogeneous, this.projectOrthogonalToFlow ? Math.max(1, n - 1) : n);

    // 1. Optional spin-up onto the chaotic attractor
    for (let s = 0; s < this.spinupSteps; s++) {
      u = this.problem.step(u, param);
    }

    // 2. Initialize M orthonormal homogeneous tangent vectors W_0 and inhomogeneous v*_0 = 0
    const rng = mulberry32(this.seed);
    const rawInitW: Float64Array[] = [];
    for (let m = 0; m < M; m++) {
      const col = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        col[i] = rng() - 0.5;
      }
      rawInitW.push(col);
    }

    let uNext = this.problem.step(u, param);
    if (this.projectOrthogonalToFlow) {
      const f0 = this.computeFlowDir(u, param, uNext);
      const f0NormSq = dot(f0, f0);
      for (let m = 0; m < M; m++) {
        rawInitW[m] = projectOrthogonal(rawInitW[m]!, f0, f0NormSq);
      }
    }
    let W = modifiedGramSchmidtQR(rawInitW).Q;
    let vStar = new Float64Array(n);

    // Per-segment storage for the reduced K * M shadowing problem
    const C: Float64Array[] = new Array(K);
    const d: Float64Array[] = new Array(K);
    const R: Float64Array[] = new Array(K); // R[i] is R_{i+1} at end of segment i
    const b: Float64Array[] = new Array(K); // b[i] is b_{i+1} at end of segment i
    const gStar = new Float64Array(K);
    const gW: Float64Array[] = new Array(K);
    const xiStar = new Float64Array(K);
    const xiW: Float64Array[] = new Array(K);
    const jEnd = new Float64Array(K);
    const jInt = new Float64Array(K);
    const lyapLogSum = new Float64Array(M);

    // 3. Forward integration across K segments with MGS QR renormalization at each boundary
    for (let seg = 0; seg < K; seg++) {
      const Ci = new Float64Array(M * M);
      const di = new Float64Array(M);
      const gWi = new Float64Array(M);
      let gStarI = 0;
      let jIntI = 0;

      for (let step = 0; step <= L; step++) {
        const weight = step === 0 || step === L ? 0.5 * dt : dt;
        const f = this.projectOrthogonalToFlow ? this.computeFlowDir(u, param, uNext) : null;
        const fNormSq = f ? dot(f, f) : 0;

        // Orthogonalized tangents for the shadowing least-squares objective
        const wPerp: Float64Array[] = new Array(M);
        for (let m = 0; m < M; m++) {
          wPerp[m] = f ? projectOrthogonal(W[m]!, f, fNormSq) : W[m]!;
        }
        const vPerp = f ? projectOrthogonal(vStar, f, fNormSq) : vStar;

        // Accumulate C_i = int (W_perp^T W_perp) dt, d_i = int (W_perp^T v*_perp) dt
        for (let p = 0; p < M; p++) {
          for (let q = p; q < M; q++) {
            const val = dot(wPerp[p]!, wPerp[q]!) * weight;
            Ci[p * M + q] = Ci[p * M + q]! + val;
            if (p !== q) Ci[q * M + p] = Ci[q * M + p]! + val;
          }
          di[p] = di[p]! + dot(wPerp[p]!, vPerp) * weight;
        }

        // Accumulate objective integral and sensitivity integrals
        const jVal = this.problem.objective(u, param);
        jIntI += jVal * weight;
        const cachedGrad = this.problem.objectiveGradState ? this.problem.objectiveGradState(u, param) : undefined;
        const dJds = this.objectiveParamDeriv(u, param);
        const dJduV = this.objectiveDirectionalDeriv(u, param, vStar, cachedGrad);
        gStarI += (dJduV + dJds) * weight;
        for (let m = 0; m < M; m++) {
          gWi[m] = gWi[m]! + this.objectiveDirectionalDeriv(u, param, W[m]!, cachedGrad) * weight;
        }

        if (step < L) {
          // Advance tangent vectors W and vStar along u -> uNext
          const nextW: Float64Array[] = new Array(M);
          for (let m = 0; m < M; m++) {
            nextW[m] = this.applyStateTangent(u, param, W[m]!);
          }
          const dvState = this.applyStateTangent(u, param, vStar);
          const dvParam = this.applyParamTangent(u, param);
          const nextVStar = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            nextVStar[i] = dvState[i]! + dvParam[i]!;
          }

          W = nextW;
          vStar = nextVStar;
          u = uNext;
          uNext = this.problem.step(u, param);
        } else {
          // Segment boundary t_{seg+1}: record time-dilation terms & QR-renormalize
          jEnd[seg] = jVal;
          const xiWi = new Float64Array(M);
          if (f && fNormSq > 1e-30) {
            xiStar[seg] = dot(vStar, f) / fNormSq;
            for (let m = 0; m < M; m++) {
              xiWi[m] = dot(W[m]!, f) / fNormSq;
            }
          }
          xiW[seg] = xiWi;

          // Modified Gram-Schmidt QR on orthogonalized W_perp at segment boundary
          const { Q: qNext, R: rNext } = modifiedGramSchmidtQR(wPerp);
          R[seg] = rNext;

          // Accumulate Lyapunov exponent log-stretching factors
          for (let m = 0; m < M; m++) {
            const rmm = Math.abs(rNext[m * M + m]!);
            if (rmm > 1e-300) {
              lyapLogSum[m] = lyapLogSum[m]! + Math.log(rmm);
            }
          }

          // Project v*_perp onto Q_{seg+1}: b_{seg+1} = Q^T v*_perp
          const bNext = new Float64Array(M);
          const vNext = new Float64Array(vPerp);
          for (let m = 0; m < M; m++) {
            const qm = qNext[m]!;
            const bm = dot(qm, vPerp);
            bNext[m] = bm;
            for (let k = 0; k < n; k++) {
              vNext[k] = vNext[k]! - bm * qm[k]!;
            }
          }
          b[seg] = bNext;

          // Reset tangents for the next segment
          W = qNext;
          vStar = vNext;
        }
      }

      // Apply tiny Tikhonov regularization for numerical robustness
      for (let m = 0; m < M; m++) {
        Ci[m * M + m] = Ci[m * M + m]! + this.regularization;
      }

      C[seg] = Ci;
      d[seg] = di;
      gStar[seg] = gStarI;
      gW[seg] = gWi;
      jInt[seg] = jIntI;
    }

    // 4. Solve the small K*M constrained least-squares shadowing problem via Schur complement
    const cInv: Float64Array[] = new Array(K);
    const cInvD: Float64Array[] = new Array(K);
    for (let i = 0; i < K; i++) {
      cInv[i] = invertSmallMatrix(C[i]!, M);
      cInvD[i] = matVec(cInv[i]!, d[i]!, M);
    }

    const a: Float64Array[] = new Array(K);
    if (K === 1) {
      const a0 = new Float64Array(M);
      for (let m = 0; m < M; m++) a0[m] = -cInvD[0]![m]!;
      a[0] = a0;
    } else {
      const nLambda = K - 1;
      const blockL: (Float64Array | null)[] = new Array(nLambda).fill(null);
      const blockD: Float64Array[] = new Array(nLambda);
      const blockU: (Float64Array | null)[] = new Array(nLambda).fill(null);
      const blockRhs: Float64Array[] = new Array(nLambda);

      for (let i = 0; i < nLambda; i++) {
        // R_{i+1} is stored in R[i], b_{i+1} is stored in b[i]
        const Ri1 = R[i]!;
        const bi1 = b[i]!;
        const RCinv = matMul(Ri1, cInv[i]!, M);
        const RCinvRT = matMulTransB(RCinv, Ri1, M);

        // Diagonal block D_i = R_{i+1} C_i^{-1} R_{i+1}^T + C_{i+1}^{-1}
        const diag = new Float64Array(M * M);
        const ci1Inv = cInv[i + 1]!;
        for (let k = 0; k < M * M; k++) {
          diag[k] = RCinvRT[k]! + ci1Inv[k]!;
        }
        blockD[i] = diag;

        // Lower block L_i = -R_{i+1} C_i^{-1}
        if (i > 0) {
          const low = new Float64Array(M * M);
          for (let k = 0; k < M * M; k++) low[k] = -RCinv[k]!;
          blockL[i] = low;
        }

        // Upper block U_i = -C_{i+1}^{-1} R_{i+2}^T
        if (i < nLambda - 1) {
          const Ri2 = R[i + 1]!;
          const upRaw = matMulTransB(ci1Inv, Ri2, M);
          const up = new Float64Array(M * M);
          for (let k = 0; k < M * M; k++) up[k] = -upRaw[k]!;
          blockU[i] = up;
        }

        // RHS_i = b_{i+1} - R_{i+1} C_i^{-1} d_i + C_{i+1}^{-1} d_{i+1}
        const rCinvDi = matVec(Ri1, cInvD[i]!, M);
        const rhsI = new Float64Array(M);
        for (let m = 0; m < M; m++) {
          rhsI[m] = bi1[m]! - rCinvDi[m]! + cInvD[i + 1]![m]!;
        }
        blockRhs[i] = rhsI;
      }

      const lambda = solveBlockTridiagonal(blockL, blockD, blockU, blockRhs, M);

      // Recover shadowing weights a_j = -C_j^{-1} (d_j + (B^T lambda)_j)
      for (let j = 0; j < K; j++) {
        const rhsJ = new Float64Array(d[j]!);
        if (j > 0) {
          const lamPrev = lambda[j - 1]!;
          for (let m = 0; m < M; m++) rhsJ[m] = rhsJ[m]! - lamPrev[m]!;
        }
        if (j < K - 1) {
          const rtLam = matTransVec(R[j]!, lambda[j]!, M);
          for (let m = 0; m < M; m++) rhsJ[m] = rhsJ[m]! + rtLam[m]!;
        }
        const aj = matVec(cInv[j]!, rhsJ, M);
        for (let m = 0; m < M; m++) aj[m] = -aj[m]!;
        a[j] = aj;
      }
    }

    // 5. Compute continuity residual, time-averaged <J>, and shadowed sensitivity d<J>/ds
    let continuityResidual = 0;
    for (let i = 0; i < K - 1; i++) {
      const ra = matVec(R[i]!, a[i]!, M);
      let resSq = 0;
      for (let m = 0; m < M; m++) {
        const diff = ra[m]! + b[i]![m]! - a[i + 1]![m]!;
        resSq += diff * diff;
      }
      continuityResidual = Math.max(continuityResidual, Math.sqrt(resSq));
    }

    let maxWeightNorm = 0;
    for (let i = 0; i < K; i++) {
      maxWeightNorm = Math.max(maxWeightNorm, norm2(a[i]!));
    }

    const totalTime = K * L * dt;
    let totalJInt = 0;
    for (let i = 0; i < K; i++) totalJInt += jInt[i]!;
    const meanObjective = totalJInt / totalTime;

    let totalSensInt = 0;
    for (let i = 0; i < K; i++) {
      const segGrad = gStar[i]! + dot(gW[i]!, a[i]!);
      const xi = this.projectOrthogonalToFlow ? xiStar[i]! + dot(xiW[i]!, a[i]!) : 0;
      const boundaryCorrection = xi * (meanObjective - jEnd[i]!);
      totalSensInt += segGrad + boundaryCorrection;
    }
    const sensitivity = totalSensInt / totalTime;

    const lyapunovExponents: number[] = [];
    for (let m = 0; m < M; m++) {
      lyapunovExponents.push(lyapLogSum[m]! / totalTime);
    }

    return {
      sensitivity,
      meanObjective,
      lyapunovExponents,
      shadowingWeights: a,
      maxWeightNorm,
      continuityResidual,
      totalTime,
      finalState: u,
    };
  }

  /**
   * Compute conventional unshadowed forward tangent sensitivity over the same time horizon
   * for direct comparison against NILSS (demonstrates exponential Lyapunov blowup on chaotic flows).
   */
  public solveUnshadowed(initialState: StateVector, param: number): UnshadowedTangentResult {
    let u = toFloat64(initialState);
    const n = u.length;
    const totalSteps = this.numSegments * this.stepsPerSegment;
    const dt = this.dt;

    for (let s = 0; s < this.spinupSteps; s++) {
      u = this.problem.step(u, param);
    }

    let v = new Float64Array(n);
    let jInt = 0;
    let sensInt = 0;
    let maxTangentNorm = 0;

    for (let step = 0; step <= totalSteps; step++) {
      const weight = step === 0 || step === totalSteps ? 0.5 * dt : dt;
      jInt += this.problem.objective(u, param) * weight;

      const cachedGrad = this.problem.objectiveGradState ? this.problem.objectiveGradState(u, param) : undefined;
      const dJds = this.objectiveParamDeriv(u, param);
      const dJduV = this.objectiveDirectionalDeriv(u, param, v, cachedGrad);
      sensInt += (dJduV + dJds) * weight;

      const vNorm = norm2(v);
      if (vNorm > maxTangentNorm) maxTangentNorm = vNorm;

      if (step < totalSteps) {
        const dvState = this.applyStateTangent(u, param, v);
        const dvParam = this.applyParamTangent(u, param);
        const vNext = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          vNext[i] = dvState[i]! + dvParam[i]!;
        }
        v = vNext;
        u = this.problem.step(u, param);
      }
    }

    const totalTime = totalSteps * dt;
    return {
      sensitivity: sensInt / totalTime,
      meanObjective: jInt / totalTime,
      maxTangentNorm,
      finalTangentNorm: norm2(v),
    };
  }
}
