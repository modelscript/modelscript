// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/control — Real-Time Iteration (RTI) Nonlinear Model Predictive Control (NMPC).
 *
 * Implements Diehl's Real-Time Iteration scheme for nonlinear plants `dx/dt = f(x, u)`:
 *   1. Warm-start shift of previous optimal control sequence `U = [u_0, ..., u_{N-1}]`
 *   2. Single-pass RK4 nonlinear trajectory rollout + discrete-time sensitivities `(A_k, B_k)`
 *   3. Projected Gauss-Newton / box-constrained QP update over `u_min <= u_k <= u_max`
 */

export interface RtiNmpcOptions {
  /** Nonlinear continuous-time dynamics: `dx/dt = f(x, u)`. */
  dynamics: (x: number[], u: number[]) => number[];
  /** Number of state variables `n_x`. */
  nStates: number;
  /** Number of control inputs `n_u`. */
  nControls: number;
  /** Prediction horizon length `N` (default: 15). */
  horizon?: number | undefined;
  /** Sampling time `Ts` in seconds (default: 0.05). */
  dt?: number | undefined;
  /** Diagonal state tracking weights `Q` (length `n_x`). */
  Q: number[];
  /** Diagonal control effort weights `R` (length `n_u`). */
  R: number[];
  /** Diagonal terminal state weights `Qf` (default: `5 * Q`). */
  Qf?: number[] | undefined;
  /** Control lower bounds `u_min` (length `n_u`). */
  uMin: number[];
  /** Control upper bounds `u_max` (length `n_u`). */
  uMax: number[];
  /** Inner Gauss-Newton / projected gradient iterations per RTI tick (default: 5). */
  rtiInnerIterations?: number | undefined;
}

export interface RtiNmpcStepResult {
  /** Optimal control action `u_0` to apply at current tick. */
  u0: number[];
  /** Full predicted control sequence `[u_0, ..., u_{N-1}]`. */
  controlTrajectory: number[][];
  /** Predicted state trajectory `[x_0, ..., x_N]`. */
  predictedStates: number[][];
  /** Objective value at the returned trajectory. */
  cost: number;
}

function rk4Step(f: (x: number[], u: number[]) => number[], x: number[], u: number[], dt: number): number[] {
  const n = x.length;
  const k1 = f(x, u);
  const x2 = new Array<number>(n);
  for (let i = 0; i < n; i++) x2[i] = x[i]! + 0.5 * dt * k1[i]!;
  const k2 = f(x2, u);
  const x3 = new Array<number>(n);
  for (let i = 0; i < n; i++) x3[i] = x[i]! + 0.5 * dt * k2[i]!;
  const k3 = f(x3, u);
  const x4 = new Array<number>(n);
  for (let i = 0; i < n; i++) x4[i] = x[i]! + dt * k3[i]!;
  const k4 = f(x4, u);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = x[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  return out;
}

/**
 * Warm-started Real-Time Iteration (RTI) Nonlinear Model Predictive Controller.
 */
export class RtiNonlinearMpcController {
  private readonly N: number;
  private readonly dt: number;
  private readonly Qf: number[];
  private readonly innerIter: number;
  private warmU: number[][];

  constructor(private readonly opts: RtiNmpcOptions) {
    this.N = opts.horizon ?? 15;
    this.dt = opts.dt ?? 0.05;
    this.Qf = opts.Qf ?? opts.Q.map((q) => 5.0 * q);
    this.innerIter = opts.rtiInnerIterations ?? 5;
    this.warmU = Array.from({ length: this.N }, () =>
      Array.from({ length: opts.nControls }, (_, j) => 0.5 * (opts.uMin[j]! + opts.uMax[j]!)),
    );
  }

  private clampU(u: number[]): number[] {
    return u.map((v, j) => Math.max(this.opts.uMin[j]!, Math.min(this.opts.uMax[j]!, v)));
  }

  private rollout(x0: number[], U: number[][]): number[][] {
    const X: number[][] = [[...x0]];
    for (let k = 0; k < this.N; k++) {
      X.push(rk4Step(this.opts.dynamics, X[k]!, U[k]!, this.dt));
    }
    return X;
  }

  private evalCost(X: number[][], U: number[][], xRef: number[]): number {
    const { Q, R, nStates, nControls } = this.opts;
    let cost = 0;
    for (let k = 0; k < this.N; k++) {
      const xk = X[k]!;
      const uk = U[k]!;
      for (let i = 0; i < nStates; i++) {
        const d = xk[i]! - xRef[i]!;
        cost += 0.5 * Q[i]! * d * d;
      }
      for (let j = 0; j < nControls; j++) {
        cost += 0.5 * R[j]! * uk[j]! * uk[j]!;
      }
    }
    const xN = X[this.N]!;
    for (let i = 0; i < nStates; i++) {
      const d = xN[i]! - xRef[i]!;
      cost += 0.5 * this.Qf[i]! * d * d;
    }
    return cost;
  }

  /**
   * Executes one Real-Time Iteration (RTI) step from current measured state `xCurrent`
   * toward target setpoint `xRef`, returning the optimal bounded control `u0`.
   */
  public computeControl(xCurrent: number[], xRef: number[]): RtiNmpcStepResult {
    const { dynamics, Q, R, nStates, nControls } = this.opts;
    const N = this.N;
    const dt = this.dt;

    // 1. Shift warm-start control sequence by 1 step
    const U: number[][] = [];
    for (let k = 0; k < N - 1; k++) U.push([...this.warmU[k + 1]!]);
    U.push([...this.warmU[N - 1]!]);

    let X = this.rollout(xCurrent, U);
    let bestCost = this.evalCost(X, U, xRef);

    // 2. RTI Gauss-Newton / adjoint-gradient projected updates
    const eps = 1e-6;
    for (let it = 0; it < this.innerIter; it++) {
      // Backward adjoint pass along the nonlinear rollout: λ_N = Qf (x_N - xRef)
      const lambda: number[][] = Array.from({ length: N + 1 }, () => new Array<number>(nStates).fill(0));
      for (let i = 0; i < nStates; i++) {
        lambda[N]![i] = this.Qf[i]! * (X[N]![i]! - xRef[i]!);
      }

      const gradU: number[][] = Array.from({ length: N }, () => new Array<number>(nControls).fill(0));
      const diagHessU: number[][] = Array.from({ length: N }, () => new Array<number>(nControls).fill(0));

      for (let k = N - 1; k >= 0; k--) {
        const xk = X[k]!;
        const uk = U[k]!;
        const xNextNom = X[k + 1]!;
        const lamNext = lambda[k + 1]!;

        // Compute discrete-time Jacobians A_k = ∂Φ/∂x_k and B_k = ∂Φ/∂u_k via FD
        for (let i = 0; i < nStates; i++) {
          const xPert = [...xk];
          xPert[i] = xPert[i]! + eps;
          const xNextP = rk4Step(dynamics, xPert, uk, dt);
          let adj = Q[i]! * (xk[i]! - xRef[i]!);
          for (let r = 0; r < nStates; r++) {
            adj += ((xNextP[r]! - xNextNom[r]!) / eps) * lamNext[r]!;
          }
          lambda[k]![i] = adj;
        }

        for (let j = 0; j < nControls; j++) {
          const uPert = [...uk];
          uPert[j] = uPert[j]! + eps;
          const xNextP = rk4Step(dynamics, xk, uPert, dt);
          let g = R[j]! * uk[j]!;
          let hDiag = R[j]!;
          for (let r = 0; r < nStates; r++) {
            const b_rj = (xNextP[r]! - xNextNom[r]!) / eps;
            g += b_rj * lamNext[r]!;
            hDiag += b_rj * b_rj * (k === N - 1 ? this.Qf[r]! : Q[r]!);
          }
          gradU[k]![j] = g;
          diagHessU[k]![j] = Math.max(1e-6, hDiag);
        }
      }

      // Projected backtracking line search using diagonal Gauss-Newton preconditioning
      let alpha = 1.0;
      let accepted = false;
      for (let ls = 0; ls < 8; ls++) {
        const Ucand = U.map((uk, k) => this.clampU(uk.map((v, j) => v - alpha * (gradU[k]![j]! / diagHessU[k]![j]!))));
        const Xcand = this.rollout(xCurrent, Ucand);
        const cCand = this.evalCost(Xcand, Ucand, xRef);
        if (cCand < bestCost) {
          for (let k = 0; k < N; k++) U[k] = Ucand[k]!;
          X = Xcand;
          bestCost = cCand;
          accepted = true;
          break;
        }
        alpha *= 0.5;
      }
      if (!accepted) break;
    }

    this.warmU = U.map((u) => [...u]);

    return {
      u0: [...U[0]!],
      controlTrajectory: U,
      predictedStates: X,
      cost: bestCost,
    };
  }
}

export interface ArenaRtiNmpcConfig {
  /** State variable names in the DAEBuilder (order matches `Q`, `xCurrent`, `xRef`). */
  stateNames: string[];
  /** Control input variable/parameter names in the DAEBuilder (order matches `R`, `uMin`, `uMax`). */
  controlNames: string[];
  horizon?: number | undefined;
  dt?: number | undefined;
  Q: number[];
  R: number[];
  Qf?: number[] | undefined;
  uMin: number[];
  uMax: number[];
  rtiInnerIterations?: number | undefined;
}

/**
 * Creates a `RtiNonlinearMpcController` directly bound to a `DAEBuilder` arena model,
 * evaluating `dx/dt = f(x, u)` natively through `ArenaSimulator`.
 */
export function createArenaRtiNmpc(
  arena: import("@modelscript/runtime").DAEBuilder,
  sim: {
    prepare(): void;
    evaluateBlocks(vals: Float64Array): void;
    evaluateDerivativeEquations(vals: Float64Array): void;
  },
  config: ArenaRtiNmpcConfig,
): RtiNonlinearMpcController {
  sim.prepare();
  const stateIds = config.stateNames.map((n) => arena.interner.intern(n));
  const derivIds = config.stateNames.map((n) => arena.interner.intern(`der(${n})`));
  const controlIds = config.controlNames.map((n) => arena.interner.intern(n));

  let maxId = 64;
  for (const id of [...stateIds, ...derivIds, ...controlIds]) if (id > maxId) maxId = id;
  const scratch = new Float64Array(maxId + 64);

  const dynamics = (x: number[], u: number[]): number[] => {
    for (let i = 0; i < stateIds.length; i++) scratch[stateIds[i]!] = x[i] ?? 0;
    for (let j = 0; j < controlIds.length; j++) scratch[controlIds[j]!] = u[j] ?? 0;
    sim.evaluateBlocks(scratch);
    sim.evaluateDerivativeEquations(scratch);
    return derivIds.map((id) => scratch[id] ?? 0);
  };

  return new RtiNonlinearMpcController({
    dynamics,
    nStates: config.stateNames.length,
    nControls: config.controlNames.length,
    horizon: config.horizon,
    dt: config.dt,
    Q: config.Q,
    R: config.R,
    Qf: config.Qf,
    uMin: config.uMin,
    uMax: config.uMax,
    rtiInnerIterations: config.rtiInnerIterations,
  });
}
