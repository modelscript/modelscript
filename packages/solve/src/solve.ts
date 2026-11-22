// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified `solve(prob, alg?, opts?)` & `init(prob, alg?, opts?)` dispatch registry.
 *
 * Solver implementations in `@modelscript/runtime` (formal/reachability/abstract domains)
 * and `@modelscript/simulate` (ODE/DAE/SDE/DDE/BVP/Optimization) register their canonical
 * kernels here without introducing circular package dependencies.
 */

import type { AbstractAlgorithm, CommonSolveOptions, StepIntegrator, TrajectorySolution } from "./algorithms.js";
import type { VerificationCertificate } from "./certificate.js";
import type { AbstractProblem, ProblemKind } from "./problems.js";

export type SolveOutput = TrajectorySolution | VerificationCertificate | unknown;

export interface SolverRegistration<
  TProb extends AbstractProblem = AbstractProblem,
  TAlg extends AbstractAlgorithm = AbstractAlgorithm,
  TOut = SolveOutput,
> {
  readonly problemKind: TProb["kind"];
  readonly algorithmName: string;
  readonly isDefault?: boolean | undefined;
  readonly solve: (prob: TProb, alg: TAlg, opts: CommonSolveOptions) => TOut;
  readonly init?: ((prob: TProb, alg: TAlg, opts: CommonSolveOptions) => StepIntegrator) | undefined;
}

const _registry = new Map<string, SolverRegistration>();
const _defaults = new Map<ProblemKind, { alg: AbstractAlgorithm; reg: SolverRegistration }>();

function regKey(kind: ProblemKind, algName: string): string {
  return `${kind}::${algName}`;
}

/** Registers a canonical solver backend for a `(problemKind, algorithmName)` pair. */
export function registerSolver<TProb extends AbstractProblem, TAlg extends AbstractAlgorithm, TOut = SolveOutput>(
  reg: SolverRegistration<TProb, TAlg, TOut>,
  defaultAlg?: TAlg,
): void {
  const key = regKey(reg.problemKind, reg.algorithmName);
  _registry.set(key, reg as unknown as SolverRegistration);
  if (reg.isDefault && defaultAlg) {
    _defaults.set(reg.problemKind, { alg: defaultAlg, reg: reg as unknown as SolverRegistration });
  }
}

/** Lists all registered `(problemKind, algorithmName)` solvers. */
export function listSolvers(problemKind?: ProblemKind): Array<{ problemKind: ProblemKind; algorithmName: string }> {
  const out: Array<{ problemKind: ProblemKind; algorithmName: string }> = [];
  for (const reg of _registry.values()) {
    if (!problemKind || reg.problemKind === problemKind) {
      out.push({ problemKind: reg.problemKind, algorithmName: reg.algorithmName });
    }
  }
  return out;
}

/**
 * Unified single-verb solver entry point (analogous to Julia's `solve(prob, alg; kwargs...)`).
 */
export function solve<TOut = SolveOutput>(
  prob: AbstractProblem,
  alg?: AbstractAlgorithm,
  opts: CommonSolveOptions = {},
): TOut {
  if (!alg) {
    const def = _defaults.get(prob.kind);
    if (!def) {
      throw new Error(
        `No default solver registered for problem kind '${prob.kind}'. Pass an explicit algorithm or import @modelscript/simulate / @modelscript/runtime.`,
      );
    }
    return def.reg.solve(prob, def.alg, opts) as TOut;
  }

  const reg =
    _registry.get(regKey(prob.kind, alg.name)) ??
    // Allow DAE-capable stiff solvers to solve ODE problems directly
    (prob.kind === "ode" ? _registry.get(regKey("dae", alg.name)) : undefined);

  if (!reg) {
    throw new Error(
      `No solver registered for (${prob.kind}, ${alg.name}). Registered solvers for '${prob.kind}': ${
        listSolvers(prob.kind)
          .map((s) => s.algorithmName)
          .join(", ") || "(none)"
      }.`,
    );
  }
  return reg.solve(prob, alg, opts) as TOut;
}

/**
 * Initializes a step-by-step stateful integrator with deterministic resource cleanup.
 */
export function init(prob: AbstractProblem, alg?: AbstractAlgorithm, opts: CommonSolveOptions = {}): StepIntegrator {
  const resolvedAlg = alg ?? _defaults.get(prob.kind)?.alg;
  if (!resolvedAlg) {
    throw new Error(`No default integrator registered for problem kind '${prob.kind}'.`);
  }
  const reg =
    _registry.get(regKey(prob.kind, resolvedAlg.name)) ??
    (prob.kind === "ode" ? _registry.get(regKey("dae", resolvedAlg.name)) : undefined);

  if (!reg?.init) {
    throw new Error(`Algorithm '${resolvedAlg.name}' for '${prob.kind}' does not support step-by-step init().`);
  }
  return reg.init(prob, resolvedAlg, opts);
}
