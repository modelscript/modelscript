// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Strict soundness & rigor contract for all formal verification and reachability engines.
 *
 * Enforces by construction that `isCertifiedSafe` can ONLY be `true` when:
 *   1. `verdict.status === "proven"`, AND
 *   2. `verdict.rigor` is `"exact-rational"` or `"outward-f64"`.
 *
 * Heuristic, unrounded floating-point, timed-out, or skipped runs can NEVER produce
 * a certified-safe certificate.
 */

export type RigorLevel =
  /** Exact arbitrary-precision rational or symbolic proof. */
  | "exact-rational"
  /** IEEE-754 floating-point proof with rigorous outward/directed rounding. */
  | "outward-f64"
  /** Unrounded floating-point computation (NOT formally certified). */
  | "floating-point"
  /** Sampling, corner evaluation, or heuristic approximation (NOT formally certified). */
  | "heuristic";

export type UnknownReason =
  | "budget"
  | "timeout"
  | "not-rigorous"
  | "incomplete-projection"
  | "unimplemented"
  | "skipped"
  | "numerical-instability";

export interface CounterexampleWitness {
  readonly time?: number | undefined;
  readonly state: readonly number[];
  readonly stateNames?: readonly string[] | undefined;
  readonly propertyName?: string | undefined;
  readonly margin?: number | undefined;
  /** True only when the witness has been independently validated against the model. */
  readonly validated: boolean;
}

export type Verdict =
  | { readonly status: "proven"; readonly rigor: RigorLevel; readonly detail: string }
  | { readonly status: "violated"; readonly witness: CounterexampleWitness; readonly detail: string }
  | { readonly status: "unknown"; readonly reason: UnknownReason; readonly rigor: RigorLevel; readonly detail: string };

/** Returns true iff the rigor level meets formal certification standards. */
export function isRigorous(rigor: RigorLevel): boolean {
  return rigor === "exact-rational" || rigor === "outward-f64";
}

export interface VerificationCertificate<TData = unknown> {
  readonly verdict: Verdict;
  /** Strictly derived: true ONLY if `verdict.status === "proven"` AND `isRigorous(verdict.rigor)`. */
  readonly isCertifiedSafe: boolean;
  readonly algorithm: string;
  readonly durationMs: number;
  readonly summary: string;
  readonly data?: TData | undefined;
}

/**
 * Constructs an immutable `VerificationCertificate` enforcing the strict rigor invariant.
 * If a caller attempts to emit `status: "proven"` with a non-rigorous `rigor` level
 * (`"heuristic"` or `"floating-point"`), it is automatically downgraded to
 * `{ status: "unknown", reason: "not-rigorous" }` so unsound proofs cannot escape.
 */
export function createCertificate<TData = unknown>(params: {
  verdict: Verdict;
  algorithm: string;
  durationMs: number;
  summary: string;
  data?: TData | undefined;
}): VerificationCertificate<TData> {
  let finalVerdict = params.verdict;
  if (finalVerdict.status === "proven" && !isRigorous(finalVerdict.rigor)) {
    finalVerdict = {
      status: "unknown",
      reason: "not-rigorous",
      rigor: finalVerdict.rigor,
      detail: `Downgraded from proven (${finalVerdict.rigor} is not formally certified): ${finalVerdict.detail}`,
    };
  }

  const isCertifiedSafe = finalVerdict.status === "proven" && isRigorous(finalVerdict.rigor);

  return Object.freeze({
    verdict: Object.freeze(finalVerdict),
    isCertifiedSafe,
    algorithm: params.algorithm,
    durationMs: params.durationMs,
    summary: params.summary,
    data: params.data,
  });
}
