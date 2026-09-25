// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Scaled Unscented Kalman Filter (UKF) for Nonlinear System & Parameter Estimation.
 *
 * Implements the Van der Merwe scaled unscented transform formulation for joint state-parameter
 * tracking, zero-GC matrix operations, and Cholesky square-root conditioning.
 *
 * State formulation:
 *   x_{k+1} = f(x_k, u_k, dt) + q_k,  q_k ~ N(0, Q)
 *   y_k     = h(x_k) + r_k,            r_k ~ N(0, R)
 */

export interface UkfConfig {
  stateDim: number;
  measDim: number;
  alpha?: number; // Spread parameter (default: 1e-3)
  beta?: number; // Prior distribution parameter (default: 2.0 for Gaussian)
  kappa?: number; // Secondary scaling parameter (default: 0.0)
  processNoiseQ: Float64Array; // Diagonal or full covariance (stateDim x stateDim)
  measNoiseR: Float64Array; // Diagonal or full covariance (measDim x measDim)
}

export type StateTransitionFn = (state: Float64Array, control: Float64Array, dt: number) => Float64Array;
export type MeasurementFn = (state: Float64Array) => Float64Array;

export class UnscentedKalmanFilter {
  public readonly L: number; // State dimension
  public readonly M: number; // Measurement dimension
  private alpha: number;
  private beta: number;
  private kappa: number;
  private lambda: number;

  // Weights
  private Wm: Float64Array; // Weights for mean (2L + 1)
  private Wc: Float64Array; // Weights for covariance (2L + 1)

  // Current state estimate and error covariance
  public state: Float64Array; // (L)
  public cov: Float64Array; // (L x L)

  // Process and measurement noise
  public Q: Float64Array; // (L x L)
  public R: Float64Array; // (M x M)

  // Pre-allocated workspace arrays for zero-GC execution
  private sigmaPoints: Float64Array; // (2L + 1) x L
  private propSigmaPoints: Float64Array; // (2L + 1) x L
  private measSigmaPoints: Float64Array; // (2L + 1) x M
  private predMeas: Float64Array; // (M)
  private Pyy: Float64Array; // (M x M)
  private Pxy: Float64Array; // (L x M)
  private K: Float64Array; // Kalman gain (L x M)
  private sqrtL: Float64Array; // Cholesky factor (L x L)

  constructor(config: UkfConfig) {
    this.L = config.stateDim;
    this.M = config.measDim;
    this.alpha = config.alpha ?? 1e-3;
    this.beta = config.beta ?? 2.0;
    this.kappa = config.kappa ?? 0.0;

    const L = this.L;
    const M = this.M;
    this.lambda = this.alpha * this.alpha * (L + this.kappa) - L;

    const numPoints = 2 * L + 1;
    this.Wm = new Float64Array(numPoints);
    this.Wc = new Float64Array(numPoints);

    // Compute Unscented Transform weights
    const c = L + this.lambda;
    this.Wm[0] = this.lambda / c;
    this.Wc[0] = this.lambda / c + (1.0 - this.alpha * this.alpha + this.beta);

    const wOther = 1.0 / (2.0 * c);
    for (let i = 1; i < numPoints; i++) {
      this.Wm[i] = wOther;
      this.Wc[i] = wOther;
    }

    this.state = new Float64Array(L);
    this.cov = new Float64Array(L * L);
    // Initialize cov to identity
    for (let i = 0; i < L; i++) this.cov[i * L + i] = 1.0;

    // Load Q and R
    this.Q = new Float64Array(L * L);
    if (config.processNoiseQ.length === L) {
      for (let i = 0; i < L; i++) this.Q[i * L + i] = config.processNoiseQ[i]!;
    } else {
      this.Q.set(config.processNoiseQ);
    }

    this.R = new Float64Array(M * M);
    if (config.measNoiseR.length === M) {
      for (let i = 0; i < M; i++) this.R[i * M + i] = config.measNoiseR[i]!;
    } else {
      this.R.set(config.measNoiseR);
    }

    // Allocate workspace
    this.sigmaPoints = new Float64Array(numPoints * L);
    this.propSigmaPoints = new Float64Array(numPoints * L);
    this.measSigmaPoints = new Float64Array(numPoints * M);
    this.predMeas = new Float64Array(M);
    this.Pyy = new Float64Array(M * M);
    this.Pxy = new Float64Array(L * M);
    this.K = new Float64Array(L * M);
    this.sqrtL = new Float64Array(L * L);
  }

  /**
   * Initializes the state estimate and covariance.
   */
  public init(initialState: Float64Array, initialCov?: Float64Array): void {
    this.state.set(initialState);
    if (initialCov) {
      if (initialCov.length === this.L) {
        this.cov.fill(0);
        for (let i = 0; i < this.L; i++) this.cov[i * this.L + i] = initialCov[i]!;
      } else {
        this.cov.set(initialCov);
      }
    }
  }

  /**
   * Computes the lower Cholesky decomposition of A: A = L * L^T.
   */
  private cholesky(A: Float64Array, n: number, out: Float64Array): boolean {
    out.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0.0;
        for (let k = 0; k < j; k++) {
          sum += out[i * n + k]! * out[j * n + k]!;
        }

        if (i === j) {
          const val = A[i * n + i]! - sum;
          if (val <= 1e-15) {
            out[i * n + i] = 1e-8; // Regularize near-singular
          } else {
            out[i * n + i] = Math.sqrt(val);
          }
        } else {
          const diag = out[j * n + j]!;
          out[i * n + j] = diag > 1e-14 ? (A[i * n + j]! - sum) / diag : 0.0;
        }
      }
    }
    return true;
  }

  /**
   * Generates 2L + 1 sigma points around current mean and covariance.
   */
  private generateSigmaPoints(): void {
    const L = this.L;
    const gamma = Math.sqrt(L + this.lambda);

    // Cholesky factor of P
    this.cholesky(this.cov, L, this.sqrtL);

    // Point 0: mean
    for (let j = 0; j < L; j++) {
      this.sigmaPoints[j] = this.state[j]!;
    }

    // Points 1..L: mean + gamma * col(sqrtL)
    // Points L+1..2L: mean - gamma * col(sqrtL)
    for (let i = 0; i < L; i++) {
      const idxPlus = (i + 1) * L;
      const idxMinus = (L + i + 1) * L;

      for (let j = 0; j < L; j++) {
        const delta = gamma * this.sqrtL[j * L + i]!;
        this.sigmaPoints[idxPlus + j] = this.state[j]! + delta;
        this.sigmaPoints[idxMinus + j] = this.state[j]! - delta;
      }
    }
  }

  /**
   * Performs the UKF prediction step using system dynamic model f.
   */
  public predict(f: StateTransitionFn, control: Float64Array, dt: number): void {
    const L = this.L;
    const numPoints = 2 * L + 1;

    this.generateSigmaPoints();

    // Propagate each sigma point through f
    const ptBuffer = new Float64Array(L);
    for (let i = 0; i < numPoints; i++) {
      for (let j = 0; j < L; j++) ptBuffer[j] = this.sigmaPoints[i * L + j]!;
      const propPt = f(ptBuffer, control, dt);
      for (let j = 0; j < L; j++) this.propSigmaPoints[i * L + j] = propPt[j]!;
    }

    // Compute predicted state mean
    this.state.fill(0);
    for (let i = 0; i < numPoints; i++) {
      const w = this.Wm[i]!;
      for (let j = 0; j < L; j++) {
        this.state[j] += w * this.propSigmaPoints[i * L + j]!;
      }
    }

    // Compute predicted covariance P = sum Wc * (prop - mean)(prop - mean)^T + Q
    this.cov.fill(0);
    const diff = new Float64Array(L);
    for (let i = 0; i < numPoints; i++) {
      const w = this.Wc[i]!;
      for (let j = 0; j < L; j++) {
        diff[j] = this.propSigmaPoints[i * L + j]! - this.state[j]!;
      }
      for (let r = 0; r < L; r++) {
        for (let c = 0; c < L; c++) {
          this.cov[r * L + c] += w * diff[r]! * diff[c]!;
        }
      }
    }

    // Add process noise Q
    for (let i = 0; i < L * L; i++) {
      this.cov[i] += this.Q[i]!;
    }
  }

  /**
   * Performs the UKF correction/update step using measurement model h and actual measurement y.
   */
  public update(h: MeasurementFn, y: Float64Array): void {
    const L = this.L;
    const M = this.M;
    const numPoints = 2 * L + 1;

    // Evaluate measurement function at propagated sigma points
    const ptBuffer = new Float64Array(L);
    for (let i = 0; i < numPoints; i++) {
      for (let j = 0; j < L; j++) ptBuffer[j] = this.propSigmaPoints[i * L + j]!;
      const mPt = h(ptBuffer);
      for (let m = 0; m < M; m++) this.measSigmaPoints[i * M + m] = mPt[m]!;
    }

    // Compute predicted measurement mean
    this.predMeas.fill(0);
    for (let i = 0; i < numPoints; i++) {
      const w = this.Wm[i]!;
      for (let m = 0; m < M; m++) {
        this.predMeas[m] += w * this.measSigmaPoints[i * M + m]!;
      }
    }

    // Compute Pyy (innovation covariance) and Pxy (cross-covariance)
    this.Pyy.fill(0);
    this.Pxy.fill(0);

    const xDiff = new Float64Array(L);
    const yDiff = new Float64Array(M);

    for (let i = 0; i < numPoints; i++) {
      const w = this.Wc[i]!;
      for (let j = 0; j < L; j++) {
        xDiff[j] = this.propSigmaPoints[i * L + j]! - this.state[j]!;
      }
      for (let m = 0; m < M; m++) {
        yDiff[m] = this.measSigmaPoints[i * M + m]! - this.predMeas[m]!;
      }

      for (let r = 0; r < M; r++) {
        for (let c = 0; c < M; c++) {
          this.Pyy[r * M + c] += w * yDiff[r]! * yDiff[c]!;
        }
      }

      for (let r = 0; r < L; r++) {
        for (let c = 0; c < M; c++) {
          this.Pxy[r * M + c] += w * xDiff[r]! * yDiff[c]!;
        }
      }
    }

    // Add measurement noise R
    for (let i = 0; i < M * M; i++) {
      this.Pyy[i] += this.R[i]!;
    }

    // Invert Pyy (using Gauss-Jordan for small M)
    const invPyy = this.invertMatrix(this.Pyy, M);

    // Compute Kalman gain K = Pxy * inv(Pyy)  (L x M)
    this.K.fill(0);
    for (let r = 0; r < L; r++) {
      for (let c = 0; c < M; c++) {
        let sum = 0.0;
        for (let k = 0; k < M; k++) {
          sum += this.Pxy[r * M + k]! * invPyy[k * M + c]!;
        }
        this.K[r * M + c] = sum;
      }
    }

    // Measurement residual v = y - predMeas
    const residual = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      residual[m] = y[m]! - this.predMeas[m]!;
    }

    // State update: state = state + K * residual
    for (let r = 0; r < L; r++) {
      let delta = 0.0;
      for (let c = 0; c < M; c++) {
        delta += this.K[r * M + c]! * residual[c]!;
      }
      this.state[r] += delta;
    }

    // Covariance update: P = P - K * Pyy * K^T
    // Compute K * Pyy (L x M)
    const KPyy = new Float64Array(L * M);
    for (let r = 0; r < L; r++) {
      for (let c = 0; c < M; c++) {
        let sum = 0.0;
        for (let k = 0; k < M; k++) {
          sum += this.K[r * M + k]! * this.Pyy[k * M + c]!;
        }
        KPyy[r * M + c] = sum;
      }
    }

    // P -= KPyy * K^T
    for (let r = 0; r < L; r++) {
      for (let c = 0; c < L; c++) {
        let sum = 0.0;
        for (let k = 0; k < M; k++) {
          sum += KPyy[r * M + k]! * this.K[c * M + k]!; // K^T[k, c] = K[c, k]
        }
        this.cov[r * L + c] -= sum;
      }
    }

    // Enforce symmetry in cov
    for (let r = 0; r < L; r++) {
      for (let c = r + 1; c < L; c++) {
        const avg = 0.5 * (this.cov[r * L + c]! + this.cov[c * L + r]!);
        this.cov[r * L + c] = avg;
        this.cov[c * L + r] = avg;
      }
    }
  }

  /**
   * Standard Gauss-Jordan matrix inversion.
   */
  private invertMatrix(A: Float64Array, n: number): Float64Array {
    const aug = new Float64Array(n * 2 * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        aug[i * (2 * n) + j] = A[i * n + j]!;
      }
      aug[i * (2 * n) + (n + i)] = 1.0;
    }

    for (let col = 0; col < n; col++) {
      // Find pivot
      let maxVal = Math.abs(aug[col * (2 * n) + col]!);
      let maxRow = col;
      for (let r = col + 1; r < n; r++) {
        const val = Math.abs(aug[r * (2 * n) + col]!);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }

      if (maxRow !== col) {
        // Swap rows
        for (let c = 0; c < 2 * n; c++) {
          const tmp = aug[col * (2 * n) + c]!;
          aug[col * (2 * n) + c] = aug[maxRow * (2 * n) + c]!;
          aug[maxRow * (2 * n) + c] = tmp;
        }
      }

      const pivot = aug[col * (2 * n) + col]!;
      const invPivot = Math.abs(pivot) > 1e-14 ? 1.0 / pivot : 1.0;
      for (let c = 0; c < 2 * n; c++) {
        aug[col * (2 * n) + c] *= invPivot;
      }

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = aug[r * (2 * n) + col]!;
        if (Math.abs(factor) > 1e-15) {
          for (let c = 0; c < 2 * n; c++) {
            aug[r * (2 * n) + c] -= factor * aug[col * (2 * n) + c]!;
          }
        }
      }
    }

    const inv = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        inv[i * n + j] = aug[i * (2 * n) + (n + j)]!;
      }
    }
    return inv;
  }
}
