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

  /**
   * Serializes the canonical trace into standard IEEE 1364 Value Change Dump (.vcd) format.
   * Enables inspection of formal counterexamples in PulseView, GTKWave, and hardware waveform viewers.
   */
  public static exportToVcd(trace: CanonicalTraceRecord): string {
    const lines: string[] = [];
    lines.push("$date");
    lines.push(`  ${new Date().toISOString()}`);
    lines.push("$end");
    lines.push("$version");
    lines.push("  ModelScript Formal Verification VCD Generator");
    lines.push("$end");
    lines.push("$timescale 1us $end");
    lines.push("$scope module Top $end");

    // Assign identifier symbols
    const varMap: { name: string; id: string; type: "real" | "discrete" }[] = [];
    let idCode = 33; // ASCII '!'

    for (const name of Object.keys(trace.continuousSignals)) {
      const id = String.fromCharCode(idCode++);
      varMap.push({ name, id, type: "real" });
      lines.push(`$var real 64 ${id} ${name} $end`);
    }

    if (trace.discreteSignals) {
      for (const name of Object.keys(trace.discreteSignals)) {
        const id = String.fromCharCode(idCode++);
        varMap.push({ name, id, type: "discrete" });
        lines.push(`$var string 1 ${id} ${name} $end`);
      }
    }

    lines.push("$upscope $end");
    lines.push("$enddefinitions $end");
    lines.push("$dumpvars");

    // Initial values
    for (const v of varMap) {
      if (v.type === "real") {
        const val = trace.continuousSignals[v.name]?.[0] ?? 0;
        lines.push(`r${val} ${v.id}`);
      } else {
        const val = trace.discreteSignals?.[v.name]?.[0] ?? "";
        lines.push(`s${val} ${v.id}`);
      }
    }
    lines.push("$end");

    // Values over time
    for (let tIdx = 0; tIdx < trace.times.length; tIdx++) {
      const t = trace.times[tIdx]!;
      const timeInUs = Math.round(t * 1e6);
      lines.push(`#${timeInUs}`);

      for (const v of varMap) {
        if (v.type === "real") {
          const val = trace.continuousSignals[v.name]?.[tIdx];
          if (val !== undefined) {
            lines.push(`r${val} ${v.id}`);
          }
        } else {
          const val = trace.discreteSignals?.[v.name]?.[tIdx];
          if (val !== undefined) {
            lines.push(`s${val} ${v.id}`);
          }
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Serializes the canonical trace into comma-separated values (CSV) format.
   */
  public static exportToCsv(trace: CanonicalTraceRecord): string {
    const contKeys = Object.keys(trace.continuousSignals);
    const discKeys = trace.discreteSignals ? Object.keys(trace.discreteSignals) : [];
    const headers = ["time", ...contKeys, ...discKeys];

    const rows: string[] = [headers.join(",")];

    for (let i = 0; i < trace.times.length; i++) {
      const rowVals: (string | number | boolean)[] = [trace.times[i]!];
      for (const k of contKeys) {
        rowVals.push(trace.continuousSignals[k]?.[i] ?? "");
      }
      for (const k of discKeys) {
        rowVals.push(trace.discreteSignals?.[k]?.[i] ?? "");
      }
      rows.push(rowVals.join(","));
    }

    return rows.join("\n");
  }

  /**
   * Linearly interpolates continuous signals and step-interpolates discrete signals onto a unified time vector.
   */
  public static interpolateTrace(trace: CanonicalTraceRecord, targetTimes: number[]): CanonicalTraceRecord {
    const origTimes = trace.times;
    if (origTimes.length === 0 || targetTimes.length === 0) {
      return { ...trace, times: targetTimes };
    }

    const interpCont: Record<string, number[]> = {};
    for (const [k, vals] of Object.entries(trace.continuousSignals)) {
      interpCont[k] = targetTimes.map((t) => {
        if (t <= origTimes[0]!) return vals[0]!;
        if (t >= origTimes[origTimes.length - 1]!) return vals[vals.length - 1]!;

        let idx = 0;
        while (idx < origTimes.length - 1 && origTimes[idx + 1]! < t) {
          idx++;
        }
        const t0 = origTimes[idx]!;
        const t1 = origTimes[idx + 1]!;
        const v0 = vals[idx]!;
        const v1 = vals[idx + 1]!;
        const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        return v0 + frac * (v1 - v0);
      });
    }

    let interpDisc: Record<string, (string | number | boolean)[]> | undefined;
    if (trace.discreteSignals) {
      interpDisc = {};
      for (const [k, vals] of Object.entries(trace.discreteSignals)) {
        interpDisc[k] = targetTimes.map((t) => {
          let idx = 0;
          while (idx < origTimes.length - 1 && origTimes[idx + 1]! <= t) {
            idx++;
          }
          return vals[idx] ?? false;
        });
      }
    }

    return {
      ...trace,
      times: targetTimes,
      continuousSignals: interpCont,
      discreteSignals: interpDisc,
    };
  }
}
