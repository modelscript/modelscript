// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Counterexample-Guided Inductive Synthesis (CEGIS) Engine.
 *
 * Generic CEGIS loop pairing:
 *   - `synthesize(counterexamples)`: proposes a candidate parameter/controller/invariant
 *     satisfying all counterexamples discovered so far.
 *   - `verify(candidate)`: formally verifies the candidate over the full domain and either
 *     certifies validity or returns a concrete counterexample.
 */

export type CegisVerificationOutcome<TCex> =
  | { readonly valid: true; readonly certificate?: unknown }
  | { readonly valid: false; readonly counterexample: TCex; readonly reason?: string | undefined };

export interface CegisProblem<TCandidate, TCex> {
  readonly synthesize: (counterexamples: readonly TCex[], iteration: number) => TCandidate | null;
  readonly verify: (candidate: TCandidate, iteration: number) => CegisVerificationOutcome<TCex>;
  readonly initialCounterexamples?: readonly TCex[] | undefined;
  readonly maxIterations?: number | undefined;
}

export interface CegisResult<TCandidate, TCex> {
  readonly status: "synthesized" | "unrealizable" | "max_iterations";
  readonly candidate: TCandidate | null;
  readonly iterations: number;
  readonly counterexamples: TCex[];
  readonly certificate?: unknown;
}

export function runCegis<TCandidate, TCex>(problem: CegisProblem<TCandidate, TCex>): CegisResult<TCandidate, TCex> {
  const maxIters = problem.maxIterations ?? 50;
  const cexs: TCex[] = [...(problem.initialCounterexamples ?? [])];
  let lastCandidate: TCandidate | null = null;

  for (let iter = 1; iter <= maxIters; iter++) {
    const candidate = problem.synthesize(cexs, iter);
    if (candidate === null) {
      return {
        status: "unrealizable",
        candidate: null,
        iterations: iter,
        counterexamples: cexs,
      };
    }
    lastCandidate = candidate;
    const outcome = problem.verify(candidate, iter);
    if (outcome.valid) {
      return {
        status: "synthesized",
        candidate,
        iterations: iter,
        counterexamples: cexs,
        certificate: outcome.certificate,
      };
    }
    cexs.push(outcome.counterexample);
  }

  return {
    status: "max_iterations",
    candidate: lastCandidate,
    iterations: maxIters,
    counterexamples: cexs,
  };
}
