// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified solver configuration for all phases of the Modelica/FMU pipeline.
 *
 * Provides a single options interface that controls method selection across:
 *  - ODE/DAE integration (RK4, DOPRI5, BDF, CVODE, IDA)
 *  - Nonlinear solving for algebraic loops & initialization (Newton, KINSOL)
 *  - Jacobian computation (finite-difference, forward-AD, reverse-AD)
 *  - Optimization (SQP, IPOPT)
 *  - LP/MILP (built-in, CLP, CBC)
 *
 * Usage:
 *   const opts: SolverOptions = { integrator: "cvode", jacobian: "ad-forward" };
 *   simulator.simulate(0, 10, 0.01, { solverOptions: opts });
 */

// ── ODE/DAE Integrator ──

/** Available ODE/DAE integration methods. */
export type IntegratorMethod =
  /** Fixed-step 4th-order Runge-Kutta (simple, non-adaptive). */
  | "rk4"
  /** Dormand-Prince 5(4) adaptive RK (default, good for non-stiff). */
  | "dopri5"
  /** Variable-order BDF 1-5 (good for stiff, pure TS). */
  | "bdf"
  /** Auto-detect: start DOPRI5, fall back to BDF if stiff. */
  | "auto"
  /** SUNDIALS CVODE via WASM (production-grade variable-order BDF/Adams). */
  | "cvode"
  /** SUNDIALS IDA via WASM (implicit DAE solver). */
  | "ida";

// ── Nonlinear Solver ──

/** Available nonlinear solver methods for algebraic loops & initialization. */
export type NonlinearMethod =
  /** Newton-Raphson with LU factorization (default). */
  | "newton"
  /** SUNDIALS KINSOL via WASM (globalized Newton with line search). */
  | "kinsol"
  /** Try Newton first, fall back to KINSOL on failure. */
  | "hybrid";

// ── Linear Solver ──

/** Available linear solver methods for Jacobian systems. */
export type LinearMethod =
  /** Dense LU factorization with partial pivoting (default). */
  | "dense-lu"
  /** LAPACK-based dense solver (via WASM, more robust pivoting). */
  | "lapack"
  /** KLU sparse direct solver (via SUNDIALS WASM, for large sparse systems). */
  | "klu-sparse";

// ── Jacobian Computation ──

/** Available Jacobian computation methods. */
export type JacobianMethod =
  /** Finite-difference approximation (default, simple but O(n) evaluations). */
  | "finite-difference"
  /** Forward-mode AD via dual numbers (exact, O(n) but no FD noise). */
  | "ad-forward"
  /** Reverse-mode AD via tape (exact, O(1) per output, best for gradients). */
  | "ad-reverse"
  /** Symbolic differentiation (exact, compile-time, for codegen only). */
  | "symbolic";

// ── Optimization ──

/** Available optimization solver methods. */
export type OptimizerMethod =
  /** Sequential Quadratic Programming with BFGS (pure TS, FD gradients). */
  | "sqp"
  /** SQP with exact AD gradients and Jacobians. */
  | "sqp-ad"
  /** COIN-OR IPOPT via WASM (interior-point, production-grade NLP). */
  | "ipopt"
  /** COIN-OR Bonmin via WASM (heuristic MINLP). */
  | "bonmin"
  /** COIN-OR Couenne via WASM (exact global MINLP). */
  | "couenne";

// ── Uncertainty Propagation ──

/** Available uncertainty propagation methods. */
export type UncertaintyMethod =
  /** First-order linearized Gaussian moment propagation (default). */
  | "analytical"
  /** Monte Carlo sampling (general-purpose fallback). */
  | "monte-carlo"
  /** Unscented Transform (better accuracy for nonlinear models). */
  | "unscented"
  /** Auto-select: analytical for Gaussian inputs, MC for non-Gaussian. */
  | "auto";

// ── LP/MILP ──

/** Available LP/MILP solver methods. */
export type LpMethod =
  /** Built-in branch-and-bound (pure TS). */
  | "built-in"
  /** COIN-OR CLP via WASM (simplex LP). */
  | "clp"
  /** COIN-OR CBC via WASM (branch-and-cut MILP). */
  | "cbc";

// ── Unified Options ──

/**
 * Unified solver configuration.
 *
 * Each field selects the method for one phase of the pipeline.
 * Unset fields use the defaults from `DEFAULT_SOLVER_OPTIONS`.
 */
export interface SolverOptions {
  /** ODE/DAE integration method (default: "dopri5"). */
  integrator?: IntegratorMethod;

  /** Nonlinear solver for algebraic loops & initialization (default: "newton"). */
  nonlinear?: NonlinearMethod;

  /** Linear solver for Jacobian systems (default: "dense-lu"). */
  linear?: LinearMethod;

  /** Jacobian computation method (default: "finite-difference"). */
  jacobian?: JacobianMethod;

  /** Optimization solver (default: "sqp"). */
  optimizer?: OptimizerMethod;

  /** LP/MILP solver (default: "built-in"). */
  lpSolver?: LpMethod;

  /** Absolute tolerance for integrators and nonlinear solvers (default: 1e-6). */
  atol?: number;

  /** Relative tolerance for integrators and nonlinear solvers (default: 1e-6). */
  rtol?: number;

  /** Maximum Newton/KINSOL iterations for nonlinear solvers (default: 20). */
  maxNonlinearIterations?: number;

  /** Maximum integrator steps (default: 100000). */
  maxSteps?: number;

  /** Maximum integrator step size (0 = unlimited). */
  maxStep?: number;

  /** Initial integrator step size (0 = auto). */
  initialStep?: number;

  /** Uncertainty propagation method (default: "auto"). */
  uncertainty?: UncertaintyMethod;

  /** Monte Carlo sample count (default: 1000). */
  mcSamples?: number;

  /** Monte Carlo seed for reproducibility (default: undefined = random). */
  mcSeed?: number;
}

/** Default solver options — pure TS methods, no WASM dependencies. */
export const DEFAULT_SOLVER_OPTIONS: Readonly<Required<SolverOptions>> = {
  integrator: "dopri5",
  nonlinear: "newton",
  linear: "dense-lu",
  jacobian: "finite-difference",
  optimizer: "sqp",
  lpSolver: "built-in",
  atol: 1e-6,
  rtol: 1e-6,
  maxNonlinearIterations: 20,
  maxSteps: 100000,
  maxStep: 0,
  initialStep: 0,
  uncertainty: "auto",
  mcSamples: 1000,
  mcSeed: 0,
};

/**
 * Merge user-provided options with defaults.
 * Returns a fully-resolved options object.
 */
export function resolveSolverOptions(opts?: SolverOptions): Readonly<Required<SolverOptions>> {
  if (!opts) return DEFAULT_SOLVER_OPTIONS;
  return {
    integrator: opts.integrator ?? DEFAULT_SOLVER_OPTIONS.integrator,
    nonlinear: opts.nonlinear ?? DEFAULT_SOLVER_OPTIONS.nonlinear,
    linear: opts.linear ?? DEFAULT_SOLVER_OPTIONS.linear,
    jacobian: opts.jacobian ?? DEFAULT_SOLVER_OPTIONS.jacobian,
    optimizer: opts.optimizer ?? DEFAULT_SOLVER_OPTIONS.optimizer,
    lpSolver: opts.lpSolver ?? DEFAULT_SOLVER_OPTIONS.lpSolver,
    atol: opts.atol ?? DEFAULT_SOLVER_OPTIONS.atol,
    rtol: opts.rtol ?? DEFAULT_SOLVER_OPTIONS.rtol,
    maxNonlinearIterations: opts.maxNonlinearIterations ?? DEFAULT_SOLVER_OPTIONS.maxNonlinearIterations,
    maxSteps: opts.maxSteps ?? DEFAULT_SOLVER_OPTIONS.maxSteps,
    maxStep: opts.maxStep ?? DEFAULT_SOLVER_OPTIONS.maxStep,
    initialStep: opts.initialStep ?? DEFAULT_SOLVER_OPTIONS.initialStep,
    uncertainty: opts.uncertainty ?? DEFAULT_SOLVER_OPTIONS.uncertainty,
    mcSamples: opts.mcSamples ?? DEFAULT_SOLVER_OPTIONS.mcSamples,
    mcSeed: opts.mcSeed ?? DEFAULT_SOLVER_OPTIONS.mcSeed,
  };
}

/**
 * Check if any WASM solver is requested.
 * Useful for determining if async loading is needed.
 */
export function requiresWasm(opts: SolverOptions): boolean {
  return (
    opts.integrator === "cvode" ||
    opts.integrator === "ida" ||
    opts.nonlinear === "kinsol" ||
    opts.nonlinear === "hybrid" ||
    opts.linear === "lapack" ||
    opts.linear === "klu-sparse" ||
    opts.optimizer === "ipopt" ||
    opts.optimizer === "bonmin" ||
    opts.optimizer === "couenne" ||
    opts.lpSolver === "clp" ||
    opts.lpSolver === "cbc"
  );
}
