// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/surrogates — Continuous-Time Echo State Network (CTESN).
 *
 * Implements JuliaSimSurrogates' signature surrogate for stiff/chaotic dynamical systems:
 *   dr/dt = tanh(W_res * r + W_in * u(t))
 *   y_hat(t) = W_out * r(t)
 * where `W_res` (spectral radius < 1) and `W_in` are fixed random matrices, and `W_out` is
 * solved in closed form via Tikhonov-regularized ridge regression (zero backpropagation).
 */

import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";

export interface CtesnOptions {
  /** Reservoir dimension `N_r` (default: 40). */
  reservoirSize?: number | undefined;
  /** Input dimension `n_u`. */
  inputDim: number;
  /** Output dimension `n_y`. */
  outputDim: number;
  /** Target spectral radius of `W_res` (default: 0.85). */
  spectralRadius?: number | undefined;
  /** Ridge regression regularization `λ` (default: 1e-5). */
  ridgeLambda?: number | undefined;
  /** Deterministic PRNG seed (default: 1337). */
  seed?: number | undefined;
}

export class ContinuousTimeEchoStateNetwork {
  private readonly nr: number;
  private readonly nu: number;
  private readonly ny: number;
  private readonly ridge: number;
  private readonly Wres: Float64Array;
  private readonly Win: Float64Array;
  private Wout: Float64Array; // ny × (nr + 1) with bias column

  constructor(options: CtesnOptions) {
    this.nr = options.reservoirSize ?? 40;
    this.nu = options.inputDim;
    this.ny = options.outputDim;
    this.ridge = options.ridgeLambda ?? 1e-5;

    let state = (options.seed ?? 1337) >>> 0 || 1;
    const rand = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 4294967296) * 2 - 1;
    };

    this.Wres = new Float64Array(this.nr * this.nr);
    for (let i = 0; i < this.nr * this.nr; i++) {
      this.Wres[i] = rand() < 0.35 ? rand() : 0; // sparse reservoir
    }
    // Scale Wres to target spectral radius via power iteration
    let v = new Float64Array(this.nr).fill(1.0 / Math.sqrt(this.nr));
    let estRho = 1.0;
    for (let it = 0; it < 20; it++) {
      const w = new Float64Array(this.nr);
      for (let i = 0; i < this.nr; i++) {
        let s = 0;
        for (let j = 0; j < this.nr; j++) s += this.Wres[i * this.nr + j]! * v[j]!;
        w[i] = s;
      }
      let norm = 0;
      for (let i = 0; i < this.nr; i++) norm += w[i]! * w[i]!;
      norm = Math.sqrt(norm);
      if (norm > 1e-12) {
        estRho = norm;
        for (let i = 0; i < this.nr; i++) v[i] = w[i]! / norm;
      }
    }
    const scale = (options.spectralRadius ?? 0.85) / Math.max(1e-6, estRho);
    for (let i = 0; i < this.Wres.length; i++) this.Wres[i] = this.Wres[i]! * scale;

    this.Win = new Float64Array(this.nr * this.nu);
    for (let i = 0; i < this.Win.length; i++) this.Win[i] = 0.5 * rand();

    this.Wout = new Float64Array(this.ny * (this.nr + 1));
  }

  private reservoirRhs(r: Float64Array, u: number[]): Float64Array {
    const dr = new Float64Array(this.nr);
    for (let i = 0; i < this.nr; i++) {
      let s = 0;
      const rowRes = i * this.nr;
      for (let j = 0; j < this.nr; j++) s += this.Wres[rowRes + j]! * r[j]!;
      const rowIn = i * this.nu;
      for (let k = 0; k < this.nu; k++) s += this.Win[rowIn + k]! * (u[k] ?? 0);
      dr[i] = Math.tanh(s) - r[i]!;
    }
    return dr;
  }

  private integrateReservoir(times: number[], inputs: number[][]): Float64Array[] {
    const states: Float64Array[] = [];
    let r = new Float64Array(this.nr);
    states.push(new Float64Array(r));

    for (let k = 0; k < times.length - 1; k++) {
      const dt = times[k + 1]! - times[k]!;
      const u0 = inputs[k]!;
      const u1 = inputs[k + 1]!;
      const uMid = u0.map((v, i) => 0.5 * (v + (u1[i] ?? v)));

      const k1 = this.reservoirRhs(r, u0);
      const r2 = new Float64Array(this.nr);
      for (let i = 0; i < this.nr; i++) r2[i] = r[i]! + 0.5 * dt * k1[i]!;
      const k2 = this.reservoirRhs(r2, uMid);
      const r3 = new Float64Array(this.nr);
      for (let i = 0; i < this.nr; i++) r3[i] = r[i]! + 0.5 * dt * k2[i]!;
      const k3 = this.reservoirRhs(r3, uMid);
      const r4 = new Float64Array(this.nr);
      for (let i = 0; i < this.nr; i++) r4[i] = r[i]! + dt * k3[i]!;
      const k4 = this.reservoirRhs(r4, u1);

      const next = new Float64Array(this.nr);
      for (let i = 0; i < this.nr; i++) {
        next[i] = r[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
      }
      r = next;
      states.push(new Float64Array(r));
    }
    return states;
  }

  /**
   * Trains `W_out` in closed form via ridge regression `(R^T R + λ I) W_out^T = R^T Y`.
   */
  public fit(times: number[], inputs: number[][], targets: number[][]): { trainRmse: number } {
    const resStates = this.integrateReservoir(times, inputs);
    const T = resStates.length;
    const p = this.nr + 1;

    // Normal matrix G = R^T R + λ I (p × p)
    const G = new Float64Array(p * p);
    for (let i = 0; i < p; i++) G[i * p + i] = this.ridge;

    for (let t = 0; t < T; t++) {
      const r = resStates[t]!;
      for (let i = 0; i < p; i++) {
        const ri = i < this.nr ? r[i]! : 1.0;
        const rowOff = i * p;
        for (let j = 0; j < p; j++) {
          const rj = j < this.nr ? r[j]! : 1.0;
          G[rowOff + j] = G[rowOff + j]! + ri * rj;
        }
      }
    }

    const fact = luFactorFlat(G, p);

    for (let outIdx = 0; outIdx < this.ny; outIdx++) {
      const rhs = new Float64Array(p);
      for (let t = 0; t < T; t++) {
        const r = resStates[t]!;
        const yt = targets[t]![outIdx] ?? 0;
        for (let i = 0; i < this.nr; i++) rhs[i] = rhs[i]! + r[i]! * yt;
        rhs[this.nr] = rhs[this.nr]! + yt;
      }
      luSolveFlat(fact, rhs);
      for (let i = 0; i < p; i++) this.Wout[outIdx * p + i] = rhs[i]!;
    }

    // Compute training RMSE
    let sqErr = 0;
    for (let t = 0; t < T; t++) {
      const r = resStates[t]!;
      for (let outIdx = 0; outIdx < this.ny; outIdx++) {
        let pred = this.Wout[outIdx * p + this.nr]!;
        for (let i = 0; i < this.nr; i++) pred += this.Wout[outIdx * p + i]! * r[i]!;
        const diff = pred - (targets[t]![outIdx] ?? 0);
        sqErr += diff * diff;
      }
    }
    return { trainRmse: Math.sqrt(sqErr / Math.max(1, T * this.ny)) };
  }

  /** Evaluates the trained CTESN surrogate over a new time/input trajectory. */
  public predict(times: number[], inputs: number[][]): number[][] {
    const resStates = this.integrateReservoir(times, inputs);
    const p = this.nr + 1;
    return resStates.map((r) => {
      const y = new Array<number>(this.ny);
      for (let outIdx = 0; outIdx < this.ny; outIdx++) {
        let pred = this.Wout[outIdx * p + this.nr]!;
        for (let i = 0; i < this.nr; i++) pred += this.Wout[outIdx * p + i]! * r[i]!;
        y[outIdx] = pred;
      }
      return y;
    });
  }
}
