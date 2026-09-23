// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Canonical Counterexample & Verification Trace Schema.
 *
 * Provides a normalized serialization schema for dynamic falsification runs,
 * discrete bounded model checking (BMC) counterexamples, IC3 inductive proofs,
 * and continuous flowpipe reachability violations.
 */

export interface CanonicalTraceRecord {
  /** Unique trace identifier */
  id: string;
  /** Verification domain / engine of origin */
  source: "bmc" | "ic3" | "falsification" | "flowpipe_escape";
  /** Outcome status */
  status: "FALSIFIED" | "UNSAT" | "CERTIFIED_SAFE";
  /** Time vector (dimension T) */
  times: number[];
  /** Continuous time-series signals: signalName -> values of length T */
  continuousSignals: Record<string, number[]>;
  /** Discrete state signals: variableName -> state value at each time index */
  discreteSignals?: Record<string, (string | number | boolean)[]>;
  /** Index k in times where requirement/property violation occurs */
  violatingTimeIndex?: number;
  /** Property, contract, or STL requirement name violated */
  violatingProperty?: string;
  /** Parameter assignment vector associated with this trace */
  parameters?: Record<string, number>;
  /** Additional diagnostic metadata */
  metadata?: Record<string, unknown>;
}

export class TraceRecordNormalizer {
  /**
   * Normalizes a BMC discrete step counterexample trace.
   */
  public static fromBmcCounterexample(
    steps: Record<string, boolean | number | string>[],
    propertyName = "SafetyProperty",
  ): CanonicalTraceRecord {
    const times = steps.map((_, idx) => idx);
    const discreteSignals: Record<string, (string | number | boolean)[]> = {};

    if (steps.length > 0) {
      const keys = Object.keys(steps[0]!);
      for (const key of keys) {
        discreteSignals[key] = steps.map((s) => s[key] ?? false);
      }
    }

    return {
      id: `bmc-cex-${Date.now()}`,
      source: "bmc",
      status: "FALSIFIED",
      times,
      continuousSignals: {},
      discreteSignals,
      violatingTimeIndex: steps.length - 1,
      violatingProperty: propertyName,
      metadata: { numSteps: steps.length },
    };
  }

  /**
   * Normalizes a continuous simulation / adversarial falsification trajectory.
   */
  public static fromFalsificationTrajectory(options: {
    times: number[];
    signals: Record<string, number[]>;
    parameters?: Record<string, number>;
    propertyName?: string;
    minRobustness: number;
    violatingTimeIndex?: number;
  }): CanonicalTraceRecord {
    const {
      times,
      signals,
      parameters = {},
      propertyName = "STLRequirement",
      minRobustness,
      violatingTimeIndex,
    } = options;

    const isFalsified = minRobustness < 0;

    return {
      id: `falsif-${Date.now()}`,
      source: "falsification",
      status: isFalsified ? "FALSIFIED" : "CERTIFIED_SAFE",
      times,
      continuousSignals: signals,
      violatingTimeIndex: isFalsified ? (violatingTimeIndex ?? times.length - 1) : undefined,
      violatingProperty: propertyName,
      parameters,
      metadata: { minRobustness },
    };
  }

  /**
   * Normalizes a continuous flowpipe tube into lower/upper boundary signals.
   */
  public static fromFlowpipeTubes(options: {
    times: number[];
    variableNames: string[];
    tubes: { lo: number; hi: number }[][];
    propertyName?: string;
    violatingStepIndex?: number;
  }): CanonicalTraceRecord {
    const { times, variableNames, tubes, propertyName = "FlowpipeSafetyInclusion", violatingStepIndex } = options;

    const continuousSignals: Record<string, number[]> = {};
    for (let v = 0; v < variableNames.length; v++) {
      const name = variableNames[v]!;
      continuousSignals[`${name}_lo`] = tubes.map((step) => step[v]?.lo ?? 0);
      continuousSignals[`${name}_hi`] = tubes.map((step) => step[v]?.hi ?? 0);
      continuousSignals[`${name}_mid`] = tubes.map((step) => {
        const iv = step[v];
        return iv ? 0.5 * (iv.lo + iv.hi) : 0;
      });
    }

    const isFalsified = violatingStepIndex !== undefined && violatingStepIndex >= 0;

    return {
      id: `flowpipe-${Date.now()}`,
      source: "flowpipe_escape",
      status: isFalsified ? "FALSIFIED" : "CERTIFIED_SAFE",
      times,
      continuousSignals,
      violatingTimeIndex: violatingStepIndex,
      violatingProperty: propertyName,
      metadata: { numVariables: variableNames.length, numSteps: times.length },
    };
  }
}
