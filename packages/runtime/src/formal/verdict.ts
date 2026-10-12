// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Verification Verdicts.
 *
 * Every set-based verification engine (interval, affine, zonotope, Taylor model, DAE flowpipe)
 * must report its outcome as a {@link VerificationVerdict}. The contract is:
 *
 *  - `proven`   — a guaranteed over-approximation of the reachable set satisfies the requirement.
 *                 Only engines whose enclosures are mathematically sound may emit this.
 *  - `violated` — the requirement is breached by a concrete witness (counterexample trajectory or
 *                 point). An over-approximation crossing a limit is NOT a violation: it is `unknown`.
 *  - `unknown`  — the analysis could not decide (enclosure too wide, budget exhausted,
 *                 unsupported model features, or the engine is not yet sound).
 *
 * Downstream consumers (LSP diagnostics, CodeLens, CLI reports) must never display "verified",
 * "certified" or "safe" for anything other than a `proven` verdict.
 */

/**
 * Rigor level of an enclosure.
 *  - `rigorous`    — sound including floating-point rounding (outward rounding throughout).
 *  - `float-sound` — sound in exact arithmetic; floating-point rounding is not controlled.
 *  - `heuristic`   — not a guaranteed enclosure (e.g. unbounded linearization error, sampled checks).
 */
export type VerdictRigor = "rigorous" | "float-sound" | "heuristic";

export type UnknownReason =
  /** The enclosure crosses the requirement limit but no concrete witness was found. */
  | "inconclusive-enclosure"
  /** Time/iteration budget exhausted before reaching the requested horizon. */
  | "budget"
  /** The model uses features the engine does not support. */
  | "unsupported"
  /** A validated step (e.g. Picard/Krawczyk containment) failed to converge. */
  | "nonconvergent"
  /** The engine produced a result, but its enclosure is not guaranteed (rigor = heuristic). */
  | "not-rigorous";

export interface VerdictWitness {
  /** Time at which the requirement is breached. */
  time: number;
  /** Concrete state values (by index or name) at the breach. */
  state: Record<string, number> | number[];
  /** Optional full witness trajectory. */
  trajectory?: { t: number[]; values: number[][] };
}

export type VerificationVerdict =
  | { kind: "proven"; rigor: Exclude<VerdictRigor, "heuristic">; detail?: string }
  | { kind: "violated"; witness: VerdictWitness; detail?: string }
  | { kind: "unknown"; reason: UnknownReason; rigor?: VerdictRigor; detail?: string };

/**
 * Derives a verdict from an enclosure-based check.
 *
 * @param enclosureSatisfies Whether the computed enclosure satisfies every requirement.
 * @param rigor Rigor level of the enclosure.
 * @param detail Optional human-readable explanation.
 */
export function verdictFromEnclosure(
  enclosureSatisfies: boolean,
  rigor: VerdictRigor,
  detail?: string,
): VerificationVerdict {
  if (rigor === "heuristic") {
    return { kind: "unknown", reason: "not-rigorous", rigor, ...(detail ? { detail } : {}) };
  }
  if (enclosureSatisfies) {
    return { kind: "proven", rigor, ...(detail ? { detail } : {}) };
  }
  return { kind: "unknown", reason: "inconclusive-enclosure", rigor, ...(detail ? { detail } : {}) };
}

/** True only for verdicts that may be displayed as "verified"/"certified". */
export function isProven(v: VerificationVerdict | undefined): boolean {
  return v?.kind === "proven";
}
