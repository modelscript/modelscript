// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArenaBltResult } from "../analysis/wasm_blt.js";
import type { DAEBuilder } from "../dae/wasm_dae.js";

/**
 * Shared compilation context passed between DAE transformation passes.
 */
export interface PassContext {
  /** Set of active state variable indices. */
  stateVars: Set<number>;
  /** Set of derivative variable indices (`der(x)`). */
  derivativeVars: Set<number>;
  /** Set of dummy derivative variable indices selected during index reduction. */
  dummyDerivatives: Set<number>;
  /** Set of parameter variable indices. */
  parameterVars: Set<number>;
  /** Map of parameter names to resolved numeric values. */
  parameters: Map<string, number>;
  /** Set of eliminated derivative variable indices. */
  eliminatedDerVars: Set<number>;
  /** Block Lower Triangular (BLT) transformation result, if computed. */
  bltResult?: ArenaBltResult | undefined;
  /** Arbitrary shared metadata or analysis artifacts (e.g., incidence matrices, graph structures). */
  sharedData: Map<string, unknown>;
  /** Diagnostics or tracing logger. */
  log(message: string): void;
}

/**
 * Result returned by a single pass execution.
 */
export interface PassResult {
  /** Whether the pass mutated equations, variables, or expressions in the arena. */
  changed: boolean;
  /** Informative message or summary of actions performed. */
  message?: string;
  /** Numeric statistics or telemetry (e.g. number of aliases eliminated). */
  metrics?: Record<string, number>;
}

/**
 * Formal interface for a modular compiler pass operating on a `DAEBuilder`.
 */
export interface DAEPass {
  /** Unique pass identifier name (e.g. `"scalarize"`, `"pantelides"`, `"blt"`). */
  readonly name: string;
  /** Human-readable pass description. */
  readonly description?: string;
  /** Executes the pass on the target arena within the given pass context. */
  run(arena: DAEBuilder, ctx: PassContext): PassResult | undefined;
}

/**
 * Summary report returned after running a sequence of passes.
 */
export interface PassRunSummary {
  /** Timing and result per executed pass. */
  reports: {
    passName: string;
    durationMs: number;
    result?: PassResult | undefined;
  }[];
  /** Total elapsed time across all passes (milliseconds). */
  totalDurationMs: number;
  /** Final state of the pass context. */
  context: PassContext;
}
